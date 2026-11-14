import EventKit
import Flutter
import HomeKit
import UIKit
import UserNotifications

/// MethodChannel maximus/phone_apps — reminders (EventKit), alarms (local
/// notifications), and HomeKit accessories when the OS allows them.
final class PhoneAppsChannel: NSObject, HMHomeManagerDelegate {
  static let name = "maximus/phone_apps"

  private let eventStore = EKEventStore()
  private lazy var homeManager: HMHomeManager = {
    let manager = HMHomeManager()
    manager.delegate = self
    return manager
  }()
  private var homeReady = false
  private var homeWaiters: [(FlutterResult)] = []

  func register(messenger: FlutterBinaryMessenger) {
    let channel = FlutterMethodChannel(name: Self.name, binaryMessenger: messenger)
    channel.setMethodCallHandler(handle)
    _ = homeManager
  }

  private func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
    switch call.method {
    case "reminders.permission":
      result(remindersAuthStatus())
    case "reminders.requestPermission":
      requestRemindersPermission(result)
    case "reminders.list":
      listReminders(call.arguments as? [String: Any], result)
    case "reminders.create":
      createReminder(call.arguments as? [String: Any], result)
    case "reminders.update":
      updateReminder(call.arguments as? [String: Any], result)
    case "reminders.complete":
      completeReminder(call.arguments as? [String: Any], result)
    case "reminders.delete":
      deleteReminder(call.arguments as? [String: Any], result)
    case "alarms.permission":
      UNUserNotificationCenter.current().getNotificationSettings { settings in
        DispatchQueue.main.async {
          switch settings.authorizationStatus {
          case .authorized, .provisional, .ephemeral: result("granted")
          case .denied: result("denied")
          default: result("undetermined")
          }
        }
      }
    case "alarms.requestPermission":
      UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { ok, _ in
        DispatchQueue.main.async { result(ok ? "granted" : "denied") }
      }
    case "alarms.create":
      createAlarm(call.arguments as? [String: Any], result)
    case "alarms.list":
      listAlarms(result)
    case "alarms.delete":
      deleteAlarm(call.arguments as? [String: Any], result)
    case "home.permission":
      whenHomesReady {
        result(self.homeManager.homes.isEmpty ? "undetermined" : "granted")
      }
    case "home.requestPermission":
      whenHomesReady {
        result(self.homeManager.homes.isEmpty ? "denied" : "granted")
      }
    case "home.list":
      whenHomesReady { self.listHome(result) }
    case "home.setAccessory":
      whenHomesReady { self.setAccessory(call.arguments as? [String: Any], result) }
    case "home.runScene":
      whenHomesReady { self.runScene(call.arguments as? [String: Any], result) }
    default:
      result(FlutterMethodNotImplemented)
    }
  }

  func homeManagerDidUpdateHomes(_ manager: HMHomeManager) {
    homeReady = true
    let waiters = homeWaiters
    homeWaiters.removeAll()
    waiters.forEach { $0(nil) }
  }

  private func whenHomesReady(_ body: @escaping () -> Void) {
    if homeReady {
      body()
      return
    }
    homeWaiters.append { _ in body() }
    // Trigger HomeKit entitlement probe.
    _ = homeManager.homes
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
      if !self.homeReady {
        self.homeReady = true
        let waiters = self.homeWaiters
        self.homeWaiters.removeAll()
        waiters.forEach { $0(nil) }
      }
    }
  }

  // MARK: - Reminders

  private func remindersAuthStatus() -> String {
    let status: EKAuthorizationStatus
    if #available(iOS 17.0, *) {
      status = EKEventStore.authorizationStatus(for: .reminder)
    } else {
      status = EKEventStore.authorizationStatus(for: .reminder)
    }
    switch status {
    case .fullAccess, .authorized: return "granted"
    case .denied, .restricted: return "denied"
    case .writeOnly: return "granted"
    default: return "undetermined"
    }
  }

  private func requestRemindersPermission(_ result: @escaping FlutterResult) {
    let finish: (Bool, Error?) -> Void = { ok, _ in
      DispatchQueue.main.async { result(ok ? "granted" : "denied") }
    }
    if #available(iOS 17.0, *) {
      eventStore.requestFullAccessToReminders(completion: finish)
    } else {
      eventStore.requestAccess(to: .reminder, completion: finish)
    }
  }

  private func listReminders(_ args: [String: Any]?, _ result: @escaping FlutterResult) {
    let predicate = eventStore.predicateForReminders(in: nil)
    eventStore.fetchReminders(matching: predicate) { reminders in
      let completed = (args?["completed"] as? Bool) ?? false
      let listName = (args?["list"] as? String)?.lowercased()
      let from = Self.parseDate(args?["from"])
      let to = Self.parseDate(args?["to"])
      let rows: [[String: Any]] = (reminders ?? []).compactMap { reminder in
        if reminder.isCompleted != completed { return nil }
        if let listName, reminder.calendar.title.lowercased() != listName { return nil }
        if let due = reminder.dueDateComponents?.date {
          if let from, due < from { return nil }
          if let to, due > to { return nil }
        } else if from != nil || to != nil {
          return nil
        }
        var row: [String: Any] = [
          "id": reminder.calendarItemIdentifier,
          "title": reminder.title ?? "",
          "completed": reminder.isCompleted,
          "list": reminder.calendar.title,
        ]
        if let due = reminder.dueDateComponents?.date {
          row["due"] = ISO8601DateFormatter().string(from: due)
        }
        if let notes = reminder.notes, !notes.isEmpty { row["notes"] = notes }
        return row
      }
      DispatchQueue.main.async { result(rows) }
    }
  }

  private func createReminder(_ args: [String: Any]?, _ result: @escaping FlutterResult) {
    guard let title = args?["title"] as? String, !title.isEmpty else {
      result(FlutterError(code: "bad_args", message: "title required", details: nil)); return
    }
    let reminder = EKReminder(eventStore: eventStore)
    reminder.title = title
    reminder.notes = args?["notes"] as? String
    reminder.calendar = reminderCalendar(named: args?["list"] as? String)
    if let due = Self.parseDate(args?["due"]) {
      reminder.dueDateComponents = Calendar.current.dateComponents(
        [.year, .month, .day, .hour, .minute], from: due)
      reminder.addAlarm(EKAlarm(absoluteDate: due))
    }
    do {
      try eventStore.save(reminder, commit: true)
      result(reminder.calendarItemIdentifier)
    } catch {
      result(FlutterError(code: "save_failed", message: error.localizedDescription, details: nil))
    }
  }

  private func updateReminder(_ args: [String: Any]?, _ result: @escaping FlutterResult) {
    guard let id = args?["id"] as? String,
      let reminder = eventStore.calendarItem(withIdentifier: id) as? EKReminder
    else {
      result(false); return
    }
    if let title = args?["title"] as? String { reminder.title = title }
    if let notes = args?["notes"] as? String { reminder.notes = notes }
    if let due = Self.parseDate(args?["due"]) {
      reminder.dueDateComponents = Calendar.current.dateComponents(
        [.year, .month, .day, .hour, .minute], from: due)
    }
    do {
      try eventStore.save(reminder, commit: true)
      result(true)
    } catch {
      result(false)
    }
  }

  private func completeReminder(_ args: [String: Any]?, _ result: @escaping FlutterResult) {
    guard let id = args?["id"] as? String,
      let reminder = eventStore.calendarItem(withIdentifier: id) as? EKReminder
    else {
      result(false); return
    }
    reminder.isCompleted = true
    do {
      try eventStore.save(reminder, commit: true)
      result(true)
    } catch {
      result(false)
    }
  }

  private func deleteReminder(_ args: [String: Any]?, _ result: @escaping FlutterResult) {
    guard let id = args?["id"] as? String,
      let reminder = eventStore.calendarItem(withIdentifier: id) as? EKReminder
    else {
      result(false); return
    }
    do {
      try eventStore.remove(reminder, commit: true)
      result(true)
    } catch {
      result(false)
    }
  }

  private func reminderCalendar(named name: String?) -> EKCalendar {
    if let name {
      let match = eventStore.calendars(for: .reminder)
        .first { $0.title.caseInsensitiveCompare(name) == .orderedSame }
      if let match { return match }
    }
    return eventStore.defaultCalendarForNewReminders()
      ?? eventStore.calendars(for: .reminder).first
      ?? {
        let calendar = EKCalendar(for: .reminder, eventStore: eventStore)
        calendar.title = "Reminders"
        calendar.source = eventStore.sources.first { $0.sourceType == .local }
          ?? eventStore.sources.first
        try? eventStore.saveCalendar(calendar, commit: true)
        return calendar
      }()
  }

  // MARK: - Alarms (local notifications)

  private func createAlarm(_ args: [String: Any]?, _ result: @escaping FlutterResult) {
    guard let when = Self.parseDate(args?["at"] ?? args?["due"]),
      let title = args?["title"] as? String, !title.isEmpty
    else {
      result(FlutterError(code: "bad_args", message: "title and at required", details: nil)); return
    }
    let id = (args?["id"] as? String) ?? UUID().uuidString
    let content = UNMutableNotificationContent()
    content.title = title
    content.body = (args?["notes"] as? String) ?? "Alarm"
    content.sound = .default
    let comps = Calendar.current.dateComponents(
      [.year, .month, .day, .hour, .minute, .second], from: when)
    let trigger = UNCalendarNotificationTrigger(dateMatching: comps, repeats: false)
    let request = UNNotificationRequest(identifier: "alarm.\(id)", content: content, trigger: trigger)
    UNUserNotificationCenter.current().add(request) { error in
      DispatchQueue.main.async {
        if let error {
          result(FlutterError(code: "save_failed", message: error.localizedDescription, details: nil))
        } else {
          result(id)
        }
      }
    }
  }

  private func listAlarms(_ result: @escaping FlutterResult) {
    UNUserNotificationCenter.current().getPendingNotificationRequests { requests in
      let rows: [[String: Any]] = requests.compactMap { request in
        guard request.identifier.hasPrefix("alarm.") else { return nil }
        let id = String(request.identifier.dropFirst("alarm.".count))
        var row: [String: Any] = [
          "id": id,
          "title": request.content.title,
        ]
        if let trigger = request.trigger as? UNCalendarNotificationTrigger,
          let next = trigger.nextTriggerDate()
        {
          row["at"] = ISO8601DateFormatter().string(from: next)
        }
        return row
      }
      DispatchQueue.main.async { result(rows) }
    }
  }

  private func deleteAlarm(_ args: [String: Any]?, _ result: @escaping FlutterResult) {
    guard let id = args?["id"] as? String else { result(false); return }
    UNUserNotificationCenter.current()
      .removePendingNotificationRequests(withIdentifiers: ["alarm.\(id)"])
    result(true)
  }

  // MARK: - HomeKit

  private func listHome(_ result: @escaping FlutterResult) {
    let homes = homeManager.homes.map { home -> [String: Any] in
      let accessories = home.accessories.map { accessory -> [String: Any] in
        [
          "id": accessory.uniqueIdentifier.uuidString,
          "name": accessory.name,
          "room": accessory.room?.name ?? "",
          "on": accessory.services
            .flatMap(\.characteristics)
            .first { $0.characteristicType == HMCharacteristicTypePowerState }?
            .value as? Bool ?? false,
        ]
      }
      let scenes = home.actionSets.map {
        ["id": $0.uniqueIdentifier.uuidString, "name": $0.name]
      }
      return [
        "id": home.uniqueIdentifier.uuidString,
        "name": home.name,
        "accessories": accessories,
        "scenes": scenes,
      ]
    }
    result(["homes": homes])
  }

  private func setAccessory(_ args: [String: Any]?, _ result: @escaping FlutterResult) {
    guard let id = (args?["accessoryId"] as? String) ?? (args?["id"] as? String) else {
      result(FlutterError(code: "bad_args", message: "accessoryId required", details: nil)); return
    }
    let characteristicName = ((args?["characteristic"] as? String) ?? "power").lowercased()
    let value = args?["value"]
    guard let accessory = homeManager.homes.flatMap(\.accessories)
      .first(where: { $0.uniqueIdentifier.uuidString == id })
    else {
      result(FlutterError(code: "not_found", message: "No such accessory.", details: nil)); return
    }
    let type: String
    switch characteristicName {
    case "power", "on", "powerstate": type = HMCharacteristicTypePowerState
    case "brightness": type = HMCharacteristicTypeBrightness
    case "targettemperature", "temperature": type = HMCharacteristicTypeTargetTemperature
    default:
      result(FlutterError(code: "unsupported", message: "Unknown characteristic.", details: nil)); return
    }
    guard let characteristic = accessory.services.flatMap(\.characteristics)
      .first(where: { $0.characteristicType == type })
    else {
      result(FlutterError(code: "not_found", message: "No such characteristic.", details: nil)); return
    }
    characteristic.writeValue(value ?? false) { error in
      DispatchQueue.main.async {
        if let error {
          result(FlutterError(code: "write_failed", message: error.localizedDescription, details: nil))
        } else {
          result(true)
        }
      }
    }
  }

  private func runScene(_ args: [String: Any]?, _ result: @escaping FlutterResult) {
    guard let id = (args?["sceneId"] as? String) ?? (args?["id"] as? String) else {
      result(FlutterError(code: "bad_args", message: "sceneId required", details: nil)); return
    }
    guard let scene = homeManager.homes.flatMap(\.actionSets)
      .first(where: { $0.uniqueIdentifier.uuidString == id }),
      let home = homeManager.homes.first(where: { $0.actionSets.contains(scene) })
    else {
      result(FlutterError(code: "not_found", message: "No such scene.", details: nil)); return
    }
    home.executeActionSet(scene) { error in
      DispatchQueue.main.async {
        if let error {
          result(FlutterError(code: "run_failed", message: error.localizedDescription, details: nil))
        } else {
          result(true)
        }
      }
    }
  }

  private static func parseDate(_ value: Any?) -> Date? {
    guard let text = value as? String else { return nil }
    let iso = ISO8601DateFormatter()
    iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = iso.date(from: text) { return date }
    iso.formatOptions = [.withInternetDateTime]
    return iso.date(from: text)
  }
}
