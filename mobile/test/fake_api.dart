import 'dart:async';
import 'dart:typed_data';

import 'package:flutter_secure_storage_platform_interface/flutter_secure_storage_platform_interface.dart';

import 'package:maximus/api/client.dart';
import 'package:maximus/api/models.dart';

/// Scripted API fake (widget tests can't use real sockets).

/// In-memory secure-storage platform for tests. Widget tests must use
/// this: the real platform's method channel never answers in
/// `flutter_tester`, so an unmocked write hangs forever (it only throws
/// MissingPluginException in plain unit tests).
class FakeSecureStoragePlatform extends FlutterSecureStoragePlatform {
  final store = <String, String>{};

  static FakeSecureStoragePlatform install() {
    final fake = FakeSecureStoragePlatform();
    FlutterSecureStoragePlatform.instance = fake;
    return fake;
  }

  @override
  Future<void> write({
    required String key,
    required String value,
    required Map<String, String> options,
  }) async {
    store[key] = value;
  }

  @override
  Future<String?> read({
    required String key,
    required Map<String, String> options,
  }) async => store[key];

  @override
  Future<bool> containsKey({
    required String key,
    required Map<String, String> options,
  }) async => store.containsKey(key);

  @override
  Future<void> delete({
    required String key,
    required Map<String, String> options,
  }) async {
    store.remove(key);
  }

  @override
  Future<Map<String, String>> readAll({
    required Map<String, String> options,
  }) async => {...store};

  @override
  Future<void> deleteAll({
    required Map<String, String> options,
  }) async {
    store.clear();
  }
}

class FakeApi implements MaximusApi {
  FakeApi({this.failBots = false, this.unauthorizedBots = false, this.forbiddenBots = false});

  final bool failBots;
  final bool unauthorizedBots;
  final bool forbiddenBots;
  final List<Map<String, Object?>> patches = [];

  static final botsPayload = [
    BotSummary.fromJson({
      'id': 'b1', 'name': 'Max', 'title': 'Helper',
      'description': 'Does things', 'threadId': 't1',
      'notifications': true, 'color': 'ember', 'avatarUrl': null,
      'unread': true,
      'tasks': [
        {
          'threadId': 't1', 'title': 'Morning brief',
          'createdAt': 1000, 'updatedAt': 2000,
        },
        {
          'threadId': 't2', 'title': 'Pinned plan',
          'createdAt': 500, 'pinned': true,
        },
      ],
    }),
    BotSummary.fromJson({
      'id': 'b2', 'name': 'Scout', 'title': '', 'description': '',
      'threadId': 't3', 'notifications': false, 'color': 'ink',
      'avatarUrl': null, 'unread': false, 'tasks': [],
    }),
  ];

  @override
  void setCompanionToken(String? token) {}

  @override
  void endSession() {}

  @override
  String? get sessionToken => null;

  @override
  Future<bool> probe(String baseUrl) async => true;

  @override
  Future<List<BotSummary>> bots(String baseUrl, {int messages = 0}) async {
    if (unauthorizedBots) {
      throw const ApiError(401, 'unauthorized: this session has expired or was revoked; pair this device again');
    }
    if (forbiddenBots) {
      throw const ApiError(403, 'forbidden: this request came through a proxy (pair this device to use the server remotely)');
    }
    if (failBots) throw const ApiError(500, 'down');
    return botsPayload;
  }

  /// Thread ids requested, in order (cache/prefetch assertions).
  final List<String> threadMessageCalls = [];

  @override
  Future<ThreadMessages> threadMessages(
    String baseUrl,
    String threadId, {
    String? before,
    int limit = 50,
  }) async {
    threadMessageCalls.add(threadId);
    if (threadId == 't2') {
      return const ThreadMessages(messages: [], hasMore: false);
    }
    return ThreadMessages(
      messages: [
        ChatMessage.fromJson({
          'id': 'm1', 'role': 'user', 'kind': 'text', 'text': 'hi **there**',
        }),
        ChatMessage.fromJson({
          'id': 'm2', 'role': 'bot', 'kind': 'text',
          'text': 'Morning brief is ready.',
          'attachments': [
            {
              'kind': 'image', 'path': '/api/a/1.png',
              'mime': 'image/png', 'name': 'chart.png',
            },
          ],
        }),
        ...extraMessages,
      ],
      hasMore: false,
    );
  }

  @override
  Future<void> patchTask(
    String baseUrl,
    String botId,
    String threadId,
    Map<String, Object?> patch,
  ) async {
    patches.add({'botId': botId, 'threadId': threadId, ...patch});
  }

  @override
  Map<String, String> authedHeaders() => const {};

  @override
  bool failNextSend = false;
  List<ChatMessage> extraMessages = const [];

  @override
  Future<ChatMessage> sendMessage(
    String baseUrl,
    String botId,
    String text, {
    List<Map<String, Object?>> attachments = const [],
    String? replyToId,
    String? sendId,
  }) async {
    sent.add(text);
    sendIds.add(sendId);
    if (failNextSend) {
      failNextSend = false;
      throw const ApiError(503, 'offline');
    }
    return ChatMessage(
      id: sendId ?? 'm9',
      role: 'user',
      kind: 'text',
      text: text,
      replyToId: replyToId,
    );
  }

