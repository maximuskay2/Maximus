import AppIntents
import Foundation

/// A bot Siri can address. Suggestions come from the App Group list the
/// Flutter side syncs; without the group the user names the bot freely.
struct BotEntity: AppEntity {
  var id: String
  var name: String

  static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Bot")
  static var defaultQuery = BotQuery()

  var displayRepresentation: DisplayRepresentation {
    DisplayRepresentation(title: "\(name)")
  }
}

struct BotQuery: EntityQuery {
  func entities(for identifiers: [BotEntity.ID]) async throws -> [BotEntity] {
    allBots().filter { identifiers.contains($0.id) }
  }

  func suggestedEntities() async throws -> [BotEntity] {
    allBots()
  }

  func defaultResult() async -> BotEntity? {
    allBots().first
  }

  private func allBots() -> [BotEntity] {
    guard
      let data = MaximusSharedDefaults.suite?.data(forKey: MaximusSharedDefaults.botsKey),
      let list = try? JSONDecoder().decode([[String]].self, from: data)
    else { return [] }
    return list.compactMap { pair in
      guard pair.count >= 2 else { return nil }
      return BotEntity(id: pair[0], name: pair[1])
    }
  }
}

private func maximusURL(_ path: String, query: [String: String] = [:]) -> URL {
  var parts = URLComponents()
  parts.scheme = "maximus"
  parts.host = path
  if !query.isEmpty {
    parts.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
  }
  return parts.url!
}

struct ListBotsIntent: AppIntent {
  static var title: LocalizedStringResource = "List my bots"
  static var description = IntentDescription("Opens Maximus on the bots list.")

  func perform() async throws -> some IntentResult & OpensIntent {
    .result(opensIntent: OpenURLIntent(maximusURL("bots")))
  }
}

struct SendMessageIntent: AppIntent {
  static var title: LocalizedStringResource = "Send a bot message"
  static var description = IntentDescription("Opens a bot thread with the message ready to send.")

  @Parameter(title: "Bot")
  var bot: BotEntity?

  @Parameter(title: "Message")
  var message: String

  static var parameterSummary: some ParameterSummary {
    Summary("Send \(\.$message) to \(\.$bot)")
  }

  func perform() async throws -> some IntentResult & OpensIntent {
    var query = ["text": message]
    if let bot { query["bot"] = bot.name }
    return .result(opensIntent: OpenURLIntent(maximusURL("thread", query: query)))
  }
}

struct DictateIntent: AppIntent {
  static var title: LocalizedStringResource = "Dictate to a bot"
  static var description = IntentDescription("Opens Maximus listening for dictation.")

  @Parameter(title: "Bot")
  var bot: BotEntity?

  static var parameterSummary: some ParameterSummary {
    Summary("Dictate to \(\.$bot)")
  }

  func perform() async throws -> some IntentResult & OpensIntent {
    var query: [String: String] = [:]
    if let bot { query["bot"] = bot.name }
    return .result(opensIntent: OpenURLIntent(maximusURL("dictate", query: query)))
  }
}

struct VoiceChatIntent: AppIntent {
  static var title: LocalizedStringResource = "Start a voice chat"
  static var description = IntentDescription("Opens a live voice call with a bot.")

  @Parameter(title: "Bot")
  var bot: BotEntity?

  static var parameterSummary: some ParameterSummary {
    Summary("Talk to \(\.$bot)")
  }

  func perform() async throws -> some IntentResult & OpensIntent {
    var query: [String: String] = [:]
    if let bot { query["bot"] = bot.name }
    return .result(opensIntent: OpenURLIntent(maximusURL("call", query: query)))
  }
}

/// Shortcuts phrases (also assignable to the Action button).
struct MaximusShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: ListBotsIntent(),
      phrases: ["List my bots with \(.applicationName)", "Show my \(.applicationName) bots"],
      shortTitle: "List bots",
      systemImageName: "list.bullet"
    )
    AppShortcut(
      intent: SendMessageIntent(),
      phrases: ["Send a message with \(.applicationName)", "Ask \(.applicationName) to send a message"],
      shortTitle: "Send message",
      systemImageName: "paperplane"
    )
    AppShortcut(
      intent: DictateIntent(),
      phrases: ["Dictate with \(.applicationName)", "Take dictation with \(.applicationName)"],
      shortTitle: "Dictate",
      systemImageName: "mic"
    )
    AppShortcut(
      intent: VoiceChatIntent(),
      phrases: ["Talk to \(.applicationName)", "Start a voice chat with \(.applicationName)"],
      shortTitle: "Voice chat",
      systemImageName: "phone"
    )
  }
}
