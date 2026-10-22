using System;
using System.Threading;

namespace ScreenSync.Platform.Windows
{
    public static class Program
    {
        [STAThread]
        public static void Main(string[] args)
        {
            int port = 19540;
            if (args.Length > 0 && int.TryParse(args[0], out int customPort))
            {
                port = customPort;
            }

            using var companion = new ScreenSyncWindowsCompanion(js =>
            {
                // Optional stdout log when running standalone outside WebView2
            });
            companion.Start(port);
            Console.WriteLine($"[ScreenSyncWindowsCompanion] Listening on http://127.0.0.1:{port}/api/companion/poll");

            using var quitEvent = new ManualResetEvent(false);
            Console.CancelKeyPress += (_, e) =>
            {
                e.Cancel = true;
                quitEvent.Set();
            };
            quitEvent.WaitOne();
        }
    }
}
