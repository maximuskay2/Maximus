import ActivityKit
import Flutter
import UIKit

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  private var liveChannel: FlutterMethodChannel?
  private var activity: Activity<MaximusActivityAttributes>?

  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  private let phoneApps = PhoneAppsChannel()

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
    let messenger = engineBridge.applicationRegistrar.messenger()
    let channel = FlutterMethodChannel(
      name: "maximus/live_activities",
      binaryMessenger: messenger
    )
    channel.setMethodCallHandler(handleLiveCall)
    liveChannel = channel
    phoneApps.register(messenger: messenger)
  }

  private func handleLiveCall(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
    switch call.method {
    case "start":
      guard let args = call.arguments as? [String: Any],
        let kind = args["kind"] as? String,
        let botName = args["botName"] as? String
      else { result(FlutterError(code: "bad_args", message: nil, details: nil)); return }
      let caption = args["caption"] as? String ?? ""
      startLiveActivity(kind: kind, botName: botName, caption: caption, result: result)
    case "update":
      guard let args = call.arguments as? [String: Any] else {
        result(FlutterError(code: "bad_args", message: nil, details: nil)); return
      }
      updateLiveActivity(
        status: args["status"] as? String,
        caption: args["caption"] as? String,
        elapsedSeconds: args["elapsedSeconds"] as? Int,
        result: result
      )
    case "end":
      endLiveActivity(result: result)
    case "syncBots":
      guard let args = call.arguments as? [String: Any],
        let bots = args["bots"] as? [[String]]
      else { result(FlutterError(code: "bad_args", message: nil, details: nil)); return }
      if let data = try? JSONEncoder().encode(bots) {
        MaximusSharedDefaults.suite?.set(data, forKey: MaximusSharedDefaults.botsKey)
      }
      result(true)
    default:
      result(FlutterMethodNotImplemented)
    }
  }

  private func startLiveActivity(kind: String, botName: String, caption: String, result: @escaping FlutterResult) {
    if #available(iOS 16.2, *) {
      guard ActivityAuthorizationInfo().areActivitiesEnabled else { result(false); return }
      // End any previous activity inline: endLiveActivity nils
      // self.activity asynchronously, which would wipe the new one.
      if let old = activity {
        activity = nil
        Task { await old.end(nil, dismissalPolicy: .immediate) }
      }
      let attributes = MaximusActivityAttributes(kind: kind, botName: botName)
      let state = MaximusActivityAttributes.ContentState(status: "live", caption: caption, elapsedSeconds: 0)
      do {
        activity = try Activity.request(
          attributes: attributes,
          content: .init(state: state, staleDate: nil),
        )
        result(true)
      } catch {
        result(false)
      }
    } else {
      result(false)
    }
  }

  private func updateLiveActivity(status: String?, caption: String?, elapsedSeconds: Int?, result: @escaping FlutterResult) {
    guard let activity else { result(false); return }
    if #available(iOS 16.2, *) {
      Task {
        var state = activity.content.state
        if let status { state.status = status }
        if let caption { state.caption = caption }
        if let elapsedSeconds { state.elapsedSeconds = elapsedSeconds }
        await activity.update(.init(state: state, staleDate: nil))
        result(true)
      }
    } else {
      result(false)
    }
  }

  private func endLiveActivity(result: @escaping FlutterResult) {
    guard let activity else { result(true); return }
    if #available(iOS 16.2, *) {
      Task {
        await activity.end(nil, dismissalPolicy: .immediate)
        self.activity = nil
        result(true)
      }
    } else {
      self.activity = nil
      result(true)
    }
  }
}
