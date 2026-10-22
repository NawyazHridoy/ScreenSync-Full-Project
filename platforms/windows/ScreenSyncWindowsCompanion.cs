using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Threading;
using Microsoft.Win32;
using NAudio.CoreAudioApi;
using UIAutomationClient;

namespace ScreenSync.Platform.Windows
{
    /// <summary>
    /// Native Windows Companion Collector & Local Bridge for ScreenSync.
    /// Wires together:
    /// 1. Win32 SetWinEventHook (EVENT_SYSTEM_FOREGROUND = 0x0003) + SynthesizeInitialFocus()
    /// 2. 10-second heartbeat polling timer + SystemEvents.SessionSwitch & PowerModeChanged
    /// 3. Shell filter (IsTrackableWindow: explorer allowed only for CabinetWClass / ExploreWClass)
    /// 4. UWP ApplicationFrameHost window-title resolution (persistedWindowTitle = null)
    /// 5. GetLastInputInfo user idle time (WindowsIdleTimeHelper)
    /// 6. Fullscreen monitor rect check (MonitorFromWindow / GetMonitorInfo)
    /// 7. UIAutomation browser omnibox reader (OmniboxViewViews for Chromium; urlbar-input for Firefox)
    /// 8. WASAPI per-process audio peak detection (AudioSessionControl2.GetProcessID + MasterPeakValue > 0.001f)
    /// 9. Local HTTP JSON bridge (http://127.0.0.1:19540/api/companion/poll) + WebView2 callback dispatcher
    /// </summary>
    public sealed class ScreenSyncWindowsCompanion : IDisposable
    {
        public delegate void WinEventDelegate(
            IntPtr hWinEventHook, uint eventType, IntPtr hwnd,
            int idObject, int idChild, uint dwEventThread, uint dwmsEventTime);

        private const uint EVENT_SYSTEM_FOREGROUND = 0x0003;
        private const uint WINEVENT_OUTOFCONTEXT = 0x0000;
        private const uint MONITOR_DEFAULTTONEAREST = 2;
        private const int SW_MINIMIZE = 6;
        private const int SW_FORCEMINIMIZE = 11;
        private const float AUDIO_PEAK_THRESHOLD = 0.001f;

        private static readonly HashSet<string> ChromiumBrowsers = new(StringComparer.OrdinalIgnoreCase)
        {
            "chrome", "msedge", "brave", "opera", "vivaldi", "arc"
        };

        private static readonly HashSet<string> FirefoxBrowsers = new(StringComparer.OrdinalIgnoreCase)
        {
            "firefox"
        };

        [StructLayout(LayoutKind.Sequential)]
        private struct LASTINPUTINFO
        {
            public uint cbSize;
            public uint dwTime;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct RECT
        {
            public int Left, Top, Right, Bottom;
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
        private struct MONITORINFO
        {
            public int cbSize;
            public RECT rcMonitor;
            public RECT rcWork;
            public uint dwFlags;
        }

        [DllImport("user32.dll")]
        private static extern IntPtr SetWinEventHook(
            uint eventMin, uint eventMax, IntPtr hmodWinEventProc,
            WinEventDelegate lpfnWinEventProc, uint idProcess, uint idThread, uint dwFlags);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool UnhookWinEvent(IntPtr hWinEventHook);

        [DllImport("user32.dll")]
        private static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll")]
        private static extern IntPtr GetDesktopWindow();

        [DllImport("user32.dll")]
        private static extern IntPtr GetShellWindow();

        [DllImport("user32.dll")]
        private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);

        [DllImport("user32.dll")]
        private static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

        [DllImport("user32.dll")]
        private static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint dwFlags);

        [DllImport("user32.dll", CharSet = CharSet.Auto)]
        private static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO lpmi);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        private IntPtr _hookId = IntPtr.Zero;
        private readonly WinEventDelegate _hookDelegate;
        private readonly Action<string>? _webViewDispatcher;
        private readonly ConcurrentQueue<Dictionary<string, object?>> _pendingTicks = new();
        private Timer? _pollTimer;
        private HttpListener? _httpBridge;
        private Thread? _httpThread;
        private volatile bool _isSessionLocked;
        private volatile bool _running;

        public ScreenSyncWindowsCompanion(Action<string>? webViewDispatcher = null)
        {
            _webViewDispatcher = webViewDispatcher;
            _hookDelegate = OnWinEventCallback;
        }

