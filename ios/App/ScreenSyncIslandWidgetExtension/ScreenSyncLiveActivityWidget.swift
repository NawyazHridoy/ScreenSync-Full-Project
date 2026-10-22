import Foundation
#if canImport(ActivityKit) && canImport(WidgetKit) && canImport(SwiftUI)
import ActivityKit
import WidgetKit
import SwiftUI

@available(iOS 16.1, *)
public struct ScreenSyncIslandAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        public var reelsText: String
        public var watchTimeText: String
    }
    public var accountId: String
}

@available(iOS 16.1, *)
struct ScreenSyncLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: ScreenSyncIslandAttributes.self) { context in
            HStack {
                Text(context.state.reelsText)
                    .font(.system(size: 13, weight: .heavy))
                    .foregroundColor(.white)
                Spacer()
                Text(context.state.watchTimeText)
                    .font(.system(size: 13, weight: .bold))
                    .foregroundColor(Color(red: 0.20, green: 0.96, blue: 0.65))
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(Color.black)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Text(context.state.reelsText)
                        .font(.system(size: 13, weight: .heavy))
                        .foregroundColor(.white)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(context.state.watchTimeText)
                        .font(.system(size: 13, weight: .bold))
                        .foregroundColor(Color(red: 0.20, green: 0.96, blue: 0.65))
                }
            } compactLeading: {
                Text(context.state.reelsText)
                    .font(.system(size: 12, weight: .heavy))
                    .foregroundColor(.white)
            } compactTrailing: {
                Text(context.state.watchTimeText)
                    .font(.system(size: 12, weight: .bold))
                    .foregroundColor(Color(red: 0.20, green: 0.96, blue: 0.65))
            } minimal: {
                Text(context.state.reelsText)
                    .font(.system(size: 11, weight: .bold))
            }
        }
    }
}
#endif
