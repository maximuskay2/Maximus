/// Typed subset of the Maximus wire protocol (`shared/wire.ts`).
/// Tolerant reader: unknown fields are ignored, missing optionals default.
library;

/// Service endpoint presets, mirroring the desktop picker.
enum EndpointPreset {
  production('https://accounts.maximus.com'),
  local('http://127.0.0.1:8787');

  const EndpointPreset(this.url);
  final String url;
}

/// A paired Maximus server (own machine, VPS, or Cloud).
class ServerRef {
  const ServerRef({
    required this.id,
    required this.name,
    required this.baseUrl,
    this.companionToken,
  });

  final String id;
  final String name;
  final String baseUrl;
  final String? companionToken;

  ServerRef copyWith({
    String? id,
    String? name,
    String? baseUrl,
    String? companionToken,
  }) {
    return ServerRef(
      id: id ?? this.id,
      name: name ?? this.name,
      baseUrl: baseUrl ?? this.baseUrl,
      companionToken: companionToken ?? this.companionToken,
    );
  }

  Map<String, Object?> toJson() => {
    'id': id,
    'name': name,
    'baseUrl': baseUrl,
    'companionToken': companionToken,
  };

  static ServerRef fromJson(Map<String, Object?> json) => ServerRef(
    id: json['id']! as String,
    name: (json['name'] as String?) ?? 'Maximus',
    baseUrl: json['baseUrl']! as String,
    companionToken: json['companionToken'] as String?,
  );
}

class BotSummary {
  const BotSummary({
    required this.id,
    required this.name,
    required this.title,
    required this.description,
    required this.threadId,
    this.mainThreadId,
    required this.notifications,
    required this.color,
    this.avatarUrl,
    required this.unread,
    this.tasks = const [],
    this.soul,
    this.approvalMode,
    this.speakReplies,
    this.replyStyle,
  });

  final String id;
  final String name;
  final String title;
  final String description;
  final String threadId;
  final String? mainThreadId;
  final bool notifications;
  final String color;
  final String? avatarUrl;
  final bool unread;
  final List<ThreadSummary> tasks;

  /// Standing instructions (Phase 7 bot settings).
  final String? soul;

  /// ask/edits/auto/full/custom (Phase 7 bot settings).
  final String? approvalMode;

  /// Spoken replies during calls (Phase 7 bot settings).
  final bool? speakReplies;

  /// default/conversational (Phase 7 bot settings).
  final String? replyStyle;

  static BotSummary fromJson(Map<String, Object?> json) {
    final raw = json['tasks'] as List?;
    return BotSummary(
      id: json['id']! as String,
      name: (json['name'] as String?) ?? '',
      title: (json['title'] as String?) ?? '',
      description: (json['description'] as String?) ?? '',
      threadId: (json['threadId'] as String?) ?? '',
      mainThreadId: json['mainThreadId'] as String?,
      notifications: (json['notifications'] as bool?) ?? true,
      color: (json['color'] as String?) ?? 'ember',
      avatarUrl: json['avatarUrl'] as String?,
      unread: (json['unread'] as bool?) ?? false,
      soul: json['soul'] as String?,
      approvalMode: json['approvalMode'] as String?,
      speakReplies: json['speakReplies'] as bool?,
      replyStyle: json['replyStyle'] as String?,
      tasks: [
        for (final item in raw ?? const [])
          if (item is Map<String, Object?>) ?ThreadSummary.fromJson(item),
      ],
    );
  }

  Map<String, Object?> toJson() => {
    'id': id,
    'name': name,
    'title': title,
    'description': description,
    'threadId': threadId,
    'mainThreadId': mainThreadId,
    'notifications': notifications,
    'color': color,
    'avatarUrl': avatarUrl,
    'unread': unread,
    'soul': soul,
    'approvalMode': approvalMode,
    'speakReplies': speakReplies,
    'replyStyle': replyStyle,
    'tasks': [for (final t in tasks) t.toJson()],
  };
}

/// Thread subset of WireTask (`shared/wire.ts`).
class ThreadSummary {
  const ThreadSummary({
    required this.threadId,
    required this.title,
    required this.createdAt,
    this.updatedAt,
    this.pinned = false,
    this.archived = false,
  });

  final String threadId;
  final String title;
  final int createdAt;
  final int? updatedAt;
  final bool pinned;
  final bool archived;

  static ThreadSummary? fromJson(Map<String, Object?> json) {
    final threadId = json['threadId'] as String?;
    if (threadId == null || threadId.isEmpty) return null;
    return ThreadSummary(
      threadId: threadId,
      title: (json['title'] as String?) ?? 'Untitled',
      createdAt: (json['createdAt'] as num?)?.toInt() ?? 0,
      updatedAt: (json['updatedAt'] as num?)?.toInt(),
      pinned: (json['pinned'] as bool?) ?? false,
      archived: json['archivedAt'] != null,
    );
  }

  Map<String, Object?> toJson() => {
    'threadId': threadId,
    'title': title,
    'createdAt': createdAt,
    'updatedAt': updatedAt,
    'pinned': pinned,
    if (archived) 'archivedAt': 1,
  };
}

class MessageAttachment {
  const MessageAttachment({
    required this.kind,
    required this.path,
    required this.mime,
    this.name,
    this.durationMs,
    this.text,
  });

  /// image | file | audio
  final String kind;
  final String path;
  final String mime;
  final String? name;
  final int? durationMs;
  final String? text;

