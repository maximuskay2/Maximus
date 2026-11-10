import ActivityKit
import Foundation

/// Shared Live Activity contract (Runner + widget extension): one
/// activity per dictation or voice call, keyed by bot.
public struct MaximusActivityAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    /// listening | thinking | speaking | live
    public var status: String
    /// Live caption line (partial transcript, call state).
    public var caption: String
    /// Seconds since the activity started.
    public var elapsedSeconds: Int

    public init(status: String, caption: String, elapsedSeconds: Int) {
      self.status = status
      self.caption = caption
      self.elapsedSeconds = elapsedSeconds
    }
  }

  /// dictate | call
  public var kind: String
  public var botName: String

  public init(kind: String, botName: String) {
    self.kind = kind
    self.botName = botName
  }
}

/// App Group suite for bots shared with Siri. Nil when the group is
/// unavailable (unsigned builds), in which case Siri falls back to
/// free-text bot names.
public enum MaximusSharedDefaults {
  public static let suiteName = "group.com.maximus.app"
  public static let botsKey = "siri.bots.v1"

  public static var suite: UserDefaults? {
    UserDefaults(suiteName: suiteName)
  }
}
