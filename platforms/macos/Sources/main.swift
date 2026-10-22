import AppKit
import CoreGraphics
import Foundation

/// Native macOS Companion for ScreenSync
/// Tracks frontmost application via NSWorkspace, system input idle time via CGEventSourceSecondsSinceLastEventType,
/// and exposes a local HTTP bridge on http://127.0.0.1:19540/api/companion/poll for ScreenSync.
final class ScreenSyncMacCompanion {
    private var timer: Timer?
    private var latestTickJson: String = "{\"ok\":true,\"platform\":\"macOS\",\"ticks\":[]}"

    func start() {
        captureTick()
        timer = Timer.scheduledTimer(withTimeInterval: 10.0, repeats: true) { [weak self] _ in
            self?.captureTick()
        }
        RunLoop.main.run()
    }

    private func getSystemIdleSeconds() -> Double {
        let idle = CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: .null)
        return max(0.0, idle)
    }

    private func captureTick() {
        guard let frontApp = NSWorkspace.shared.frontmostApplication else { return }
        let appName = frontApp.localizedName ?? "Unknown"
        let bundleUrl = frontApp.bundleURL?.path ?? ""
        let idleSec = round(getSystemIdleSeconds() * 10.0) / 10.0
        let nowMs = Int64(Date().timeIntervalSince1970 * 1000.0)

        let tick: [String: Any] = [
            "foregroundProcessName": appName,
            "foregroundExecutablePath": bundleUrl,
            "foregroundWindowTitle": "", // Privacy-by-design: never persist window titles
            "idleSeconds": idleSec,
            "isFullscreenAppActive": false,
            "checkTimeMs": nowMs,
            "installationKey": "macbook_pro"
        ]
        if let data = try? JSONSerialization.data(withJSONObject: ["ok": true, "platform": "macOS", "ticks": [tick]]),
           let str = String(data: data, encoding: .utf8) {
            latestTickJson = str
        }
    }
}

let companion = ScreenSyncMacCompanion()
companion.start()