  static MessageAttachment? fromJson(Map<String, Object?> json) {
    final kind = json['kind'] as String?;
    final path = json['path'] as String?;
    final mime = json['mime'] as String?;
    if (kind == null || path == null || mime == null) return null;
    return MessageAttachment(
      kind: kind,
      path: path,
      mime: mime,
      name: json['name'] as String?,
      durationMs: (json['durationMs'] as num?)?.toInt(),
      text: json['text'] as String?,
    );
  }

  Map<String, Object?> toJson() => {
    'kind': kind,
    'path': path,
    'mime': mime,
    'name': name,
    'durationMs': durationMs,
    'text': text,
  };
}

class ChatMessage {
  const ChatMessage({
    required this.id,
    required this.role,
    required this.kind,
    this.text,
    this.attachments = const [],
    this.reactions = const [],
    this.hasCard = false,
    this.card,
    this.replyToId,
  });

  final String id;
  final String role;
  final String kind;
  final String? text;
  final List<MessageAttachment> attachments;
  final List<MessageReaction> reactions;
  final bool hasCard;

  /// Parsed approval/question card; null when the row carries none.
  final OptionCard? card;
  final String? replyToId;

  /// Activity and in-progress rows often arrive with no visible body.
  bool get blank =>
      (text == null || text!.trim().isEmpty) &&
      attachments.isEmpty &&
      reactions.isEmpty &&
      card == null &&
      !hasCard;

  /// A turn receipt for the bot. The chat shows the reply, not the tool list.
  bool get workLog =>
      kind == 'digest' ||
      kind == 'compaction' ||
      (text?.trimLeft().startsWith('[digest]') ?? false);

  static ChatMessage fromJson(Map<String, Object?> json) {
    final raw = json['attachments'] as List?;
    final rawReactions = json['reactions'] as List?;
    final rawCard = json['card'];
    return ChatMessage(
      id: json['id']! as String,
      role: (json['role'] as String?) ?? 'bot',
      kind: (json['kind'] as String?) ?? 'text',
      text: json['text'] as String?,
      attachments: [
        for (final item in raw ?? const [])
          if (item is Map<String, Object?>) ?MessageAttachment.fromJson(item),
      ],
      reactions: [
        for (final item in rawReactions ?? const [])
          if (item is Map<String, Object?>) ?MessageReaction.fromJson(item),
      ],
      hasCard: rawCard != null,
      card: rawCard is Map<String, Object?>
          ? OptionCard.fromJson(rawCard)
          : null,
      replyToId: json['replyToId'] as String?,
    );
  }

  Map<String, Object?> toJson() => {
    'id': id,
    'role': role,
    'kind': kind,
    'text': text,
    'attachments': [for (final a in attachments) a.toJson()],
    'reactions': [for (final r in reactions) r.toJson()],
    if (card != null) 'card': card!.toJson() else if (hasCard) 'card': const {},
    'replyToId': replyToId,
  };
}

/// Approval/question card subset of `OptionCardData` (`shared/wire.ts`).
class OptionCard {
  const OptionCard({
    required this.title,
    required this.subtitle,
    this.options = const [],
    this.requestType,
    this.requestId,
    this.tool,
    this.answered,
    this.answeredText,
    this.dismissed = false,
    this.expired = false,
    this.stopped = false,
    this.allowSession = false,
    this.fixedOptions = false,
    this.questions = const [],
    this.computerAsk,
  });

  final String title;
  final String subtitle;
  final List<String> options;

  /// permission | question; null on older cards.
  final String? requestType;
  final String? requestId;
  final String? tool;

  /// Settlement state: answered/answeredText/dismissed, or terminal
  /// expired/stopped (nothing can answer those any more).
  final String? answered;
  final String? answeredText;
  final bool dismissed;
  final bool expired;
  final bool stopped;

  /// The provider can remember an allow for the rest of its session.
  final bool allowSession;

  /// The options are the whole answer: no free-text reply.
  final bool fixedOptions;

  /// Structured provider questions (AskUserQuestion shape).
  final List<AskQuestion> questions;

  /// Turn-on-your-computer ask naming the device that must answer.
  final ComputerAsk? computerAsk;

  /// True while the card still takes an answer.
  bool get isLive =>
      requestId != null &&
      !dismissed &&
      !expired &&
      !stopped &&
      answered == null &&
      answeredText == null;

  bool get isPermission => requestType == 'permission';

  /// Local copy marked settled after answering (the server's SSE update
  /// replaces it with the authoritative card shortly after).
  OptionCard settled({
    String? answered,
    String? answeredText,
    bool dismissed = false,
  }) {
    return OptionCard(
      title: title,
      subtitle: subtitle,
      options: options,
      requestType: requestType,
      requestId: requestId,
      tool: tool,
      answered: answered ?? this.answered,
      answeredText: answeredText ?? this.answeredText,
      dismissed: dismissed || this.dismissed,
      expired: expired,
      stopped: stopped,
      allowSession: allowSession,
      fixedOptions: fixedOptions,
      questions: questions,
      computerAsk: computerAsk,
    );
  }

  static OptionCard fromJson(Map<String, Object?> json) {
    final rawOptions = json['options'] as List?;
    final rawQuestions =
        (json['questionRequest'] as Map?)?['questions'] as List?;
    final rawAsk = json['computerAsk'];
    return OptionCard(
      title: (json['title'] as String?) ?? '',
      subtitle: (json['subtitle'] as String?) ?? '',
      options: [
        for (final o in rawOptions ?? const [])
          if (o is String) o,
      ],
      requestType: json['requestType'] as String?,
      requestId: json['requestId'] as String?,
      tool: json['tool'] as String?,
      answered: json['answered'] as String?,
      answeredText: json['answeredText'] as String?,
      dismissed: (json['dismissed'] as bool?) ?? false,
      expired: (json['expired'] as bool?) ?? false,
      stopped: (json['stopped'] as bool?) ?? false,
      allowSession: (json['allowSession'] as bool?) ?? false,
      fixedOptions: (json['fixedOptions'] as bool?) ?? false,
      questions: [
        for (final q in rawQuestions ?? const [])
          if (q is Map<String, Object?>) ?AskQuestion.fromJson(q),
      ],
      computerAsk: rawAsk is Map<String, Object?>
          ? ComputerAsk.fromJson(rawAsk)
          : null,
    );
  }