  final List<String> sent = [];
  final List<String?> sendIds = [];
  final List<String> interrupted = [];

  @override
  Future<ChatMessage> sendGroupMessage(
    String baseUrl,
    String groupId,
    String text, {
    List<Map<String, Object?>> attachments = const [],
    String? sendId,
  }) async => ChatMessage(
    id: sendId ?? 'm9',
    role: 'user',
    kind: 'text',
    text: text,
  );

  @override
  Future<UploadedAttachment> uploadAttachment(
    String baseUrl,
    List<int> bytes,
    String mime,
  ) async => UploadedAttachment(
    path: '/api/attachments/fake.png',
    mime: mime,
    bytes: bytes.length,
  );

  @override
  Future<UploadedAttachment> uploadFile(
    String baseUrl,
    List<int> bytes,
    String mime,
    String name,
  ) async => UploadedAttachment(
    path: '/api/files/fake',
    mime: mime,
    bytes: bytes.length,
  );

  @override
  Future<ChatMessage?> react(
    String baseUrl,
    String threadId,
    String messageId,
    String emoji,
    bool on,
  ) async => null;

  @override
  Future<void> interrupt(
    String baseUrl,
    String botId,
    String threadId,
  ) async {
    interrupted.add(threadId);
  }

  /// Card answers, in order: (requestId, behavior, message, always, dismiss).
  final List<(String, String, String?, bool, bool)> cardAnswers = [];

  @override
  Future<String> respondToCard(
    String baseUrl,
    String threadId, {
    required String requestId,
    required String behavior,
    String? message,
    bool always = false,
    bool dismiss = false,
  }) async {
    cardAnswers.add((requestId, behavior, message, always, dismiss));
    return 'answered';
  }

  String? createdName;
  bool createdBot = false;
  String? deletedBotId;

  @override
  Future<void> deleteBot(String baseUrl, String botId) async {
    deletedBotId = botId;
  }

  @override
  Future<BotSummary> createBot(String baseUrl, {String? name}) async {
    createdBot = true;
    createdName = name;
    return BotSummary.fromJson({
      'id': 'b9', 'name': name ?? 'Maple', 'title': '',
      'description': '', 'threadId': 't9',
    });
  }

  Map<String, Object?>? lastBotPatch;

  @override
  Future<BotSummary> patchBot(
    String baseUrl,
    String botId,
    Map<String, Object?> patch,
  ) async {
    lastBotPatch = patch;
    return BotSummary.fromJson({
      'id': botId, 'name': patch['name'] ?? 'Max', 'title': '',
      'description': '', 'threadId': 't1',
    });
  }

  List<GroupSummary> groupsPayload = const [];

  @override
  Future<List<GroupSummary>> groups(String baseUrl) async => groupsPayload;

  @override
  Future<GroupSummary> createGroup(
    String baseUrl, {
    String? name,
    List<String> memberIds = const [],
  }) async => GroupSummary(
    id: 'g1',
    name: name ?? 'Group',
    threadId: 'tg1',
    memberIds: memberIds,
  );

  @override
  Future<GroupSummary> finishGroupSetup(
    String baseUrl,
    String groupId, {
    bool skip = false,
    String bulletin = '',
    Map<String, Object?>? defaultResponder,
  }) async => GroupSummary(
    id: groupId,
    name: 'Group',
    threadId: 'tg1',
    memberIds: const [],
  );

  @override
  Future<PairedSession> pair(
    String baseUrl, {
    required String code,
    required String label,
  }) async =>
      const PairedSession(token: 'tok', scopes: ['admin', 'client']);

  @override
  Future<void> emailStart(String baseUrl, String email) async {}

  @override
  Future<List<String>> passwordSignIn(
    String baseUrl, {
    required String email,
    required String password,
  }) async => const ['admin', 'client'];

  @override
  Future<List<String>> passwordSignUp(
    String baseUrl, {
    required String email,
    required String password,
  }) async => const ['admin', 'client'];

  String? resetEmail;
  String? resetToken;
  String? resetPasswordValue;

  @override
  Future<void> requestPasswordReset(String baseUrl, String email) async {
    resetEmail = email;
  }

  @override
  Future<void> resetPassword(
    String baseUrl, {
    required String token,
    required String password,
  }) async {
    resetToken = token;
    resetPasswordValue = password;
  }

  @override
  Future<List<String>> emailVerify(
    String baseUrl, {
    required String email,
    required String code,
  }) async => ['client'];

  @override
  Future<List<Map<String, String>>> signInMethods(String baseUrl) async =>
      const [];

  @override
  Future<String> oauthStart(String baseUrl, String provider) async =>
      'https://example.com/oauth';

  @override
  Future<List<String>> oauthRedeem(String baseUrl, String ticket) async =>
      const ['client'];