        public void Start(int httpPort = 19540)
        {
            if (_running) return;
            _running = true;

            _hookId = SetWinEventHook(
                EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND,
                IntPtr.Zero, _hookDelegate, 0, 0, WINEVENT_OUTOFCONTEXT);

            SystemEvents.SessionSwitch += OnSessionSwitch;
            SystemEvents.PowerModeChanged += OnPowerModeChanged;

            SynthesizeInitialFocus();
            _pollTimer = new Timer(_ => CaptureHeartbeatTick(), null, TimeSpan.FromSeconds(10), TimeSpan.FromSeconds(10));
            StartLocalHttpBridge(httpPort);
        }

        public void Stop()
        {
            _running = false;
            _pollTimer?.Dispose();
            _pollTimer = null;

            SystemEvents.SessionSwitch -= OnSessionSwitch;
            SystemEvents.PowerModeChanged -= OnPowerModeChanged;

            if (_hookId != IntPtr.Zero)
            {
                UnhookWinEvent(_hookId);
                _hookId = IntPtr.Zero;
            }

            try { _httpBridge?.Stop(); } catch { }
        }

        private void OnSessionSwitch(object sender, SessionSwitchEventArgs e)
        {
            if (e.Reason == SessionSwitchReason.SessionLock || e.Reason == SessionSwitchReason.SessionLogoff)
            {
                _isSessionLocked = true;
                EnqueueLifecycleEvent("PAUSE_LOCK");
            }
            else if (e.Reason == SessionSwitchReason.SessionUnlock || e.Reason == SessionSwitchReason.SessionLogon)
            {
                _isSessionLocked = false;
                EnqueueLifecycleEvent("RESUME_UNLOCK");
            }
        }

        private void OnPowerModeChanged(object sender, PowerModeChangedEventArgs e)
        {
            if (e.Mode == PowerModes.Suspend)
            {
                _isSessionLocked = true;
                EnqueueLifecycleEvent("PAUSE_SUSPEND");
            }
            else if (e.Mode == PowerModes.Resume)
            {
                _isSessionLocked = false;
                EnqueueLifecycleEvent("RESUME_WAKE");
            }
        }

        private void EnqueueLifecycleEvent(string lifecycleAction)
        {
            var payload = new Dictionary<string, object?>
            {
                ["lifecycleAction"] = lifecycleAction,
                ["checkTimeMs"] = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
            };
            _pendingTicks.Enqueue(payload);
        }

        public static TimeSpan GetUserIdleTime()
        {
            LASTINPUTINFO info = new() { cbSize = (uint)Marshal.SizeOf<LASTINPUTINFO>() };
            if (!GetLastInputInfo(ref info)) return TimeSpan.Zero;
            uint idleTicks = (uint)Environment.TickCount - info.dwTime;
            return TimeSpan.FromMilliseconds(idleTicks);
        }

        public static bool IsFullscreenAppActive()
        {
            try
            {
                IntPtr fg = GetForegroundWindow();
                if (fg == IntPtr.Zero || fg == GetDesktopWindow() || fg == GetShellWindow())
                    return false;
                if (!GetWindowRect(fg, out RECT winRect))
                    return false;
                IntPtr mon = MonitorFromWindow(fg, MONITOR_DEFAULTTONEAREST);
                MONITORINFO mi = new() { cbSize = Marshal.SizeOf<MONITORINFO>() };
                if (!GetMonitorInfo(mon, ref mi))
                    return false;
                return winRect.Left <= mi.rcMonitor.Left &&
                       winRect.Top <= mi.rcMonitor.Top &&
                       winRect.Right >= mi.rcMonitor.Right &&
                       winRect.Bottom >= mi.rcMonitor.Bottom;
            }
            catch
            {
                return false;
            }
        }

        public static bool IsTrackableWindow(string processName, string className)
            => !string.Equals(processName, "explorer", StringComparison.OrdinalIgnoreCase)
               || className == "CabinetWClass" || className == "ExploreWClass";