  Map<String, Object?> toJson() => {
    'title': title,
    'subtitle': subtitle,
    'options': options,
    'requestType': requestType,
    'requestId': requestId,
    'tool': tool,
    'answered': answered,
    'answeredText': answeredText,
    'dismissed': dismissed,
    'expired': expired,
    'stopped': stopped,
    'allowSession': allowSession,
    'fixedOptions': fixedOptions,
    if (questions.isNotEmpty)
      'questionRequest': {
        'version': 1,
        'questions': [for (final q in questions) q.toJson()],
      },
    if (computerAsk != null) 'computerAsk': computerAsk!.toJson(),
  };
}

class AskQuestion {
  const AskQuestion({
    required this.question,
    this.header,
    this.multiSelect = false,
    this.options = const [],
    this.custom = true,
  });

  final String question;
  final String? header;
  final bool multiSelect;
  final List<AskQuestionOption> options;

  /// False when the provider can only take an option back: no free text.
  final bool custom;

  static AskQuestion? fromJson(Map<String, Object?> json) {
    final question = json['question'] as String?;
    if (question == null) return null;
    final rawOptions = json['options'] as List?;
    return AskQuestion(
      question: question,
      header: json['header'] as String?,
      multiSelect: (json['multiSelect'] as bool?) ?? false,
      options: [
        for (final o in rawOptions ?? const [])
          if (o is Map<String, Object?>) ?AskQuestionOption.fromJson(o),
      ],
      custom: (json['custom'] as bool?) ?? true,
    );
  }

  Map<String, Object?> toJson() => {
    'question': question,
    'header': header,
    'multiSelect': multiSelect,
    'options': [for (final o in options) o.toJson()],
    if (!custom) 'custom': false,
  };
}

class AskQuestionOption {
  const AskQuestionOption({required this.label, this.description});

  final String label;
  final String? description;

  static AskQuestionOption? fromJson(Map<String, Object?> json) {
    final label = json['label'] as String?;
    if (label == null) return null;
    return AskQuestionOption(
      label: label,
      description: json['description'] as String?,
    );
  }

  Map<String, Object?> toJson() => {'label': label, 'description': description};
}

/// Turn-on-your-computer ask (`shared/computer-ask.ts`).
class ComputerAsk {
  const ComputerAsk({
    required this.need,
    required this.reason,
    required this.device,
    required this.state,
    this.why,
  });

  /// screen | folders | terminal.
  final String need;

  /// Why the computer can't give what's needed now.
  final String reason;

  /// PC | Mac | computer — the device that must answer.
  final String device;

  /// asking | turning-on | on | failed | declined | ended.
  final String state;
  final String? why;

  static ComputerAsk? fromJson(Map<String, Object?> json) {
    final need = json['need'] as String?;
    final reason = json['reason'] as String?;
    final device = json['device'] as String?;
    final state = json['state'] as String?;
    if (need == null || reason == null || device == null || state == null) {
      return null;
    }
    return ComputerAsk(
      need: need,
      reason: reason,
      device: device,
      state: state,
      why: json['why'] as String?,
    );
  }

  Map<String, Object?> toJson() => {
    'need': need,
    'reason': reason,
    'device': device,
    'state': state,
    'why': why,
  };
}

class MessageReaction {
  const MessageReaction({required this.emoji, required this.by});
  final String emoji;
  final String by;

  static MessageReaction? fromJson(Map<String, Object?> json) {
    final emoji = json['emoji'] as String?;
    final by = json['by'] as String?;
    if (emoji == null || by == null) return null;
    return MessageReaction(emoji: emoji, by: by);
  }

  Map<String, Object?> toJson() => {'emoji': emoji, 'by': by};
}

/// Upload result from POST /api/attachments.
class UploadedAttachment {
  const UploadedAttachment({
    required this.path,
    required this.mime,
    required this.bytes,
  });

  final String path;
  final String mime;
  final int bytes;

  static UploadedAttachment fromJson(Map<String, Object?> json) =>
      UploadedAttachment(
        path: json['path']! as String,
        mime: (json['mime'] as String?) ?? 'application/octet-stream',
        bytes: (json['bytes'] as num?)?.toInt() ?? 0,
      );
}

/// Group/room subset: create + send supported; threads read like bot threads.
class GroupSummary {
  const GroupSummary({
    required this.id,
    required this.name,
    required this.threadId,
    this.memberIds = const [],
  });

  final String id;
  final String name;
  final String threadId;
  final List<String> memberIds;

  static GroupSummary? fromJson(Map<String, Object?> json) {
    final id = json['id'] as String?;
    final threadId = json['threadId'] as String?;
    if (id == null || threadId == null) return null;
    final members = json['memberIds'] as List?;
    return GroupSummary(
      id: id,
      name: (json['name'] as String?) ?? 'Group',
      threadId: threadId,
      memberIds: [for (final m in members ?? const []) '$m'],
    );
  }

  Map<String, Object?> toJson() => {
    'id': id,
    'name': name,
    'threadId': threadId,
    'memberIds': memberIds,
  };
}