  @override
  Future<List<Map<String, Object?>>> search(
    String baseUrl,
    String query,
  ) async => [
    {'kind': 'message', 'id': 'm1', 'title': 'hi there'},
    {'kind': 'bot', 'id': 'b1', 'title': 'Max'},
  ];

  final List<String> pushTokens = [];
  bool pushEnabled = true;
  bool pushConfigured = true;

  @override
  Future<bool> registerPush(
    String baseUrl, {
    required String token,
    required String platform,
    String? deviceName,
    String? appVersion,
  }) async {
    pushTokens.add(token);
    return pushEnabled;
  }

  @override
  Future<bool> unregisterPush(String baseUrl, String token) async =>
      pushTokens.remove(token);

  @override
  Future<PushStatus> pushStatus(String baseUrl) async => PushStatus(
        enabled: pushEnabled,
        configured: pushConfigured,
        devices: [
          for (final token in pushTokens)
            PushDevice(platform: 'ios', fingerprint: token),
        ],
      );

  @override
  Future<bool> setPushEnabled(String baseUrl, bool enabled) async {
    pushEnabled = enabled;
    return pushEnabled;
  }

  String transcribeResult = 'hello from the mic';
  ApiError? transcribeError;

  @override
  Future<String> transcribe(String baseUrl, List<int> wavBytes) async {
    if (transcribeError != null) throw transcribeError!;
    return transcribeResult;
  }

  LiveCallState? liveCall;
  ApiError? liveStartError;

  @override
  Future<LiveSession> startLiveSession(
    String baseUrl, {
    required String botId,
    required String threadId,
    required String sdp,
    required String client,
  }) async {
    if (liveStartError != null) throw liveStartError!;
    liveCall = LiveCallState(
      callId: 'call-1',
      botId: botId,
      threadId: threadId,
      client: client,
      voice: 'sol',
      startedAt: DateTime.now().millisecondsSinceEpoch,
      status: 'connecting',
    );
    return LiveSession(call: liveCall!, answerSdp: 'fake-answer-sdp');
  }

  @override
  Future<LiveCallState?> endLiveCall(String baseUrl, String callId) async {
    final call = liveCall;
    liveCall = null;
    return call;
  }

  @override
  Future<LiveCallState?> currentLiveCall(String baseUrl) async => liveCall;

  final List<Routine> routinesPayload = [
    Routine.fromJson({
      'id': 'r1',
      'name': 'Morning brief',
      'prompt': 'Summarize overnight activity.',
      'botId': 'b1',
      'enabled': true,
      'schedule': {'type': 'daily', 'time': '08:00', 'weekdays': [1, 2, 3, 4, 5]},
      'nextRunAt': 1893456000000,
      'weekRuns': {'ok': 4, 'total': 5},
    }),
  ];
  final List<RoutineRun> routineRunsPayload = [
    RoutineRun.fromJson({
      'id': 'run1',
      'routineId': 'r1',
      'routineName': 'Morning brief',
      'status': 'done',
      'scheduledFor': 1893369600000,
      'output': 'All quiet.',
    }),
  ];

  @override
  Future<RoutineList> routines(String baseUrl) async => RoutineList(
        routines: [...routinesPayload],
        runs: [...routineRunsPayload],
      );

  @override
  Future<Routine> createRoutine(
    String baseUrl, {
    required String name,
    required String prompt,
    required String botId,
    required Map<String, Object?> schedule,
    bool enabled = true,
  }) async {
    final routine = Routine(
      id: 'r${routinesPayload.length + 1}',
      name: name,
      prompt: prompt,
      botId: botId,
      enabled: enabled,
      schedule: schedule,
    );
    routinesPayload.add(routine);
    return routine;
  }

  @override
  Future<Routine> patchRoutine(
    String baseUrl,
    String routineId,
    Map<String, Object?> patch,
  ) async {
    final at = routinesPayload.indexWhere((r) => r.id == routineId);
    final current = routinesPayload[at];
    final next = Routine(
      id: current.id,
      name: patch['name'] as String? ?? current.name,
      prompt: patch['prompt'] as String? ?? current.prompt,
      botId: patch['botId'] as String? ?? current.botId,
      enabled: patch['enabled'] as bool? ?? current.enabled,
      schedule: current.schedule,
      nextRunAt: current.nextRunAt,
    );
    routinesPayload[at] = next;
    return next;
  }

  @override
  Future<bool> deleteRoutine(String baseUrl, String routineId) async {
    final before = routinesPayload.length;
    routinesPayload.removeWhere((r) => r.id == routineId);
    return routinesPayload.length < before;
  }

  @override
  Future<RoutineRun> runRoutineNow(String baseUrl, String routineId) async {
    final run = RoutineRun(
      id: 'run-now',
      routineId: routineId,
      routineName: 'Manual',
      status: 'working',
      scheduledFor: DateTime.now().millisecondsSinceEpoch,
      manual: true,
    );
    routineRunsPayload.insert(0, run);
    return run;
  }

  ComputerFrames computerFramesPayload = const ComputerFrames(
    configured: false,
    available: false,
    computers: [],
  );

  @override
  Future<ComputerFrames> computerFrames(
    String baseUrl, {
    Map<String, int> have = const {},
  }) async => computerFramesPayload;

