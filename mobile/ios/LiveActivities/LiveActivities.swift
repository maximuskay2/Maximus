import ActivityKit
import SwiftUI
import WidgetKit

/// Lock-screen + Dynamic Island UI for dictation and voice calls.
struct MaximusLiveActivities: WidgetBundle {
  var body: some Widget {
    MaximusCallActivity()
  }
}

struct MaximusCallActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: MaximusActivityAttributes.self) { context in
      LockScreenView(context: context)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Image(systemName: context.attributes.kind == "call" ? "phone.fill" : "mic.fill")
            .foregroundStyle(.orange)
        }
        DynamicIslandExpandedRegion(.trailing) {
          Text(elapsed(context.state.elapsedSeconds))
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        DynamicIslandExpandedRegion(.center) {
          Text(context.attributes.botName).font(.headline)
        }
        DynamicIslandExpandedRegion(.bottom) {
          Text(context.state.caption).font(.caption).lineLimit(2)
        }
      } compactLeading: {
        Image(systemName: context.attributes.kind == "call" ? "phone.fill" : "mic.fill")
          .foregroundStyle(.orange)
      } compactTrailing: {
        Text(shortStatus(context.state.status))
          .font(.caption2)
      } minimal: {
        Image(systemName: context.attributes.kind == "call" ? "phone.fill" : "mic.fill")
          .foregroundStyle(.orange)
      }
    }
  }

  private func shortStatus(_ status: String) -> String {
    switch status {
    case "listening": return "Listening"
    case "thinking": return "Thinking"
    case "speaking": return "Speaking"
    case "connecting": return "Calling"
    case "muted": return "Muted"
    default: return "Live"
    }
  }

  private func elapsed(_ seconds: Int) -> String {
    String(format: "%d:%02d", seconds / 60, seconds % 60)
  }
}

private struct LockScreenView: View {
  let context: ActivityViewContext<MaximusActivityAttributes>

  var body: some View {
    HStack(spacing: 12) {
      Image(systemName: context.attributes.kind == "call" ? "phone.fill" : "mic.fill")
        .font(.title2)
        .foregroundStyle(.orange)
        .frame(width: 44, height: 44)
        .background(.orange.opacity(0.15))
        .clipShape(Circle())
      VStack(alignment: .leading, spacing: 2) {
        Text(context.attributes.botName).font(.headline)
        Text(context.state.caption).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
      }
      Spacer()
      VStack(alignment: .trailing, spacing: 2) {
        Text(shortStatus(context.state.status)).font(.caption).foregroundStyle(.secondary)
        Text(elapsed(context.state.elapsedSeconds)).font(.caption).monospacedDigit()
      }
    }
    .padding()
    .activityBackgroundTint(Color(red: 0.98, green: 0.95, blue: 0.90))
  }

  private func shortStatus(_ status: String) -> String {
    switch status {
    case "listening": return "Listening"
    case "thinking": return "Thinking"
    case "speaking": return "Speaking"
    case "connecting": return "Calling"
    case "muted": return "Muted"
    default: return "Live"
    }
  }

  private func elapsed(_ seconds: Int) -> String {
    String(format: "%d:%02d", seconds / 60, seconds % 60)
  }
}