/// Push registration state from `GET /v1/installations/self/push`.
class PushStatus {
  const PushStatus({
    required this.enabled,
    required this.configured,
    this.devices = const [],
  });

  /// The global push switch.
  final bool enabled;

  /// False until the server has FCM credentials.
  final bool configured;
  final List<PushDevice> devices;

  static PushStatus fromJson(Map<String, Object?> json) {
    final raw = json['devices'] as List?;
    return PushStatus(
      enabled: (json['enabled'] as bool?) ?? true,
      configured: (json['configured'] as bool?) ?? false,
      devices: [
        for (final item in raw ?? const [])
          if (item is Map<String, Object?>) ?PushDevice.fromJson(item),
      ],
    );
  }
}

class PushDevice {
  const PushDevice({
    required this.platform,
    this.deviceName,
    this.appVersion,
    this.lastSeenAt,
    this.fingerprint,
  });

  final String platform;
  final String? deviceName;
  final String? appVersion;
  final int? lastSeenAt;

  /// Last 8 chars of the token: enough to tell phones apart.
  final String? fingerprint;

  static PushDevice? fromJson(Map<String, Object?> json) {
    final platform = json['platform'] as String?;
    if (platform == null) return null;
    return PushDevice(
      platform: platform,
      deviceName: json['deviceName'] as String?,
      appVersion: json['appVersion'] as String?,
      lastSeenAt: (json['lastSeenAt'] as num?)?.toInt(),
      fingerprint: json['fingerprint'] as String?,
    );
  }
}

/// A live voice call's state (`LiveCallState` in shared/wire.ts).
class LiveCallState {
  const LiveCallState({
    required this.callId,
    required this.botId,
    required this.threadId,
    required this.client,
    required this.voice,
    required this.startedAt,
    required this.status,
    this.endReason,
  });

  final String callId;
  final String botId;
  final String threadId;

  /// desktop | web | ios | android.
  final String client;
  final String voice;
  final int startedAt;

  /// connecting | live | ending | ended | failed.
  final String status;
  final String? endReason;

  static LiveCallState? fromJson(Map<String, Object?> json) {
    final callId = json['callId'] as String?;
    if (callId == null || callId.isEmpty) return null;
    return LiveCallState(
      callId: callId,
      botId: (json['botId'] as String?) ?? '',
      threadId: (json['threadId'] as String?) ?? '',
      client: (json['client'] as String?) ?? '',
      voice: (json['voice'] as String?) ?? '',
      startedAt: (json['startedAt'] as num?)?.toInt() ?? 0,
      status: (json['status'] as String?) ?? '',
      endReason: json['endReason'] as String?,
    );
  }
}

/// A scheduled routine (`Routine` in server/routines.ts), phone subset.
class Routine {
  const Routine({
    required this.id,
    required this.name,
    required this.prompt,
    required this.botId,
    required this.enabled,
    required this.schedule,
    this.nextRunAt,
    this.weekOk,
    this.weekTotal,
    this.warning,
  });

  final String id;
  final String name;
  final String prompt;
  final String botId;
  final bool enabled;

  /// Raw schedule map (type once|daily|cron|interval|limit_reset + fields).
  final Map<String, Object?> schedule;
  final int? nextRunAt;
  final int? weekOk;
  final int? weekTotal;
  final String? warning;

  /// Short human schedule: "Daily 09:00", "Every 30 min", "Once", "Cron".
  String get scheduleSummary {
    final type = schedule['type'] as String?;
    switch (type) {
      case 'daily':
        final time = schedule['time'] as String? ?? '';
        final days = schedule['weekdays'] as List?;
        final dayText = days == null || days.length == 7
            ? ''
            : ' ${_shortDays(days)}';
        return 'Daily $time$dayText'.trim();
      case 'interval':
        final minutes = (schedule['everyMinutes'] as num?)?.toInt() ?? 0;
        if (minutes >= 60 && minutes % 60 == 0) {
          final hours = minutes ~/ 60;
          return 'Every $hours h';
        }
        return 'Every $minutes min';
      case 'once':
        return 'Once';
      case 'cron':
        return 'Cron ${schedule['expression'] ?? schedule['cron'] ?? ''}'
            .trim();
      case 'limit_reset':
        return 'On ${schedule['engine'] ?? 'limit'} reset';
      default:
        return 'Scheduled';
    }
  }

  static String _shortDays(List days) {
    const names = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
    // Server weekdays: 0 = Sunday .. 6 = Saturday.
    const order = [1, 2, 3, 4, 5, 6, 0];
    final set = days.whereType<num>().map((d) => d.toInt()).toSet();
    return [
      for (final d in order)
        if (set.contains(d)) names[d == 0 ? 6 : d - 1],
    ].join();
  }

  static Routine fromJson(Map<String, Object?> json) {
    final week = json['weekRuns'] as Map?;
    return Routine(
      id: (json['id'] as String?) ?? '',
      name: (json['name'] as String?) ?? 'Routine',
      prompt: (json['prompt'] as String?) ?? '',
      botId: (json['botId'] as String?) ?? '',
      enabled: (json['enabled'] as bool?) ?? true,
      schedule: (json['schedule'] as Map?)?.cast<String, Object?>() ?? const {},
      nextRunAt: (json['nextRunAt'] as num?)?.toInt(),
      weekOk: (week?['ok'] as num?)?.toInt(),
      weekTotal: (week?['total'] as num?)?.toInt(),
      warning: json['warning'] as String?,
    );
  }
}