  final List<Map<String, Object?>> browserActions = [];

  @override
  Future<Map<String, Object?>> browserAction(
    String baseUrl,
    String botId,
    Map<String, Object?> action,
  ) async {
    browserActions.add(action);
    return {'ok': true};
  }

  /// Scripted v1 frames for browserLive; emitted on subscribe.
  List<Map<String, Object?>> browserFrames = [];

  @override
  Future<StreamSubscription<Map<String, Object?>>> browserLive(
    String baseUrl,
    String botId,
    String threadId,
    int width,
    int height,
    void Function(Map<String, Object?> frame) onFrame, {
    void Function(Object error)? onError,
  }) async {
    final controller = StreamController<Map<String, Object?>>();
    final sub = controller.stream.listen(onFrame, onError: onError);
    for (final frame in browserFrames) {
      controller.add(frame);
    }
    return sub;
  }

  final List<PublicPhone> phonesPayload = [];
  PublicPhone? phoneSelfPayload;

  @override
  Future<List<PublicPhone>> phones(String baseUrl) async => [...phonesPayload];

  @override
  Future<bool> removePhone(String baseUrl, String key) async {
    final before = phonesPayload.length;
    phonesPayload.removeWhere((p) => p.key == key);
    return phonesPayload.length < before;
  }

  @override
  Future<PublicPhone?> registerPhone(
    String baseUrl, {
    required String installId,
    required String name,
    required String platform,
    required String appVersion,
    required String timeZone,
    required Map<String, String> capabilities,
  }) async {
    phoneSelfPayload = PublicPhone(
      key: 'session:test',
      name: name,
      platform: platform,
      appVersion: appVersion,
      online: true,
      capabilities: capabilities,
    );
    return phoneSelfPayload;
  }

  @override
  Future<PublicPhone?> phoneSelf(String baseUrl) async => phoneSelfPayload;

  @override
  Future<bool> unregisterPhone(String baseUrl) async {
    final had = phoneSelfPayload != null;
    phoneSelfPayload = null;
    return had;
  }

  PhoneJob? nextPhoneJob;

  @override
  Future<PhoneJob?> pollPhoneJob(String baseUrl) async {
    final job = nextPhoneJob;
    nextPhoneJob = null;
    return job;
  }

  @override
  Future<bool> leasePhoneJob(String baseUrl, String jobId) async => true;

  final List<(String, bool, Object?, String?, String?)> phoneResults = [];

  @override
  Future<void> completePhoneJob(
    String baseUrl,
    String jobId, {
    required bool ok,
    Object? result,
    String? error,
    String? code,
  }) async {
    phoneResults.add((jobId, ok, result, error, code));
  }

  // ---- Phase 7 fakes ----

  String? consoleAccountToken;
  List<ConsoleMembership> membershipsPayload = [
    ConsoleMembership(
      workspace: 'acme',
      displayName: 'Acme',
      plan: 'team',
      status: 'active',
      role: 'admin',
    ),
  ];
  ConsoleWorkspace workspacePayload = const ConsoleWorkspace(
    id: 'acme',
    displayName: 'Acme',
    plan: 'team',
    role: 'admin',
    status: 'active',
  );
  WorkspaceSeats seatsPayload = const WorkspaceSeats(
    admins: 1,
    members: 2,
    pendingInvites: 1,
    roster: [
      WorkspaceMember(
        userId: 'u1',
        email: 'owner@example.test',
        role: 'admin',
        name: 'Owner',
      ),
      WorkspaceMember(userId: 'u2', email: 'dev@example.test', role: 'member'),
    ],
    invites: [
      ConsoleInvite(id: 'i1', email: 'new@example.test', role: 'member'),
    ],
  );
  WorkspaceSpend spendPayload = const WorkspaceSpend(
    period: '2026-11',
    spent: 12.5,
    allowance: 50,
    remaining: 37.5,
  );
  List<WorkspaceProvider> providersPayload = const [
    WorkspaceProvider(id: 'claude', mode: 'bundled', models: ['sonnet']),
    WorkspaceProvider(id: 'codex', mode: 'byo', models: []),
    WorkspaceProvider(id: 'grok', mode: 'off', models: []),
  ];
  List<ConsolePlan> plansPayload = const [
    ConsolePlan(
      id: 'free',
      name: 'Free',
      blurb: 'For trying Maximus.',
      baseUsd: 0,
      allowanceUsd: 0,
      entitlements: [],
      features: ['Pair one server'],
    ),
  ];
  final List<Map<String, Object?>> providerWrites = [];
  final List<Map<String, Object?>> inviteWrites = [];
  String? lastConsoleWorkspace;

  @override
  Future<void> consoleOtpStart(String baseUrl, String email) async {}

  @override
  Future<ConsoleLogin> consoleOtpVerify(
    String baseUrl, {
    required String email,
    required String code,
  }) async {
    consoleAccountToken = 'acct-$code';
    return ConsoleLogin(token: 'acct-$code', userId: 'u1', email: email);
  }