        /// <summary>
        /// Queries Windows WASAPI AudioSessionManager for the process currently outputting audio above 0.001f peak.
        /// Mirrors DigitalWellbeingPC AudioDetector.cs.
        /// </summary>
        public static (bool isPlaying, string audioProcessName, float masterPeakValue, float masterVolumeScalar, string deviceName, string deviceType) QueryWasapiAudioState()
        {
            try
            {
                using var enumerator = new MMDeviceEnumerator();
                using var device = enumerator.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
                if (device == null) return (false, string.Empty, 0f, 0f, "Default", "Speakers");

                float devicePeak = device.AudioMeterInformation?.MasterPeakValue ?? 0f;
                float volScalar = device.AudioEndpointVolume?.MasterVolumeLevelScalar ?? 0.5f;
                string devName = device.FriendlyName ?? "Default Audio";
                string devType = devName.Contains("Headphone", StringComparison.OrdinalIgnoreCase) ? "Headphones"
                               : devName.Contains("Headset", StringComparison.OrdinalIgnoreCase) ? "Headsets"
                               : devName.Contains("Earphone", StringComparison.OrdinalIgnoreCase) || devName.Contains("Buds", StringComparison.OrdinalIgnoreCase) ? "Earphones"
                               : "Speakers";

                if (devicePeak <= AUDIO_PEAK_THRESHOLD)
                    return (false, string.Empty, devicePeak, volScalar, devName, devType);

                var sessions = device.AudioSessionManager?.Sessions;
                if (sessions != null)
                {
                    for (int i = 0; i < sessions.Count; i++)
                    {
                        var s = sessions[i];
                        float sPeak = s.AudioMeterInformation?.MasterPeakValue ?? 0f;
                        if (sPeak > AUDIO_PEAK_THRESHOLD)
                        {
                            uint pid = s.GetProcessID;
                            if (pid > 0)
                            {
                                try
                                {
                                    using var p = Process.GetProcessById((int)pid);
                                    return (true, p.ProcessName ?? string.Empty, sPeak, volScalar, devName, devType);
                                }
                                catch { }
                            }
                        }
                    }
                }
                return (true, string.Empty, devicePeak, volScalar, devName, devType);
            }
            catch
            {
                return (false, string.Empty, 0f, 0f, "Default", "Speakers");
            }
        }

        /// <summary>
        /// Reads the active browser tab address bar via Windows UIAutomation (OmniboxViewViews / urlbar-input).
        /// Mirrors DigitalWellbeingPC BrowserTabInspector.cs.
        /// </summary>
        public static string? TryGetBrowserAddressBarText(IntPtr hwnd, string processName)
        {
            if (hwnd == IntPtr.Zero || string.IsNullOrWhiteSpace(processName)) return null;
            string cleanProc = processName.Replace(".exe", "", StringComparison.OrdinalIgnoreCase);
            bool isChromium = ChromiumBrowsers.Contains(cleanProc);
            bool isFirefox = FirefoxBrowsers.Contains(cleanProc);
            if (!isChromium && !isFirefox) return null;

            try
            {
                var uia = new CUIAutomation();
                IUIAutomationElement root = uia.ElementFromHandle(hwnd);
                if (root == null) return null;

                IUIAutomationCondition propCond = isChromium
                    ? uia.CreatePropertyCondition(UIA_PropertyIds.UIA_ClassNamePropertyId, "OmniboxViewViews")
                    : uia.CreatePropertyCondition(UIA_PropertyIds.UIA_AutomationIdPropertyId, "urlbar-input");
                IUIAutomationCondition editCond = uia.CreatePropertyCondition(
                    UIA_PropertyIds.UIA_ControlTypePropertyId, UIA_ControlTypeIds.UIA_EditControlTypeId);
                IUIAutomationCondition combined = uia.CreateAndCondition(editCond, propCond);

                IUIAutomationElement editEl = root.FindFirst(TreeScope.TreeScope_Descendants, combined);
                if (editEl == null) return null;

                object patternObj = editEl.GetCurrentPattern(UIA_PatternIds.UIA_ValuePatternId);
                if (patternObj is IUIAutomationValuePattern valPattern)
                {
                    return valPattern.CurrentValue;
                }
            }
            catch
            {
                // UIA timeout or cross-process refusal
            }
            return null;
        }

        public static bool TryMinimizeWindow(IntPtr hwnd)
        {
            try
            {
                ShowWindow(hwnd, SW_MINIMIZE);
                Thread.Sleep(200);
                if (GetForegroundWindow() == hwnd)
                {
                    ShowWindow(hwnd, SW_FORCEMINIMIZE);
                    Thread.Sleep(200);
                    if (GetForegroundWindow() == hwnd) return false;
                }
                return true;
            }
            catch
            {
                return false;
            }
        }

        private void SynthesizeInitialFocus()
        {
            IntPtr fg = GetForegroundWindow();
            if (fg != IntPtr.Zero)
                InspectAndDispatchForegroundWindow(fg);
        }

        private void CaptureHeartbeatTick()
        {
            if (_isSessionLocked) return;
            IntPtr fg = GetForegroundWindow();
            if (fg != IntPtr.Zero)
                InspectAndDispatchForegroundWindow(fg);
        }