/// One routine run (`RoutineRun`), phone subset.
class RoutineRun {
  const RoutineRun({
    required this.id,
    required this.routineId,
    required this.routineName,
    required this.status,
    required this.scheduledFor,
    this.startedAt,
    this.finishedAt,
    this.output,
    this.manual = false,
  });

  final String id;
  final String routineId;
  final String routineName;

  /// waiting | working | done | failed | skipped | ...
  final String status;
  final int scheduledFor;
  final int? startedAt;
  final int? finishedAt;
  final String? output;
  final bool manual;

  bool get failed => status == 'failed';
  bool get done => status == 'done';

  static RoutineRun fromJson(Map<String, Object?> json) => RoutineRun(
    id: (json['id'] as String?) ?? '',
    routineId: (json['routineId'] as String?) ?? '',
    routineName: (json['routineName'] as String?) ?? '',
    status: (json['status'] as String?) ?? '',
    scheduledFor: (json['scheduledFor'] as num?)?.toInt() ?? 0,
    startedAt: (json['startedAt'] as num?)?.toInt(),
    finishedAt: (json['finishedAt'] as num?)?.toInt(),
    output: json['output'] as String?,
    manual: (json['manual'] as bool?) ?? false,
  );
}

/// One computer from GET /api/computers/frames.
class ComputerInfo {
  const ComputerInfo({
    required this.id,
    required this.name,
    required this.kind,
    this.frame,
    this.frameAt,
    this.working = false,
    this.held = false,
  });

  final String id;
  final String name;

  /// box | team | local...
  final String kind;

  /// Base64 JPEG screenshot when the poll returned a fresh frame.
  final String? frame;
  final int? frameAt;
  final bool working;
  final bool held;

  static ComputerInfo? fromJson(Map<String, Object?> json) {
    final id = json['id'] as String?;
    if (id == null || id.isEmpty) return null;
    final frame = json['frame'] as Map?;
    return ComputerInfo(
      id: id,
      name: (json['name'] as String?) ?? id,
      kind: (json['kind'] as String?) ?? '',
      frame: frame?['data'] as String?,
      frameAt: (frame?['at'] as num?)?.toInt(),
      working: (json['working'] as bool?) ?? false,
      held: (json['held'] as bool?) ?? false,
    );
  }
}

/// A job the server assigned to this phone (device MCP tool call).
class PhoneJob {
  const PhoneJob({
    required this.id,
    required this.tool,
    required this.arguments,
    required this.expiresAt,
  });

  final String id;

  /// PHONE_LIST_EVENTS, PHONE_CREATE_EVENT, ...
  final String tool;
  final Map<String, Object?> arguments;
  final int expiresAt;

  static PhoneJob? fromJson(Map<String, Object?> json) {
    final id = json['id'] as String?;
    final tool = json['tool'] as String?;
    if (id == null || tool == null) return null;
    return PhoneJob(
      id: id,
      tool: tool,
      arguments:
          (json['arguments'] as Map?)?.cast<String, Object?>() ?? const {},
      expiresAt: (json['expiresAt'] as num?)?.toInt() ?? 0,
    );
  }
}

/// A registered phone as the owner UI sees it.
class PublicPhone {
  const PublicPhone({
    required this.key,
    required this.name,
    required this.platform,
    this.appVersion,
    this.online = false,
    this.busy = false,
    this.lastUsedAt,
    this.capabilities = const {},
  });

  final String key;
  final String name;
  final String platform;
  final String? appVersion;
  final bool online;
  final bool busy;
  final int? lastUsedAt;

  /// Capability → OS grant held.
  final Map<String, String> capabilities;

  static PublicPhone? fromJson(Map<String, Object?> json) {
    final key = json['key'] as String?;
    if (key == null) return null;
    final registration = json['registration'] as Map?;
    final caps = registration?['capabilities'] as Map?;
    return PublicPhone(
      key: key,
      name: (registration?['name'] as String?) ?? key,
      platform: (registration?['platform'] as String?) ?? '',
      appVersion: registration?['appVersion'] as String?,
      online: (json['online'] as bool?) ?? false,
      busy: (json['busy'] as bool?) ?? false,
      lastUsedAt: (json['lastUsedAt'] as num?)?.toInt(),
      capabilities: {
        for (final e in (caps ?? const {}).entries)
          if (e.value is String) e.key as String: e.value as String,
      },
    );
  }
}

/// A live event from `/api/events`. Payload shapes vary by kind.
class LiveEvent {
  const LiveEvent({required this.kind, required this.data});
  final String kind;
  final Map<String, Object?> data;
}

/// Pairing code issue response.
class PairingIssue {
  const PairingIssue({required this.code, required this.url});
  final String code;
  final String url;

  static PairingIssue fromJson(Map<String, Object?> json) => PairingIssue(
    code: json['code']! as String,
    url: (json['url'] as String?) ?? '',
  );
}

/// Phase 7: a control-plane workspace membership (mirrors
/// `src/console/account.ts`).
class ConsoleMembership {
  const ConsoleMembership({
    required this.workspace,
    required this.displayName,
    required this.plan,
    required this.status,
    required this.role,
  });

  final String workspace;
  final String displayName;
  final String plan;
  final String status;
  final String role;

  bool get admin => role == 'admin';

  static ConsoleMembership? tryFrom(Object? json) {
    final map = json is Map<String, Object?> ? json : null;
    final workspace = map?['workspace'];
    final role = map?['role'];
    if (workspace is! String || workspace.isEmpty) return null;
    if (role != 'admin' && role != 'member') return null;
    final roleName = role as String;
    return ConsoleMembership(
      workspace: workspace,
      displayName: (map?['displayName'] as String?) ?? workspace,
      plan: (map?['plan'] as String?) ?? 'free',
      status: (map?['status'] as String?) ?? 'active',
      role: roleName,
    );
  }
}