  @override
  Future<List<ConsoleMembership>> consoleMemberships(
    String baseUrl,
    String accountToken,
  ) async => membershipsPayload;

  @override
  Future<ConsoleWorkspace> consoleWorkspace(
    String baseUrl,
    String accountToken,
    String workspaceId,
  ) async => workspacePayload;

  @override
  Future<ConsoleWorkspace> consoleWorkspaceCreate(
    String baseUrl,
    String accountToken, {
    required String workspace,
    String? displayName,
    String? plan,
  }) async {
    lastConsoleWorkspace = workspace;
    return ConsoleWorkspace(
      id: workspace,
      displayName: displayName ?? workspace,
      plan: plan ?? 'free',
      role: 'admin',
      status: 'active',
    );
  }

  @override
  Future<ConsoleInviteSend> consoleInviteSend(
    String baseUrl,
    String accountToken, {
    required String workspace,
    required String email,
    required String role,
  }) async {
    inviteWrites.add({'workspace': workspace, 'email': email, 'role': role});
    return ConsoleInviteSend(
      invite: ConsoleInvite(id: 'i-${inviteWrites.length}', email: email, role: role),
      token: 'invite-token',
    );
  }

  @override
  Future<bool> consoleInviteRevoke(
    String baseUrl,
    String accountToken, {
    required String workspace,
    String? userId,
    String? inviteId,
  }) async {
    inviteWrites.add({
      'workspace': workspace,
      'revokeUser': ?userId,
      'revokeInvite': ?inviteId,
    });
    return true;
  }

  @override
  Future<ConsoleWorkspace> consoleInviteAccept(
    String baseUrl,
    String accountToken,
    String inviteToken,
  ) async => workspacePayload;

  @override
  Future<WorkspaceSeats> consoleSeats(
    String baseUrl,
    String accountToken,
    String workspaceId,
  ) async => seatsPayload;

  @override
  Future<WorkspaceSpend> consoleSpend(
    String baseUrl,
    String accountToken,
    String workspaceId,
  ) async => spendPayload;

  @override
  Future<Map<String, Object?>> consoleEntitlements(
    String baseUrl,
    String accountToken,
    String workspaceId,
  ) async => {
    'plan': 'team',
    'entitlements': ['seats', 'bundled'],
    'allowance': 50,
  };

  @override
  Future<List<WorkspaceProvider>> consoleProviders(
    String baseUrl,
    String accountToken,
    String workspaceId,
  ) async => providersPayload;

  @override
  Future<List<WorkspaceProvider>> consoleSetProviders(
    String baseUrl,
    String accountToken,
    String workspaceId,
    Map<String, Object?> body,
  ) async {
    providerWrites.add({'workspace': workspaceId, ...body});
    return providersPayload;
  }

  @override
  Future<List<WorkspaceProvider>> consoleSetProvider(
    String baseUrl,
    String accountToken,
    String workspaceId,
    String providerId,
    Map<String, Object?> body,
  ) async {
    providerWrites.add({'workspace': workspaceId, 'id': providerId, ...body});
    return providersPayload;
  }

  @override
  Future<List<ConsolePlan>> consolePlans(String baseUrl) async =>
      plansPayload;

  BillingOffer offerPayload = BillingOffer.usd;
  final List<Map<String, String>> checkoutWrites = [];
  String checkoutUrl = 'https://checkout.paystack.com/ref';

  @override
  Future<BillingOffer> billingOffer(String baseUrl, {required String timeZone}) async =>
      offerPayload;

  @override
  Future<BillingCheckout> billingCheckout(
    String baseUrl, {
    required String provider,
    required String plan,
    required String customerEmail,
    required String successUrl,
    required String cancelUrl,
    required String timeZone,
  }) async {
    checkoutWrites.add({
      'provider': provider,
      'plan': plan,
      'customerEmail': customerEmail,
      'timeZone': timeZone,
    });
    return BillingCheckout(url: checkoutUrl);
  }

  StoreSubscription storeSubscriptionPayload = const StoreSubscription(
    workspace: 'acme',
    subscribed: false,
  );
  bool failStoreVerify = false;
  final List<Map<String, String>> storeVerifications = [];

  @override
  Future<StoreGrant> consoleStoreVerify(
    String baseUrl,
    String accountToken, {
    required String workspace,
    required String platform,
    required String receipt,
  }) async {
    if (failStoreVerify) throw ApiError(400, 'receipt rejected');
    storeVerifications.add({
      'workspace': workspace,
      'platform': platform,
      'receipt': receipt,
    });
    return StoreGrant(
      workspace: workspace,
      platform: platform,
      plan: platform == 'google' ? 'business' : 'team',
      productId: platform == 'google'
          ? 'maximus_pro_monthly'
          : 'maximus_plus_monthly',
    );
  }

  @override
  Future<StoreSubscription> consoleStoreStatus(
    String baseUrl,
    String accountToken,
    String workspace,
  ) async => storeSubscriptionPayload;

