import UIKit
import WebKit
import UserNotifications
#if canImport(FamilyControls)
import FamilyControls
#endif
#if canImport(DeviceActivity)
import DeviceActivity
#endif
#if canImport(ActivityKit)
import ActivityKit
#endif

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        let window = UIWindow(frame: UIScreen.main.bounds)
        window.backgroundColor = .black
        window.rootViewController = ScreenSyncViewController()
        window.makeKeyAndVisible()
        self.window = window
        return true
    }
}

class ScreenSyncViewController: UIViewController, WKScriptMessageHandler {
    private var webView: WKWebView!
    private let appGroupSuite = "group.io.screensync.wellness"

    override var prefersStatusBarHidden: Bool {
        return false
    }

    override var preferredStatusBarStyle: UIStatusBarStyle {
        return .lightContent
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black

        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.userContentController.add(self, name: "ScreenSyncNativeBridge")

        // Inject JS adapter so window.ScreenSyncNativeBridge calls work identically on iOS WKWebView and Android WebView
        let bridgePolyfillJs = """
        (function() {
          if (!window.ScreenSyncNativeBridge && window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.ScreenSyncNativeBridge) {
            window.ScreenSyncNativeBridge = {
              openPermissionSettings: function(permId, target, uri) {
                window.webkit.messageHandlers.ScreenSyncNativeBridge.postMessage({
                  action: permId === 'family_controls' ? 'requestFamilyControlsAuthorization'
                        : permId === 'notifications' ? 'requestNotificationAuthorization'
                        : 'openPermissionSettings',
                  permissionId: permId,
                  target: target,
                  uri: uri
                });
              },
              updateCompactPill: function(jsonPayload) {
                window.webkit.messageHandlers.ScreenSyncNativeBridge.postMessage({
                  action: 'updateCompactPill',
                  payload: jsonPayload
                });
              },
              presentSystemGoalAlert: function(jsonPayload) {
                window.webkit.messageHandlers.ScreenSyncNativeBridge.postMessage({
                  action: 'presentSystemGoalAlert',
                  payload: jsonPayload
                });
              }
            };
          }
        })();
        """
        let userScript = WKUserScript(source: bridgePolyfillJs, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        config.userContentController.addUserScript(userScript)

        webView = WKWebView(frame: view.bounds, configuration: config)
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.backgroundColor = .black
        view.addSubview(webView)

        if let indexURL = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "public") {
            webView.loadFileURL(indexURL, allowingReadAccessTo: indexURL.deletingLastPathComponent())
        }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
              let action = body["action"] as? String else {
            return
        }
        if action == "requestFamilyControlsAuthorization" {
            requestScreenTimeAuthorization()
        } else if action == "openPermissionSettings" {
            if let settingsUrl = URL(string: UIApplication.openSettingsURLString),
               UIApplication.shared.canOpenURL(settingsUrl) {
                UIApplication.shared.open(settingsUrl, options: [:], completionHandler: nil)
            }
        } else if action == "requestNotificationAuthorization" {
            UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
                DispatchQueue.main.async {
                    let status = granted ? "GRANTED" : "DENIED"
                    self.webView?.evaluateJavaScript(
                        "if (window.ScreenSyncApp && window.ScreenSyncApp.PermissionOnboardingManager) { window.ScreenSyncApp.PermissionOnboardingManager.onReturnFromSystemSettings('notifications', '\(status)'); }",
                        completionHandler: nil
                    )
                }
            }
        } else if action == "updateCompactPill" {
            if let payloadStr = body["payload"] as? String,
               let sharedDefaults = UserDefaults(suiteName: appGroupSuite) {
                sharedDefaults.set(payloadStr, forKey: "latest_compact_pill_payload")
            }
        }
    }

    private func requestScreenTimeAuthorization() {
        #if canImport(FamilyControls)
        if #available(iOS 16.0, *) {
            Task {
                do {
                    try await AuthorizationCenter.shared.requestAuthorization(for: .individual)
                    DispatchQueue.main.async {
                        self.webView?.evaluateJavaScript(
                            "if (window.ScreenSyncApp && window.ScreenSyncApp.PermissionOnboardingManager) { window.ScreenSyncApp.PermissionOnboardingManager.onReturnFromSystemSettings('family_controls', 'GRANTED'); }",
                            completionHandler: nil
                        )
                    }
                } catch {
                    DispatchQueue.main.async {
                        self.webView?.evaluateJavaScript(
                            "if (window.ScreenSyncApp && window.ScreenSyncApp.PermissionOnboardingManager) { window.ScreenSyncApp.PermissionOnboardingManager.onReturnFromSystemSettings('family_controls', 'DENIED'); }",
                            completionHandler: nil
                        )
                    }
                }
            }
            return
        }
        #endif
        if let settingsUrl = URL(string: UIApplication.openSettingsURLString) {
            UIApplication.shared.open(settingsUrl, options: [:], completionHandler: nil)
        }
    }

    func notifyActivityContext(appKey: String, activityType: String) {
        let js = "if (window.ScreenSyncApp) { window.ScreenSyncApp.handleAutomaticAppContextChange(\"\(appKey)\", \"\(activityType)\", { triggerRender: true, externalOsContext: true }); }"
        webView?.evaluateJavaScript(js, completionHandler: nil)
    }
}