/// Phase 7: a workspace's own record.
class ConsoleWorkspace {
  const ConsoleWorkspace({
    required this.id,
    required this.displayName,
    required this.plan,
    required this.role,
    required this.status,
  });

  final String id;
  final String displayName;
  final String plan;
  final String role;
  final String status;

  static ConsoleWorkspace fromJson(Map<String, Object?> json) =>
      ConsoleWorkspace(
        id: (json['id'] ?? json['workspace'])! as String,
        displayName:
            (json['displayName'] as String?) ??
            (json['id'] as String?) ??
            (json['workspace'] as String?) ??
            '',
        plan: (json['plan'] as String?) ?? 'free',
        role: (json['role'] as String?) ?? 'member',
        status: (json['status'] as String?) ?? 'active',
      );
}

/// Phase 7: a pending workspace invite.
class ConsoleInvite {
  const ConsoleInvite({
    required this.id,
    required this.email,
    required this.role,
    this.expiresAt,
  });

  final String id;
  final String email;
  final String role;
  final int? expiresAt;

  static ConsoleInvite? tryFrom(Object? json) {
    final map = json is Map<String, Object?> ? json : null;
    final id = map?['id'];
    final email = map?['email'];
    if (id is! String || email is! String) return null;
    return ConsoleInvite(
      id: id,
      email: email,
      role: (map?['role'] as String?) ?? 'member',
      expiresAt: (map?['expiresAt'] as num?)?.toInt(),
    );
  }
}

/// Phase 7: one roster row from the seats view.
class WorkspaceMember {
  const WorkspaceMember({
    required this.userId,
    required this.email,
    required this.role,
    this.name,
    this.createdAt,
  });

  final String userId;
  final String email;
  final String role;
  final String? name;
  final int? createdAt;

  static WorkspaceMember? tryFrom(Object? json) {
    final map = json is Map<String, Object?> ? json : null;
    final userId = map?['userId'];
    final email = map?['email'];
    if (userId is! String || email is! String) return null;
    return WorkspaceMember(
      userId: userId,
      email: email,
      role: (map?['role'] as String?) ?? 'member',
      name: map?['name'] as String?,
      createdAt: (map?['createdAt'] as num?)?.toInt(),
    );
  }
}

/// Phase 7: seats view (counts + roster + pending invites).
class WorkspaceSeats {
  const WorkspaceSeats({
    required this.admins,
    required this.members,
    required this.pendingInvites,
    required this.roster,
    required this.invites,
  });

  final int admins;
  final int members;
  final int pendingInvites;
  final List<WorkspaceMember> roster;
  final List<ConsoleInvite> invites;

  static WorkspaceSeats fromJson(Map<String, Object?> json) {
    final seats = json['seats'];
    final map = seats is Map<String, Object?> ? seats : json;
    return WorkspaceSeats(
      admins: (map['admins'] as num?)?.toInt() ?? 0,
      members: (map['members'] as num?)?.toInt() ?? 0,
      pendingInvites: (map['pendingInvites'] as num?)?.toInt() ?? 0,
      roster: [
        for (final row in (map['roster'] as List? ?? const []))
          ?WorkspaceMember.tryFrom(row),
      ],
      invites: [
        for (final row in (map['invites'] as List? ?? const []))
          ?ConsoleInvite.tryFrom(row),
      ],
    );
  }
}

/// Phase 7: month spend vs allowance burn-down.
class WorkspaceSpend {
  const WorkspaceSpend({
    required this.period,
    required this.spent,
    this.allowance,
    this.remaining,
    this.overage = 0,
  });

  final String period;
  final double spent;
  final double? allowance;
  final double? remaining;
  final double overage;

  static double? _num(Object? value) => (value as num?)?.toDouble();

  static WorkspaceSpend fromJson(Map<String, Object?> json) {
    final spend = json['spend'];
    final map = spend is Map<String, Object?> ? spend : json;
    return WorkspaceSpend(
      period: (map['period'] as String?) ?? '',
      spent: _num(map['spent']) ?? 0,
      allowance: _num(map['allowance']),
      remaining: _num(map['remaining']),
      overage: _num(map['overage']) ?? 0,
    );
  }
}

/// Phase 7: one provider's workspace mode (off/byo/bundled).
class WorkspaceProvider {
  const WorkspaceProvider({
    required this.id,
    required this.mode,
    required this.models,
    this.reason,
    this.allowed,
    this.via,
  });

  final String id;
  final String mode;
  final List<String> models;
  final String? reason;
  final bool? allowed;
  final String? via;

  static List<WorkspaceProvider> listFrom(Map<String, Object?> json) {
    final providers = json['providers'];
    final routes = json['routing'];
    final out = <WorkspaceProvider>[];
    if (providers is! Map) return out;
    for (final entry in providers.entries) {
      final id = entry.key;
      if (id is! String || !RegExp(r'^[a-z]+$').hasMatch(id)) continue;
      final record = entry.value is Map
          ? (entry.value as Map).cast<String, Object?>()
          : <String, Object?>{};
      final route = routes is Map && routes[id] is Map
          ? (routes[id] as Map).cast<String, Object?>()
          : <String, Object?>{};
      final mode = record['mode'];
      out.add(
        WorkspaceProvider(
          id: id,
          mode: mode == 'bundled' || mode == 'off' ? mode as String : 'byo',
          models: [
            for (final model in (record['models'] as List? ?? const []))
              if (model is String) model,
          ],
          reason: (route['reason'] as String?)?.isNotEmpty == true
              ? route['reason'] as String?
              : null,
          allowed: routes is Map && routes.containsKey(id)
              ? route['allowed'] == true
              : null,
          via: routes is Map && routes.containsKey(id)
              ? (route['via'] == 'bundled' || route['via'] == 'byo'
                    ? route['via'] as String?
                    : 'off')
              : null,
        ),
      );
    }
    out.sort((a, b) => a.id.compareTo(b.id));
    return out;
  }
}