  AuthSessionInfo sessionInfoPayload = const AuthSessionInfo(
    kind: 'session',
    scopes: ['admin', 'client'],
    id: 'sess-1',
    label: 'e2e-phone',
    email: 'owner@example.test',
  );
  List<DeviceSession> deviceSessionsPayload = const [
    DeviceSession(
      id: 'sess-1',
      label: 'This iPhone',
      scopes: ['admin', 'client'],
      current: true,
    ),
    DeviceSession(id: 'sess-2', label: 'MacBook', scopes: ['admin']),
  ];
  final List<String> revokedSessions = [];
  bool loggedOut = false;
  final List<Map<String, String?>> presenceReports = [];
  UsageReport usagePayload = const UsageReport(
    from: '2026-11-01',
    to: '2026-11-30',
    groupBy: 'bot',
    groups: [
      UsageGroup(
        key: 'b1',
        label: 'Max',
        turns: 12,
        input: 1000,
        output: 500,
        costUsd: 1.25,
      ),
    ],
    total: UsageGroup(
      key: 'total',
      label: 'Total',
      turns: 12,
      input: 1000,
      output: 500,
      costUsd: 1.25,
    ),
    currency: 'USD',
  );
  BotComputerStatus computerPayload = const BotComputerStatus(
    available: true,
    state: 'running',
  );
  final List<String> computerActions = [];

  @override
  Future<AuthSessionInfo> authSession(String baseUrl) async {
    if (unauthorizedBots) {
      throw const ApiError(
        401,
        'unauthorized: this session has expired or was revoked; pair this device again',
      );
    }
    return sessionInfoPayload;
  }

  @override
  Future<void> logout(String baseUrl) async {
    loggedOut = true;
  }

  @override
  Future<List<DeviceSession>> sessions(String baseUrl) async =>
      deviceSessionsPayload;

  @override
  Future<bool> revokeSession(String baseUrl, String sessionId) async {
    revokedSessions.add(sessionId);
    return true;
  }

  @override
  Future<UsageReport> usageReport(
    String baseUrl, {
    required String from,
    required String to,
    String groupBy = 'bot',
  }) async => usagePayload;

  RationWallet rationPayload = const RationWallet(
    tier: 'free',
    grantedUsd: 0.012,
    spentUsd: 0,
    leftUsd: 0.012,
    sparkTokens: 2823,
    contributorOffered: true,
    contributorAccepted: false,
    priceUsd: 0,
    storePriceUsd: 0,
  );

  @override
  Future<RationWallet> rationWallet(
    String baseUrl, {
    String? installId,
  }) async => rationPayload;

  @override
  Future<RationWallet> acceptRationContributor(
    String baseUrl,
    bool accept,
  ) async {
    rationPayload = RationWallet(
      tier: rationPayload.tier,
      grantedUsd: rationPayload.grantedUsd,
      spentUsd: rationPayload.spentUsd,
      leftUsd: rationPayload.leftUsd,
      sparkTokens: accept ? 60000 : rationPayload.sparkTokens,
      contributorOffered: rationPayload.contributorOffered,
      contributorAccepted: accept,
      priceUsd: rationPayload.priceUsd,
      storePriceUsd: rationPayload.storePriceUsd,
    );
    return rationPayload;
  }

  /// Default muse so home refresh does not open the paywall in widget tests.
  String? accountChoice = 'muse';
  bool freeAvailable = true;

  @override
  Future<AccountPlanInfo> accountPlan(String baseUrl) async => AccountPlanInfo(
        choice: accountChoice,
        freeAvailable: freeAvailable,
      );

  @override
  Future<void> chooseAccountPlan(String baseUrl, String choice) async {
    accountChoice = choice;
  }

  @override
  Future<void> presenceActive(
    String baseUrl, {
    String? timeZone,
    String? language,
  }) async {
    presenceReports.add({'timeZone': timeZone, 'language': language});
  }

  @override
  Future<BotComputerStatus> localComputer(String baseUrl) async =>
      computerPayload;

  @override
  Future<List<Map<String, Object?>>> localComputerInstances(
    String baseUrl,
  ) async => [
    {'name': 'maximus-vm', 'state': 'running'},
  ];

  @override
  Future<BotComputerStatus> localComputerAction(
    String baseUrl,
    String action,
  ) async {
    computerActions.add(action);
    return computerPayload;
  }

  @override
  Future<Uint8List?> localComputerScreenshot(String baseUrl) async =>
      computerScreenshot;

  Uint8List? computerScreenshot;
  final desktopInputs = <Map<String, Object?>>[];

  @override
  Future<void> localComputerInput(
    String baseUrl,
    Map<String, Object?> action,
  ) async {
    desktopInputs.add(action);
  }

  AgentOsMachinesPayload agentOsPayload = const AgentOsMachinesPayload(
    machines: [
      AgentOsMachine(
        id: 'self',
        name: 'Office Mac',
        kind: 'this_desktop',
        online: true,
      ),
    ],
    multiMachine: false,
    selfId: 'self',
  );
  String? assignedMachineId;
  final routedMachines = <String>[];
  List<AgentOsPlugin> agentOsPluginsPayload = const [
    AgentOsPlugin(mode: 'browser', app: 'canva', actions: ['list', 'lookup', 'publish']),
    AgentOsPlugin(mode: 'local', app: 'git', actions: ['lookup', 'post', 'push']),
  ];
  final invokedPlugins = <Map<String, Object?>>[];
  Map<String, Object?> invokePluginResult = const {
    'app': 'canva',
    'executed': false,
    'bound': true,
    'preview': 'canva publish as you',
  };
  ApiError? invokePluginError;

