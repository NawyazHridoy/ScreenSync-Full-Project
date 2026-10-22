import Foundation
#if canImport(DeviceActivity)
import DeviceActivity

@available(iOS 16.0, *)
class ScreenSyncDeviceActivityMonitorExtension: DeviceActivityMonitor {
    private let sharedDefaults = UserDefaults(suiteName: "group.io.screensync.wellness")

    override func intervalDidStart(for activity: DeviceActivityName) {
        super.intervalDidStart(for: activity)
        sharedDefaults?.set(Date().timeIntervalSince1970, forKey: "interval_start_\(activity.rawValue)")
    }

    override func intervalDidEnd(for activity: DeviceActivityName) {
        super.intervalDidEnd(for: activity)
        sharedDefaults?.set(Date().timeIntervalSince1970, forKey: "interval_end_\(activity.rawValue)")
    }

    override func eventDidReachThreshold(_ event: DeviceActivityEvent.Name, activity: DeviceActivityName) {
        super.eventDidReachThreshold(event, activity: activity)
        sharedDefaults?.set(Date().timeIntervalSince1970, forKey: "threshold_reached_\(event.rawValue)")
    }
}
#endif