/// Phase 7: a purchasable plan (public catalog).
class ConsolePlan {
  const ConsolePlan({
    required this.id,
    required this.name,
    required this.blurb,
    required this.baseUsd,
    required this.allowanceUsd,
    this.hardCapUsd,
    required this.entitlements,
    required this.features,
  });

  final String id;
  final String name;
  final String blurb;
  final double baseUsd;
  final double allowanceUsd;
  final double? hardCapUsd;
  final List<String> entitlements;
  final List<String> features;

  static ConsolePlan? tryFrom(Object? json) {
    final map = json is Map<String, Object?> ? json : null;
    final id = map?['id'];
    if (id is! String || id.isEmpty) return null;
    return ConsolePlan(
      id: id,
      name: (map?['name'] as String?) ?? id,
      blurb: (map?['blurb'] as String?) ?? '',
      baseUsd: ((map?['baseUsd'] as num?) ?? 0).toDouble(),
      allowanceUsd: ((map?['allowanceUsd'] as num?) ?? 0).toDouble(),
      hardCapUsd: (map?['hardCapUsd'] as num?)?.toDouble(),
      entitlements: [
        for (final e in (map?['entitlements'] as List? ?? const []))
          if (e is String) e,
      ],
      features: [
        for (final f in (map?['features'] as List? ?? const []))
          if (f is String) f,
      ],
    );
  }
}

/// Phase 7: who this phone is to the server.
class AuthSessionInfo {
  const AuthSessionInfo({
    required this.kind,
    required this.scopes,
    this.id,
    this.label,
    this.email,
    this.expiresAt,
  });

  final String kind;
  final List<String> scopes;
  final String? id;
  final String? label;
  final String? email;
  final int? expiresAt;

  bool get admin => scopes.contains('admin');

  static AuthSessionInfo fromJson(Map<String, Object?> json) => AuthSessionInfo(
    kind: (json['kind'] as String?) ?? 'unknown',
    scopes: [
      for (final s in (json['scopes'] as List? ?? const []))
        if (s is String) s,
    ],
    id: json['id'] as String?,
    label: json['label'] as String?,
    email: json['email'] as String?,
    expiresAt: (json['expiresAt'] as num?)?.toInt(),
  );
}

/// Phase 7: one signed-in device/session on the server.
class DeviceSession {
  const DeviceSession({
    required this.id,
    required this.label,
    required this.scopes,
    this.createdAt,
    this.lastSeenAt,
    this.current = false,
  });

  final String id;
  final String label;
  final List<String> scopes;
  final int? createdAt;
  final int? lastSeenAt;
  final bool current;

  static DeviceSession? tryFrom(Object? json, {String? currentId}) {
    final map = json is Map<String, Object?> ? json : null;
    final id = map?['id'];
    if (id is! String || id.isEmpty) return null;
    return DeviceSession(
      id: id,
      label: (map?['label'] as String?) ?? 'Unnamed device',
      scopes: [
        for (final s in (map?['scopes'] as List? ?? const []))
          if (s is String) s,
      ],
      createdAt: (map?['createdAt'] as num?)?.toInt(),
      lastSeenAt: (map?['lastSeenAt'] as num?)?.toInt(),
      current: currentId != null && id == currentId,
    );
  }
}

/// Phase 7: one usage group (bot/model/day/...) plus the total row.
class UsageGroup {
  const UsageGroup({
    required this.key,
    required this.label,
    required this.turns,
    required this.input,
    required this.output,
    this.costUsd,
    this.estimatedUsd,
    this.billableUsd,
  });

  final String key;
  final String label;
  final int turns;
  final int input;
  final int output;
  final double? costUsd;
  final double? estimatedUsd;
  final double? billableUsd;

  static UsageGroup? tryFrom(Object? json) {
    final map = json is Map<String, Object?> ? json : null;
    final key = map?['key'];
    if (key is! String) return null;
    return UsageGroup(
      key: key,
      label: (map?['label'] as String?) ?? key,
      turns: (map?['turns'] as num?)?.toInt() ?? 0,
      input: (map?['input'] as num?)?.toInt() ?? 0,
      output: (map?['output'] as num?)?.toInt() ?? 0,
      costUsd: (map?['costUsd'] as num?)?.toDouble(),
      estimatedUsd: (map?['estimatedUsd'] as num?)?.toDouble(),
      billableUsd: (map?['billableUsd'] as num?)?.toDouble(),
    );
  }
}

/// Phase 7: a usage report (groups + total + budget when priced).
class UsageReport {
  const UsageReport({
    required this.from,
    required this.to,
    required this.groupBy,
    required this.groups,
    this.total,
    this.currency,
  });

  final String from;
  final String to;
  final String groupBy;
  final List<UsageGroup> groups;
  final UsageGroup? total;
  final String? currency;