  @override
  Future<AgentOsMachinesPayload> agentOsMachines(String baseUrl) async =>
      agentOsPayload;

  @override
  Future<String?> agentOsAssignment(
    String baseUrl, {
    String? threadId,
    String? botId,
  }) async =>
      assignedMachineId;

  @override
  Future<void> assignAgentOsMachine(
    String baseUrl, {
    required String machineId,
    String? threadId,
    String? botId,
  }) async {
    assignedMachineId = machineId;
  }

  @override
  Future<Map<String, Object?>> routeAgentOs(
    String baseUrl, {
    required String machineId,
    String capability = 'computer',
    String? botId,
  }) async {
    routedMachines.add(machineId);
    AgentOsMachine? machine;
    for (final row in agentOsPayload.machines) {
      if (row.id == machineId) machine = row;
    }
    if (machine == null) {
      throw const ApiError(404, 'Unknown machine');
    }
    if (!machine.online) {
      throw ApiError(503, '${machine.name} is asleep. Wake that computer, then try again.');
    }
    return {
      'ok': true,
      'target': machineId == agentOsPayload.selfId ? 'local' : 'remote',
      'dispatch': machineId == agentOsPayload.selfId ? 'cua' : 'shared-computer',
    };
  }

  @override
  Future<List<AgentOsPlugin>> agentOsPlugins(String baseUrl) async =>
      agentOsPluginsPayload;

  @override
  Future<Map<String, Object?>> invokeAgentOsPlugin(
    String baseUrl, {
    required String mode,
    required String app,
    required String action,
    bool confirm = false,
    String? threadId,
    String? botId,
  }) async {
    invokedPlugins.add({
      'mode': mode,
      'app': app,
      'action': action,
      'confirm': confirm,
      'threadId': threadId,
      'botId': botId,
    });
    final error = invokePluginError;
    if (error != null) throw error;
    return invokePluginResult;
  }

  List<EngineInstance> instancesPayload = const [];
  final List<Map<String, Object?>> configWrites = [];
  final List<Map<String, Object?>> openaiCompatWrites = [];
  EngineAuthFlow authStartPayload = const EngineAuthFlow(
    phase: 'waiting',
    flowId: 'flow-1',
    authorizationUrl: 'https://example.test/device',
    userCode: 'ABCD-EFGH',
  );

  @override
  Future<List<EngineInstance>> listInstances(
    String baseUrl, {
    bool fresh = false,
  }) async =>
      instancesPayload;

  @override
  Future<EngineAuthFlow> startInstanceAuth(
    String baseUrl,
    String instanceId,
  ) async =>
      authStartPayload;

  @override
  Future<EngineAuthFlow> instanceAuthStatus(
    String baseUrl,
    String instanceId, {
    required String flowId,
  }) async =>
      authStartPayload;

  @override
  Future<void> completeInstanceAuth(
    String baseUrl,
    String instanceId, {
    required String flowId,
    required String code,
  }) async {}

  @override
  Future<void> cancelInstanceAuth(String baseUrl, String instanceId) async {}

  @override
  Future<String> addOpenaiCompat(
    String baseUrl, {
    required String displayName,
    required String url,
    required String key,
  }) async {
    openaiCompatWrites.add({
      'displayName': displayName,
      'url': url,
      'key': key,
    });
    return 'openai-compat-test';
  }

  @override
  Future<void> putConfig(String baseUrl, Map<String, Object?> patch) async {
    configWrites.add(patch);
  }

  ConnectorCatalog connectorCatalogAnswer = const ConnectorCatalog(
    configured: true,
    cards: [],
  );
  Map<String, ConnectorLink> connectorConnectionsAnswer = const {};
  String connectorAuthorizeUrl = 'https://connect.example/auth';
  final List<Map<String, Object?>> connectorWrites = [];
  Map<String, List<BotMcpServer>> botMcpServersById = const {};

  @override
  Future<ConnectorCatalog> connectorCatalog(String baseUrl) async =>
      connectorCatalogAnswer;

  @override
  Future<Map<String, ConnectorLink>> connectorConnections(String baseUrl) async =>
      connectorConnectionsAnswer;

  @override
  Future<String> connectorAuthorize(
    String baseUrl,
    String slug, {
    String? alias,
  }) async {
    connectorWrites.add({
      'action': 'authorize',
      'slug': slug,
      if (alias != null) 'alias': alias,
    });
    return connectorAuthorizeUrl;
  }

  @override
  Future<void> connectorDisconnect(
    String baseUrl,
    String slug, {
    String? accountId,
  }) async {
    connectorWrites.add({
      'action': 'disconnect',
      'slug': slug,
      if (accountId != null) 'accountId': accountId,
    });
  }