        private void OnWinEventCallback(
            IntPtr hWinEventHook, uint eventType, IntPtr hwnd,
            int idObject, int idChild, uint dwEventThread, uint dwmsEventTime)
        {
            if (hwnd == IntPtr.Zero || _isSessionLocked) return;
            InspectAndDispatchForegroundWindow(hwnd);
        }

        private void InspectAndDispatchForegroundWindow(IntPtr hwnd)
        {
            try
            {
                GetWindowThreadProcessId(hwnd, out uint pid);
                if (pid == 0) return;
                using var proc = Process.GetProcessById((int)pid);
                var classSb = new StringBuilder(256);
                GetClassName(hwnd, classSb, classSb.Capacity);
                string className = classSb.ToString();
                if (!IsTrackableWindow(proc.ProcessName, className))
                    return;

                string rawProcName = proc.ProcessName;
                string winTitle = string.Empty;
                string exePath = string.Empty;
                try { winTitle = proc.MainWindowTitle ?? string.Empty; } catch { }
                try { exePath = proc.MainModule?.FileName ?? string.Empty; } catch { }

                string? rawBrowserUrl = TryGetBrowserAddressBarText(hwnd, rawProcName);
                var audio = QueryWasapiAudioState();

                var payload = new Dictionary<string, object?>
                {
                    ["foregroundProcessName"] = rawProcName,
                    ["foregroundExecutablePath"] = exePath,
                    ["foregroundWindowTitle"] = winTitle, // Evaluated in memory only; never persisted to DB
                    ["foregroundWindowClassName"] = className,
                    ["rawAddressBarText"] = rawBrowserUrl,
                    ["idleSeconds"] = Math.Round(GetUserIdleTime().TotalSeconds, 1),
                    ["isFullscreenAppActive"] = IsFullscreenAppActive(),
                    ["isAudioCurrentlyPlaying"] = audio.isPlaying,
                    ["audioSourceAppKey"] = audio.audioProcessName,
                    ["audioMasterPeakValue"] = Math.Round(audio.masterPeakValue, 4),
                    ["audioVolumeScalar"] = Math.Round(audio.masterVolumeScalar, 4),
                    ["audioDeviceName"] = audio.deviceName,
                    ["audioDeviceType"] = audio.deviceType,
                    ["checkTimeMs"] = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
                };

                _pendingTicks.Enqueue(payload);
                while (_pendingTicks.Count > 120)
                {
                    _pendingTicks.TryDequeue(out _);
                }

                if (_webViewDispatcher != null)
                {
                    string json = JsonSerializer.Serialize(payload);
                    _webViewDispatcher($"if (window.ScreenSyncApp && window.ScreenSyncApp.ingestCompanionTick) {{ window.ScreenSyncApp.ingestCompanionTick({json}); }}");
                }
            }
            catch
            {
                // Fail gracefully if process exited mid-query
            }
        }

        private void StartLocalHttpBridge(int port)
        {
            try
            {
                _httpBridge = new HttpListener();
                _httpBridge.Prefixes.Add($"http://127.0.0.1:{port}/");
                _httpBridge.Start();
                _httpThread = new Thread(() =>
                {
                    while (_running && _httpBridge.IsListening)
                    {
                        try
                        {
                            var ctx = _httpBridge.GetContext();
                            ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*");
                            ctx.Response.Headers.Add("Access-Control-Allow-Methods", "GET, OPTIONS");
                            ctx.Response.Headers.Add("Access-Control-Allow-Headers", "Content-Type");
                            if (ctx.Request.HttpMethod == "OPTIONS")
                            {
                                ctx.Response.StatusCode = 204;
                                ctx.Response.Close();
                                continue;
                            }

                            var batch = new List<Dictionary<string, object?>>();
                            while (_pendingTicks.TryDequeue(out var item))
                            {
                                batch.Add(item);
                            }
                            string respJson = JsonSerializer.Serialize(new Dictionary<string, object?>
                            {
                                ["ok"] = true,
                                ["platform"] = "Windows",
                                ["ticks"] = batch
                            });
                            byte[] buf = Encoding.UTF8.GetBytes(respJson);
                            ctx.Response.ContentType = "application/json";
                            ctx.Response.ContentLength64 = buf.Length;
                            ctx.Response.OutputStream.Write(buf, 0, buf.Length);
                            ctx.Response.Close();
                        }
                        catch
                        {
                            if (!_running) break;
                        }
                    }
                })
                { IsBackground = true };
                _httpThread.Start();
            }
            catch
            {
                // Port in use or restricted; WebView2 dispatcher remains active
            }
        }

        public void Dispose()
        {
            Stop();
        }
    }
}