  static UsageReport fromJson(Map<String, Object?> json) {
    final groups = [
      for (final row in (json['groups'] as List? ?? const []))
        ?UsageGroup.tryFrom(row),
    ];
    final billing = json['billing'];
    return UsageReport(
      from: (json['from'] as String?) ?? '',
      to: (json['to'] as String?) ?? '',
      groupBy: (json['groupBy'] as String?) ?? 'bot',
      groups: groups,
      total: UsageGroup.tryFrom(json['total']),
      currency: billing is Map<String, Object?>
          ? billing['currency'] as String?
          : null,
    );
  }
}

/// The signed-in Muse wallet. Dollars are provider cost; sparkTokens is the
/// same remainder priced as Spark output.
class RationWallet {
  const RationWallet({
    required this.tier,
    required this.grantedUsd,
    required this.spentUsd,
    required this.leftUsd,
    required this.sparkTokens,
    required this.contributorOffered,
    required this.contributorAccepted,
    required this.priceUsd,
    required this.storePriceUsd,
  });

  final String tier;
  final double grantedUsd;
  final double spentUsd;
  final double leftUsd;
  final int sparkTokens;
  final bool contributorOffered;
  final bool contributorAccepted;
  final double priceUsd;
  final double storePriceUsd;

  static double _num(Object? value) => value is num ? value.toDouble() : 0;

  static RationWallet fromJson(Map<String, Object?> json) {
    return RationWallet(
      tier: (json['tier'] as String?) ?? 'free',
      grantedUsd: _num(json['grantedUsd']),
      spentUsd: _num(json['spentUsd']),
      leftUsd: _num(json['leftUsd']),
      sparkTokens: json['sparkTokens'] is num
          ? (json['sparkTokens'] as num).round()
          : 0,
      contributorOffered: json['contributorOffered'] == true,
      contributorAccepted: json['contributorAccepted'] == true,
      priceUsd: _num(json['priceUsd']),
      storePriceUsd: _num(json['storePriceUsd']),
    );
  }
}

/// Phase 7: the bot computer's (Local VM) status, tolerant of modes
/// that have no VM at all.
class BotComputerStatus {
  const BotComputerStatus({
    required this.available,
    this.state,
    this.detail,
    this.image,
    this.container,
    this.ready = false,
  });

  final bool available;
  final String? state;
  final String? detail;

  /// Whether the Cua desktop image is on the server. Null when the
  /// payload did not say.
  final bool? image;

  /// missing | stopped | running, when the server reported a container.
  final String? container;
  final bool ready;

  static BotComputerStatus fromJson(Map<String, Object?> json) {
    final status = json['status'];
    final map = status is Map<String, Object?> ? status : json;
    final rawAvailable = map['available'];
    final available = rawAvailable is bool
        ? rawAvailable
        // The status answers runtimes (["docker"]); instances answers bool.
        : rawAvailable is List
        ? rawAvailable.isNotEmpty
        : null;
    final ready = map['ready'] == true;
    final container = map['container'];
    final state =
        (map['state'] as String?) ??
        (map['lifecycle'] as String?) ??
        (ready
            ? 'running'
            : container is String
            ? container
            : null);
    return BotComputerStatus(
      available: available ?? state != null,
      state: state,
      image: map['image'] is bool ? map['image'] as bool : null,
      container: container is String ? container : null,
      ready: ready,
      detail:
          (map['problem'] as String?) ??
          (map['desktop_error'] as String?) ??
          (map['message'] as String?) ??
          (map['detail'] as String?),
    );
  }
}

/// Phase 8: a workspace's store subscription (App Store / Play).
class StoreSubscription {
  const StoreSubscription({
    required this.workspace,
    required this.subscribed,
    this.platform,
    this.productId,
    this.plan,
    this.status,
    this.expiresAt,
  });

  final String workspace;
  final bool subscribed;
  final String? platform;
  final String? productId;
  final String? plan;
  final String? status;
  final int? expiresAt;

  static StoreSubscription fromJson(Map<String, Object?> json) {
    final sub = json['subscription'];
    final map = sub is Map<String, Object?> ? sub : json;
    return StoreSubscription(
      workspace: (map['workspace'] as String?) ?? '',
      subscribed: map['subscribed'] == true,
      platform: map['platform'] as String?,
      productId: map['productId'] as String?,
      plan: map['plan'] as String?,
      status: map['status'] as String?,
      expiresAt: (map['expiresAt'] as num?)?.toInt(),
    );
  }
}

/// Phase 8: a verified store purchase (the grant the worker applied).
class StoreGrant {
  const StoreGrant({
    required this.workspace,
    required this.platform,
    required this.plan,
    required this.productId,
    this.expiresAt,
  });

  final String workspace;
  final String platform;
  final String plan;
  final String productId;
  final int? expiresAt;

  static StoreGrant fromJson(Map<String, Object?> json) {
    final sub = json['subscription'];
    final map = sub is Map<String, Object?> ? sub : json;
    return StoreGrant(
      workspace: (map['workspace'] as String?) ?? '',
      platform: (map['platform'] as String?) ?? '',
      plan: (map['plan'] as String?) ?? 'free',
      productId: (map['productId'] as String?) ?? '',
      expiresAt: (map['expiresAt'] as num?)?.toInt(),
    );
  }
}

/// API error with the HTTP status preserved for 401/403/429 mapping.
class ApiError implements Exception {
  const ApiError(this.status, this.message, {this.code, this.details});
  final int status;
  final String message;
  final String? code;

  /// The decoded error body when the server sent JSON (needsKey, ...).
  final Map<String, Object?>? details;

  bool get unauthorized => status == 401;
  bool get forbidden => status == 403;
  bool get rateLimited => status == 429;

  @override
  String toString() =>
      'ApiError($status${code == null ? '' : ' $code'}): $message';
}