  @override
  Future<List<BotMcpServer>> botMcpServers(String baseUrl, String botId) async =>
      botMcpServersById[botId] ?? const [];

  final List<Map<String, Object?>> secretCardWrites = [];
  final List<Map<String, Object?>> signInCardWrites = [];

  @override
  Future<void> saveSecretCard(
    String baseUrl,
    String botId,
    String messageId, {
    required String threadId,
    required String value,
    String? address,
    Map<String, Object?>? server,
  }) async {
    secretCardWrites.add({
      'botId': botId,
      'messageId': messageId,
      'threadId': threadId,
      'value': value,
      if (address != null) 'address': address,
      ...?server,
    });
  }

  @override
  Future<void> settleSecretCard(
    String baseUrl,
    String botId,
    String messageId, {
    required String threadId,
    required String action,
  }) async {
    secretCardWrites.add({
      'botId': botId,
      'messageId': messageId,
      'threadId': threadId,
      'action': action,
    });
  }

  @override
  Future<void> saveOnePasswordToken(String baseUrl, String token) async {
    configWrites.add({'onePasswordToken': token});
  }

  @override
  Future<void> settleSignInCard(
    String baseUrl,
    String botId,
    String messageId, {
    required String threadId,
    required String action,
  }) async {
    signInCardWrites.add({
      'botId': botId,
      'messageId': messageId,
      'threadId': threadId,
      'action': action,
    });
  }

  @override
  Future<void> saveSignInLogin(
    String baseUrl,
    String botId,
    String messageId, {
    required String threadId,
    required String username,
    required String password,
    String? totp,
    String? signInHost,
  }) async {
    signInCardWrites.add({
      'botId': botId,
      'messageId': messageId,
      'threadId': threadId,
      'action': 'save-login',
      'username': username,
      'password': password,
      if (totp != null) 'totp': totp,
      if (signInHost != null) 'signInHost': signInHost,
    });
  }

  final List<Map<String, Object?>> connectorCardWrites = [];
  final List<Map<String, Object?>> widgetActionWrites = [];
  List<NeedsYouItem> needsYouItems = const [];
  bool connectorConnected = false;

  @override
  Future<String> authorizeConnectorCard(
    String baseUrl,
    String botId,
    String messageId, {
    required String threadId,
    String? alias,
  }) async {
    connectorCardWrites.add({
      'action': 'authorize',
      'botId': botId,
      'messageId': messageId,
      'threadId': threadId,
      if (alias != null) 'alias': alias,
    });
    return connectorAuthorizeUrl;
  }

  @override
  Future<bool> connectorCardStatus(
    String baseUrl,
    String botId,
    String messageId, {
    required String threadId,
  }) async {
    connectorCardWrites.add({
      'action': 'status',
      'botId': botId,
      'messageId': messageId,
      'threadId': threadId,
    });
    return connectorConnected;
  }

  @override
  Future<void> resumeConnectorCard(
    String baseUrl,
    String botId,
    String messageId, {
    required String threadId,
  }) async {
    connectorCardWrites.add({
      'action': 'resume',
      'botId': botId,
      'messageId': messageId,
      'threadId': threadId,
    });
  }

  @override
  Future<void> dismissConnectorCard(
    String baseUrl,
    String botId,
    String messageId, {
    required String threadId,
  }) async {
    connectorCardWrites.add({
      'action': 'dismiss',
      'botId': botId,
      'messageId': messageId,
      'threadId': threadId,
    });
  }

  @override
  Future<void> sendWidgetAction(
    String baseUrl,
    String botId, {
    required String threadId,
    required String messageId,
    required String ref,
    required int rev,
    Map<String, Object?>? values,
  }) async {
    widgetActionWrites.add({
      'botId': botId,
      'threadId': threadId,
      'messageId': messageId,
      'ref': ref,
      'rev': rev,
      ...?values,
    });
  }

  ChatAppDocument? appDocument;
  final List<Map<String, Object?>> appMessageWrites = [];

  @override
  Future<ChatAppDocument> fetchAppDocument(
    String baseUrl,
    String threadId,
    String messageId, {
    int? rev,
  }) async {
    final doc = appDocument;
    if (doc == null) throw ApiError(404, 'no app document');
    return doc;
  }

  @override
  Future<void> sendAppMessage(
    String baseUrl,
    String botId, {
    required String threadId,
    required String messageId,
    required String text,
  }) async {
    appMessageWrites.add({
      'botId': botId,
      'threadId': threadId,
      'messageId': messageId,
      'text': text,
    });
  }

  @override
  Future<List<NeedsYouItem>> needsYou(String baseUrl) async => needsYouItems;

  @override
  Future<StreamSubscription<LiveEvent>> events(
    String baseUrl,
    void Function(LiveEvent) onEvent, {
    void Function(Object error)? onError,
    void Function()? onDone,
    String? since,
  }) async {
    return StreamController<LiveEvent>().stream.listen(
      onEvent,
      onError: onError,
    );
  }

  @override
  void close() {}
}

