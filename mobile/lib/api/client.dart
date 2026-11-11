import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'dart:typed_data';

import 'models.dart';
import 'sse.dart';

/// Random v4 UUID (upload ids; avoids a dependency for one call).
String _uuidV4() {
  final random = Random.secure();
  final bytes = List<int>.generate(16, (_) => random.nextInt(256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  final hex = bytes
      .map((b) => b.toRadixString(16).padLeft(2, '0'))
      .join();
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}'
      '-${hex.substring(12, 16)}-${hex.substring(16, 20)}'
      '-${hex.substring(20)}';
}

/// Server API surface. UI depends on this; tests inject fakes
/// (widget tests run in FakeAsync, where real sockets never resolve).
abstract class MaximusApi {
  void setCompanionToken(String? token);

  /// Drops the saved sign-in so the next request is not sent with a dead token.
  void endSession();

  /// The session token from the latest sign-in cookie, when this client saw one.
  String? get sessionToken;
  Future<bool> probe(String baseUrl);
  Future<List<BotSummary>> bots(String baseUrl, {int messages = 0});
  Future<ThreadMessages> threadMessages(
    String baseUrl,
    String threadId, {
    String? before,
    int limit = 50,
  });
  Future<void> patchTask(
    String baseUrl,
    String botId,
    String threadId,
    Map<String, Object?> patch,
  );
  Map<String, String> authedHeaders();
  Future<ChatMessage> sendMessage(
    String baseUrl,
    String botId,
    String text, {
    List<Map<String, Object?>> attachments,
    String? replyToId,
  });
  Future<ChatMessage> sendGroupMessage(
    String baseUrl,
    String groupId,
    String text, {
    List<Map<String, Object?>> attachments,
  });
  Future<UploadedAttachment> uploadAttachment(
    String baseUrl,
    List<int> bytes,
    String mime,
  );
  Future<ChatMessage?> react(
    String baseUrl,
    String threadId,
    String messageId,
    String emoji,
    bool on,
  );
  Future<void> interrupt(String baseUrl, String botId, String threadId);

  /// POST /api/threads/:id/respond — answer an approval/question card.
  /// [behavior] is allow, deny, or answer; [message] carries the answer
  /// text or chosen option; [always] remembers the grant for the session;
  /// [dismiss] closes a question without answering it.
  Future<String> respondToCard(
    String baseUrl,
    String threadId, {
    required String requestId,
    required String behavior,
    String? message,
    bool always = false,
    bool dismiss = false,
  });
  Future<BotSummary> createBot(String baseUrl, {String? name});
  Future<BotSummary> patchBot(
    String baseUrl,
    String botId,
    Map<String, Object?> patch,
  );
  Future<List<GroupSummary>> groups(String baseUrl);
  Future<GroupSummary> createGroup(
    String baseUrl, {
    String? name,
    List<String> memberIds,
  });

  /// PATCH /api/groups/:id/setup — finish room setup (`skip` to skip it).
  /// Required before sending the first message to a new room.
  Future<GroupSummary> finishGroupSetup(
    String baseUrl,
    String groupId, {
    bool skip = false,
    String bulletin = '',
    Map<String, Object?>? defaultResponder,
  });
  Future<PairedSession> pair(
    String baseUrl, {
    required String code,
    required String label,
  });
  Future<void> emailStart(String baseUrl, String email);
  Future<List<String>> passwordSignIn(
    String baseUrl, {
    required String email,
    required String password,
  });
  Future<List<String>> passwordSignUp(
    String baseUrl, {
    required String email,
    required String password,
  });
  Future<List<String>> emailVerify(
    String baseUrl, {
    required String email,
    required String code,
  });

  /// GET /api/auth/methods — GitHub, Google, Apple, Microsoft when configured.
  Future<List<Map<String, String>>> signInMethods(String baseUrl);

  /// GET /api/auth/oauth/:provider/start — the provider page to open.
  Future<String> oauthStart(String baseUrl, String provider);

  /// POST /api/auth/oauth/redeem — trade the phone ticket for a session cookie.
  Future<List<String>> oauthRedeem(String baseUrl, String ticket);
  Future<List<Map<String, Object?>>> search(String baseUrl, String query);

  /// POST /v1/installations/self/push/register — register this phone.
  Future<bool> registerPush(
    String baseUrl, {
    required String token,
    required String platform,
    String? deviceName,
    String? appVersion,
  });

  /// DELETE .../push/register — remove this phone's token.
  Future<bool> unregisterPush(String baseUrl, String token);

  /// GET /v1/installations/self/push — devices + global switch (admin).
  Future<PushStatus> pushStatus(String baseUrl);

  /// PATCH .../push/settings — flip the global switch (admin).
  Future<bool> setPushEnabled(String baseUrl, bool enabled);

  /// POST /api/tts/transcribe — speech to text for recorded WAV audio.
  Future<String> transcribe(String baseUrl, List<int> wavBytes);

  /// POST /api/live/session — trade a WebRTC offer for a live call.
  /// Returns the call state plus the SDP answer. [client] is ios/android.
  Future<LiveSession> startLiveSession(
    String baseUrl, {
    required String botId,
    required String threadId,
    required String sdp,
    required String client,
  });

  /// POST /api/live/call/end — hang up.
  Future<LiveCallState?> endLiveCall(String baseUrl, String callId);

  /// GET /api/live/call — the currently running call, if any.
  Future<LiveCallState?> currentLiveCall(String baseUrl);

  /// GET /api/routines — schedules plus recent runs.
  Future<RoutineList> routines(String baseUrl);

  /// POST /api/routines — create a schedule.
  Future<Routine> createRoutine(
    String baseUrl, {
    required String name,
    required String prompt,
    required String botId,
    required Map<String, Object?> schedule,
    bool enabled = true,
  });

  /// PATCH /api/routines/:id — pause/resume/retarget.
  Future<Routine> patchRoutine(
    String baseUrl,
    String routineId,
    Map<String, Object?> patch,
  );

  /// DELETE /api/routines/:id.
  Future<bool> deleteRoutine(String baseUrl, String routineId);

  /// POST /api/routines/:id/run — run now.
  Future<RoutineRun> runRoutineNow(String baseUrl, String routineId);

  /// GET /api/computers/frames — shared-computer screenshots.
  Future<ComputerFrames> computerFrames(
    String baseUrl, {
    Map<String, int> have = const {},
  });

  /// POST /api/bots/:id/browser/action — v1 viewer actions
  /// (take/release/ack/input/restart/...).
  Future<Map<String, Object?>> browserAction(
    String baseUrl,
    String botId,
    Map<String, Object?> action,
  );

  /// GET /api/bots/:id/browser/live — v1 viewer SSE: ready, frame,
  /// control, tabs, url, status, heartbeat, error maps.
  Future<StreamSubscription<Map<String, Object?>>> browserLive(
    String baseUrl,
    String botId,
    String threadId,
    int width,
    int height,
    void Function(Map<String, Object?> frame) onFrame, {
    void Function(Object error)? onError,
  });

  /// GET /api/phones — registered phones (admin).
  Future<List<PublicPhone>> phones(String baseUrl);

  /// DELETE /api/phones/:key — remove a phone (admin).
  Future<bool> removePhone(String baseUrl, String key);

  /// PUT /api/phones/self — register this phone's apps.
  Future<PublicPhone?> registerPhone(
    String baseUrl, {
    required String installId,
    required String name,
    required String platform,
    required String appVersion,
    required String timeZone,
    required Map<String, String> capabilities,
  });

  /// GET /api/phones/self — this phone's registration.
  Future<PublicPhone?> phoneSelf(String baseUrl);

  /// DELETE /api/phones/self — unregister this phone.
  Future<bool> unregisterPhone(String baseUrl);

  /// GET /api/phones/self/jobs — long-poll one assigned job (null: none).
  Future<PhoneJob?> pollPhoneJob(String baseUrl);

  /// POST .../jobs/:id/lease — hold the job while executing.
  Future<bool> leasePhoneJob(String baseUrl, String jobId);

  /// POST .../jobs/:id/result — deliver the outcome.
  Future<void> completePhoneJob(
    String baseUrl,
    String jobId, {
    required bool ok,
    Object? result,
    String? error,
    String? code,
  });

  // ---- Phase 7: workspace (control plane via the server proxy) ----

  /// POST /api/console/auth/otp/start — email sign-in code.
  Future<void> consoleOtpStart(String baseUrl, String email);

  /// POST /api/console/auth/otp/verify — returns the account token + user.
  Future<ConsoleLogin> consoleOtpVerify(
    String baseUrl, {
    required String email,
    required String code,
  });

  /// GET /api/console/memberships — workspaces this account belongs to.
  Future<List<ConsoleMembership>> consoleMemberships(
    String baseUrl,
    String accountToken,
  );

  /// GET /api/console/workspaces/:id — one workspace record.
  Future<ConsoleWorkspace> consoleWorkspace(
    String baseUrl,
    String accountToken,
    String workspaceId,
  );

  /// POST /api/console/workspaces — create a workspace.
  Future<ConsoleWorkspace> consoleWorkspaceCreate(
    String baseUrl,
    String accountToken, {
    required String workspace,
    String? displayName,
    String? plan,
  });

  /// POST /api/console/invites — invite an email (admins).
  Future<ConsoleInviteSend> consoleInviteSend(
    String baseUrl,
    String accountToken, {
    required String workspace,
    required String email,
    required String role,
  });

  /// POST /api/console/invites/revoke — revoke an invite or remove a member.
  Future<bool> consoleInviteRevoke(
    String baseUrl,
    String accountToken, {
    required String workspace,
    String? userId,
    String? inviteId,
  });

  /// POST /api/console/invites/accept — join by invite token.
  Future<ConsoleWorkspace> consoleInviteAccept(
    String baseUrl,
    String accountToken,
    String inviteToken,
  );

  /// GET /api/console/admin/seats — roster + pending invites (admins).
  Future<WorkspaceSeats> consoleSeats(
    String baseUrl,
    String accountToken,
    String workspaceId,
  );

  /// GET /api/console/workspaces/:id/spend — month burn-down.
  Future<WorkspaceSpend> consoleSpend(
    String baseUrl,
    String accountToken,
    String workspaceId,
  );

  /// GET /api/console/workspaces/:id/entitlements — plan grants.
  Future<Map<String, Object?>> consoleEntitlements(
    String baseUrl,
    String accountToken,
    String workspaceId,
  );

  /// GET /api/console/workspaces/:id/providers — provider modes + routing.
  Future<List<WorkspaceProvider>> consoleProviders(
    String baseUrl,
    String accountToken,
    String workspaceId,
  );

  /// PUT .../providers — set several provider modes at once.
  Future<List<WorkspaceProvider>> consoleSetProviders(
    String baseUrl,
    String accountToken,
    String workspaceId,
    Map<String, Object?> body,
  );

  /// PUT .../providers/:id — set one provider's mode.
  Future<List<WorkspaceProvider>> consoleSetProvider(
    String baseUrl,
    String accountToken,
    String workspaceId,
    String providerId,
    Map<String, Object?> body,
  );

  /// GET /api/console/plans — public plan catalog.
  Future<List<ConsolePlan>> consolePlans(String baseUrl);

  /// GET /api/billing/offer — Naira when Paystack is on and this phone is in Nigeria.
  Future<BillingOffer> billingOffer(String baseUrl, {required String timeZone});

  /// POST /api/billing/checkout — start a Paystack charge and return its URL.
  Future<BillingCheckout> billingCheckout(
    String baseUrl, {
    required String plan,
    required String customerEmail,
    required String successUrl,
    required String cancelUrl,
    required String timeZone,
  });

  /// POST /api/console/billing/store/verify — confirm a store purchase
  /// with Apple/Google and grant the workspace (admins).
  Future<StoreGrant> consoleStoreVerify(
    String baseUrl,
    String accountToken, {
    required String workspace,
    required String platform,
    required String receipt,
  });

  /// GET /api/console/billing/store/status — subscription state.
  Future<StoreSubscription> consoleStoreStatus(
    String baseUrl,
    String accountToken,
    String workspace,
  );

  // ---- Phase 7: settings (paired session) ----

  /// GET /api/auth/session — who this phone is to the server.
  Future<AuthSessionInfo> authSession(String baseUrl);

  /// POST /api/auth/logout — end this session server-side.
  Future<void> logout(String baseUrl);

  /// GET /api/auth/sessions — signed-in devices.
  Future<List<DeviceSession>> sessions(String baseUrl);

  /// DELETE /api/auth/sessions/:id — revoke a device.
  Future<bool> revokeSession(String baseUrl, String sessionId);

  /// GET /api/ration — cents left on the Muse wallet, and the Spark equivalent.
  /// [installId] is sent as `x-maximus-install` so one phone cannot mint a
  /// second free grant.
  Future<RationWallet> rationWallet(String baseUrl, {String? installId});

  /// POST /api/ration/contributor — turn Contributor Spark on or off.
  Future<RationWallet> acceptRationContributor(String baseUrl, bool accept);

  /// GET /api/usage — token/cost report for a date range.
  Future<UsageReport> usageReport(
    String baseUrl, {
    required String from,
    required String to,
    String groupBy = 'bot',
  });

  /// POST /api/presence/active — report this phone's zone + language.
  Future<void> presenceActive(
    String baseUrl, {
    String? timeZone,
    String? language,
  });

  /// GET /api/local-computer — the bot computer's status.
  Future<BotComputerStatus> localComputer(String baseUrl);

  /// GET /api/local-computer/instances — VM inventory.
  Future<List<Map<String, Object?>>> localComputerInstances(String baseUrl);

  /// POST /api/local-computer/:action — pull/run/start/stop/remove.
  Future<BotComputerStatus> localComputerAction(
    String baseUrl,
    String action,
  );

  /// POST /api/local-computer/screenshot — a still of the shared desktop.
  Future<Uint8List?> localComputerScreenshot(String baseUrl);

  /// POST /api/local-computer/input — click, type, key, or open a page
  /// on the shared desktop. [action] is click, type, key, or open.
  Future<void> localComputerInput(
    String baseUrl,
    Map<String, Object?> action,
  );

  Future<StreamSubscription<LiveEvent>> events(
    String baseUrl,
    void Function(LiveEvent) onEvent, {
    void Function(Object error)? onError,
  });
  void close();
}

/// Phase 7: verified console sign-in (account token + user).
class ConsoleLogin {
  const ConsoleLogin({
    required this.token,
    required this.userId,
    required this.email,
  });

  final String token;
  final String userId;
  final String email;

  static ConsoleLogin fromJson(Map<String, Object?> json) {
    final user = json['user'];
    final userMap = user is Map<String, Object?> ? user : <String, Object?>{};
    return ConsoleLogin(
      token: json['token']! as String,
      userId: (userMap['id'] as String?) ?? '',
      email: (userMap['email'] as String?) ?? '',
    );
  }
}

/// Phase 7: a sent invite plus its single-use accept token.
class ConsoleInviteSend {
  const ConsoleInviteSend({required this.invite, required this.token});

  final ConsoleInvite invite;
  final String token;

  static ConsoleInviteSend fromJson(Map<String, Object?> json) =>
      ConsoleInviteSend(
        invite: ConsoleInvite.tryFrom(json['invite'])!,
        token: (json['token'] as String?) ?? '',
      );
}

/// Typed Maximus server client over `dart:io` HttpClient.
///
/// Auth: session cookie jar (pairing/OTP set it) plus the pairing token,
/// sent as `Authorization: Bearer` (what every server honors) and as
/// `x-maximus-companion-auth` (desktop-managed sidecar powers).
class MaximusClient implements MaximusApi {
  MaximusClient({HttpClient? http}) : _http = http ?? HttpClient();

  final HttpClient _http;
  final Map<String, String> _cookies = {};
  bool _closed = false;

  @override
  void setCompanionToken(String? token) => _companionToken = token;
  String? _companionToken;

  @override
  void endSession() {
    _companionToken = null;
    _cookies.clear();
  }

  @override
  String? get sessionToken => _companionToken;

  /// Applies the pairing token to a request. Bearer is the session
  /// credential every server accepts; the companion header is only
  /// honored by desktop-managed sidecars (ignored elsewhere).
  void _authToken(HttpHeaders headers) {
    final token = _companionToken;
    if (token == null) return;
    headers.set(HttpHeaders.authorizationHeader, 'Bearer $token');
    headers.set('x-maximus-companion-auth', token);
  }

  /// Applies the control-plane account token instead of the session
  /// token (console calls authenticate as the billing account).
  void _authAccount(HttpHeaders headers, String accountToken) {
    headers.set(HttpHeaders.authorizationHeader, 'Bearer $accountToken');
  }

  void _storeCookies(HttpHeaders headers, List<Cookie> parsed) {
    for (final raw in headers['set-cookie'] ?? const <String>[]) {
      final pair = raw.split(';').first.trim();
      final equals = pair.indexOf('=');
      if (equals > 0) {
        _cookies[pair.substring(0, equals)] = pair.substring(equals + 1);
      }
    }
    for (final cookie in parsed) {
      if (cookie.name.isEmpty) continue;
      _cookies[cookie.name] = cookie.value;
    }
    for (final entry in _cookies.entries) {
      if (entry.key.startsWith('maximus_session') && entry.value.isNotEmpty) {
        _companionToken = entry.value;
      }
    }
  }

  Future<Map<String, Object?>> _json(
    String method,
    Uri url, {
    Map<String, Object?>? body,
    String? accountToken,
    Map<String, String>? headers,
  }) async {
    if (_closed) throw StateError('client is closed');
    final request = await _http.openUrl(method, url);
    request.headers.contentType = ContentType.json;
    request.headers.set(HttpHeaders.acceptHeader, 'application/json');
    if (accountToken != null) {
      _authAccount(request.headers, accountToken);
    } else {
      _authToken(request.headers);
    }
    headers?.forEach(request.headers.set);
    if (_cookies.isNotEmpty) {
      request.cookies.addAll([
        for (final entry in _cookies.entries)
          Cookie(entry.key, entry.value),
      ]);
    }
    if (body != null) request.write(jsonEncode(body));
    final response = await request.close();
    _storeCookies(response.headers, response.cookies);
    final text = await response.transform(utf8.decoder).join();
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw _decodeError(response.statusCode, text);
    }
    final Object? decoded;
    try {
      decoded = jsonDecode(text);
    } on FormatException {
      throw ApiError(
        response.statusCode,
        text.trimLeft().startsWith('<')
            ? 'The server returned a page instead of data.'
            : 'The server returned data the app could not read.',
      );
    }
    if (decoded is! Map<String, Object?>) {
      throw ApiError(response.statusCode, 'unexpected response shape');
    }
    return decoded;
  }

  ApiError _decodeError(int status, String text) {
    try {
      final decoded = jsonDecode(text);
      if (decoded is Map<String, Object?>) {
        return ApiError(
          status,
          (decoded['error'] as String?) ?? 'request failed',
          code: decoded['code'] as String?,
          details: decoded,
        );
      }
    } catch (_) {}
    return ApiError(status, text.isEmpty ? 'request failed' : text);
  }

  Uri _u(String baseUrl, String path, [Map<String, String>? query]) {
    final base = Uri.parse(baseUrl);
    return base.replace(
      path: path,
      queryParameters: {...base.queryParameters, ...?query},
    );
  }

  /// GET /api/health — reachability probe.
  @override
  Future<bool> probe(String baseUrl) async {
    try {
      await _json('GET', _u(baseUrl, '/api/health'));
      return true;
    } catch (_) {
      return false;
    }
  }

  /// GET /api/bots — bots with an optional first message page.
  @override
  Future<List<BotSummary>> bots(String baseUrl, {int messages = 0}) async {
    final json = await _json(
      'GET',
      _u(baseUrl, '/api/bots', {'messages': '$messages'}),
    );
    final list = json['bots'] as List? ?? const [];
    return [
      for (final item in list)
        if (item is Map<String, Object?>) BotSummary.fromJson(item),
    ];
  }

  /// GET /api/threads/{id}/messages — paged transcript.
  @override
  Future<ThreadMessages> threadMessages(
    String baseUrl,
    String threadId, {
    String? before,
    int limit = 50,
  }) async {
    final json = await _json(
      'GET',
      _u(baseUrl, '/api/threads/$threadId/messages', {
        'limit': '$limit',
        'before': ?before,
      }),
    );
    final list = json['messages'] as List? ?? const [];
    return ThreadMessages(
      messages: [
        for (final item in list)
          if (item is Map<String, Object?>) ChatMessage.fromJson(item),
      ],
      hasMore: (json['hasMore'] as bool?) ?? false,
    );
  }

  /// PATCH /api/bots/{id}/tasks/{threadId} — pin/archive/rename a thread.
  @override
  Future<void> patchTask(
    String baseUrl,
    String botId,
    String threadId,
    Map<String, Object?> patch,
  ) async {
    await _json(
      'PATCH',
      _u(baseUrl, '/api/bots/$botId/tasks/$threadId'),
      body: patch,
    );
  }

  /// Auth headers for out-of-client loads (attachment images).
  @override
  Map<String, String> authedHeaders() {
    return {
      if (_companionToken != null) ...{
        HttpHeaders.authorizationHeader: 'Bearer ${_companionToken!}',
        'x-maximus-companion-auth': _companionToken!,
      },
      if (_cookies.isNotEmpty)
        'cookie': [
          for (final entry in _cookies.entries)
            '${entry.key}=${entry.value}',
        ].join('; '),
    };
  }

  /// POST /api/bots/{id}/messages — send a chat message.
  @override
  Future<ChatMessage> sendMessage(
    String baseUrl,
    String botId,
    String text, {
    List<Map<String, Object?>> attachments = const [],
    String? replyToId,
  }) async {
    final json = await _json('POST', _u(baseUrl, '/api/bots/$botId/messages'),
        body: {
          'text': text,
          if (attachments.isNotEmpty) 'attachments': attachments,
          'replyToId': ?replyToId,
        });
    return _requireMessage(json);
  }

  /// POST /api/groups/{id}/messages — send to a room.
  @override
  Future<ChatMessage> sendGroupMessage(
    String baseUrl,
    String groupId,
    String text, {
    List<Map<String, Object?>> attachments = const [],
  }) async {
    final json = await _json(
      'POST',
      _u(baseUrl, '/api/groups/$groupId/messages'),
      body: {
        'text': text,
        if (attachments.isNotEmpty) 'attachments': attachments,
      },
    );
    return _requireMessage(json);
  }

  ChatMessage _requireMessage(Map<String, Object?> json) {
    final message = json['message'];
    if (message is Map<String, Object?>) return ChatMessage.fromJson(message);
    throw ApiError(200, 'send returned no message');
  }

  /// POST /api/attachments — raw-bytes upload, returns the stored file ref.
  @override
  Future<UploadedAttachment> uploadAttachment(
    String baseUrl,
    List<int> bytes,
    String mime,
  ) async {
    if (_closed) throw StateError('client is closed');
    final url = _u(baseUrl, '/api/attachments', {'uploadId': _uuidV4()});
    final request = await _http.openUrl('POST', url);
    request.headers.contentType = ContentType.parse(mime);
    request.headers.set(HttpHeaders.acceptHeader, 'application/json');
    _authToken(request.headers);
    if (_cookies.isNotEmpty) {
      request.cookies.addAll([
        for (final entry in _cookies.entries)
          Cookie(entry.key, entry.value),
      ]);
    }
    request.add(bytes);
    final response = await request.close();
    _storeCookies(response.headers, response.cookies);
    final text = await response.transform(utf8.decoder).join();
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw _decodeError(response.statusCode, text);
    }
    return UploadedAttachment.fromJson(
      jsonDecode(text) as Map<String, Object?>,
    );
  }

  /// POST /api/threads/{thread}/messages/{id}/reactions — toggle a reaction.
  @override
  Future<ChatMessage?> react(
    String baseUrl,
    String threadId,
    String messageId,
    String emoji,
    bool on,
  ) async {
    final json = await _json(
      'POST',
      _u(baseUrl, '/api/threads/$threadId/messages/$messageId/reactions'),
      body: {'emoji': emoji, 'on': on},
    );
    final message = json['message'];
    return message is Map<String, Object?>
        ? ChatMessage.fromJson(message)
        : null;
  }

  /// POST /api/bots/{id}/interrupt — stop the running turn.
  @override
  Future<void> interrupt(
    String baseUrl,
    String botId,
    String threadId,
  ) async {
    await _json('POST', _u(baseUrl, '/api/bots/$botId/interrupt'),
        body: {'threadId': threadId});
  }

  /// POST /api/threads/:id/respond — answer an approval/question card.
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
    final json = await _json('POST', _u(baseUrl, '/api/threads/$threadId/respond'),
        body: {
          'requestId': requestId,
          'behavior': behavior,
          'message': ?message,
          if (always) 'always': true,
          if (dismiss) 'dismiss': true,
        });
    return (json['outcome'] as String?) ?? 'answered';
  }

  /// POST /api/bots — create a bot.
  @override
  Future<BotSummary> createBot(String baseUrl, {String? name}) async {
    final json = await _json('POST', _u(baseUrl, '/api/bots'),
        body: {'name': ?name});
    final bot = json['bot'];
    if (bot is Map<String, Object?>) return BotSummary.fromJson(bot);
    throw ApiError(200, 'create returned no bot');
  }

  /// PATCH /api/bots/{id} — edit name/title/description.
  @override
  Future<BotSummary> patchBot(
    String baseUrl,
    String botId,
    Map<String, Object?> patch,
  ) async {
    final json = await _json(
      'PATCH',
      _u(baseUrl, '/api/bots/$botId'),
      body: patch,
    );
    final bot = json['bot'] ?? json;
    if (bot is Map<String, Object?>) return BotSummary.fromJson(bot);
    throw ApiError(200, 'patch returned no bot');
  }

  /// GET /api/bots groups section — rooms list.
  @override
  Future<List<GroupSummary>> groups(String baseUrl) async {
    final json = await _json('GET', _u(baseUrl, '/api/bots'));
    final list = json['groups'] as List? ?? const [];
    return [
      for (final item in list)
        if (item is Map<String, Object?>) ?GroupSummary.fromJson(item),
    ];
  }

  /// POST /api/groups — create a room.
  @override
  Future<GroupSummary> createGroup(
    String baseUrl, {
    String? name,
    List<String> memberIds = const [],
  }) async {
    final json = await _json('POST', _u(baseUrl, '/api/groups'),
        body: {'name': ?name, 'memberIds': memberIds});
    final group = json['group'];
    if (group is Map<String, Object?>) {
      final parsed = GroupSummary.fromJson(group);
      if (parsed != null) return parsed;
    }
    throw ApiError(200, 'create returned no group');
  }

  /// PATCH /api/groups/:id/setup — finish first-run room setup.
  @override
  Future<GroupSummary> finishGroupSetup(
    String baseUrl,
    String groupId, {
    bool skip = false,
    String bulletin = '',
    Map<String, Object?>? defaultResponder,
  }) async {
    final json = await _json(
        'PATCH', _u(baseUrl, '/api/groups/$groupId/setup'),
        body: skip
            ? {'action': 'skip'}
            : {
                'action': 'complete',
                'bulletin': bulletin,
                'defaultResponder': ?defaultResponder,
              });
    final group = json['group'];
    if (group is Map<String, Object?>) {
      final parsed = GroupSummary.fromJson(group);
      if (parsed != null) return parsed;
    }
    throw ApiError(200, 'setup returned no group');
  }

  /// POST /api/auth/pair — redeem a pairing code; stores the session cookie
  /// and returns the bearer token to keep in secure storage.
  @override
  Future<PairedSession> pair(
    String baseUrl, {
    required String code,
    required String label,
  }) async {
    final json = await _json('POST', _u(baseUrl, '/api/auth/pair'),
        body: {'code': code, 'label': label});
    return PairedSession(
      token: json['token'] as String?,
      scopes: [
        for (final s in (json['session'] as Map?)?['scopes'] as List? ?? const [])
          '$s',
      ],
    );
  }

  Future<List<String>> _account(
    String method,
    String baseUrl,
    String path, {
    required String email,
    required String password,
  }) async {
    final json = await _json(method, _u(baseUrl, path), body: {
      'email': email,
      'password': password,
    });
    final session = json['session'];
    if (session is! Map) return const [];
    return [
      for (final scope in (session['scopes'] as List? ?? const [])) '$scope',
    ];
  }

  @override
  Future<List<String>> passwordSignIn(
    String baseUrl, {
    required String email,
    required String password,
  }) {
    return _account('POST', baseUrl, '/api/auth/signin', email: email, password: password);
  }

  @override
  Future<List<String>> passwordSignUp(
    String baseUrl, {
    required String email,
    required String password,
  }) {
    return _account('POST', baseUrl, '/api/auth/signup', email: email, password: password);
  }

  /// POST /api/auth/email/start — request an email OTP code.
  @override
  Future<void> emailStart(String baseUrl, String email) async {
    await _json('POST', _u(baseUrl, '/api/auth/email/start'),
        body: {'email': email});
  }

  /// POST /api/auth/email/verify — redeem the OTP; stores the session cookie.
  @override
  Future<List<String>> emailVerify(
    String baseUrl, {
    required String email,
    required String code,
  }) async {
    final json = await _json('POST', _u(baseUrl, '/api/auth/email/verify'),
        body: {'email': email, 'code': code});
    final session = json['session'];
    if (session is! Map) return const [];
    return [
      for (final s in (session['scopes'] as List? ?? const [])) '$s',
    ];
  }

  static const _oauthProviders = {'google', 'github', 'apple', 'microsoft'};

  @override
  Future<List<Map<String, String>>> signInMethods(String baseUrl) async {
    final json = await _json('GET', _u(baseUrl, '/api/auth/methods'));
    final rows = json['methods'];
    if (rows is! List) return const [];
    return [
      for (final row in rows)
        if (row is Map &&
            row['id'] is String &&
            row['label'] is String &&
            _oauthProviders.contains(row['id']))
          {'id': row['id'] as String, 'label': row['label'] as String},
    ];
  }

  @override
  Future<String> oauthStart(String baseUrl, String provider) async {
    if (!_oauthProviders.contains(provider)) {
      throw ApiError(400, 'that sign-in is not available');
    }
    final json = await _json(
      'GET',
      _u(baseUrl, '/api/auth/oauth/$provider/start?device=1&json=1'),
    );
    final url = json['url'];
    if (url is! String || !url.startsWith('https://')) {
      throw ApiError(200, 'sign-in did not start');
    }
    return url;
  }

  @override
  Future<List<String>> oauthRedeem(String baseUrl, String ticket) async {
    final json = await _json(
      'POST',
      _u(baseUrl, '/api/auth/oauth/redeem'),
      body: {'ticket': ticket},
    );
    final session = json['session'];
    if (session is! Map) return const [];
    return [
      for (final s in (session['scopes'] as List? ?? const [])) '$s',
    ];
  }

  /// GET /api/search — cross-surface search.
  @override
  Future<List<Map<String, Object?>>> search(
    String baseUrl,
    String query,
  ) async {
    final json = await _json('GET', _u(baseUrl, '/api/search', {'q': query}));
    final hits = json['hits'] as List? ?? const [];
    return [
      for (final hit in hits)
        if (hit is Map<String, Object?>) hit,
    ];
  }

  /// POST /v1/installations/self/push/register — register this phone.
  @override
  Future<bool> registerPush(
    String baseUrl, {
    required String token,
    required String platform,
    String? deviceName,
    String? appVersion,
  }) async {
    final json = await _json(
        'POST', _u(baseUrl, '/v1/installations/self/push/register'),
        body: {
          'token': token,
          'platform': platform,
          'deviceName': ?deviceName,
          'appVersion': ?appVersion,
        });
    return (json['enabled'] as bool?) ?? true;
  }

  /// DELETE .../push/register — remove this phone's token.
  @override
  Future<bool> unregisterPush(String baseUrl, String token) async {
    final json = await _json(
        'DELETE', _u(baseUrl, '/v1/installations/self/push/register'),
        body: {'token': token});
    return (json['removed'] as bool?) ?? false;
  }

  /// GET /v1/installations/self/push — devices + global switch (admin).
  @override
  Future<PushStatus> pushStatus(String baseUrl) async {
    final json =
        await _json('GET', _u(baseUrl, '/v1/installations/self/push'));
    return PushStatus.fromJson(json);
  }

  /// PATCH .../push/settings — flip the global switch (admin).
  @override
  Future<bool> setPushEnabled(String baseUrl, bool enabled) async {
    final json = await _json(
        'PATCH', _u(baseUrl, '/v1/installations/self/push/settings'),
        body: {'enabled': enabled});
    return (json['enabled'] as bool?) ?? enabled;
  }

  /// POST /api/tts/transcribe — speech to text for recorded WAV audio.
  @override
  Future<String> transcribe(String baseUrl, List<int> wavBytes) async {
    if (_closed) throw StateError('client is closed');
    final request = await _http.openUrl(
      'POST',
      _u(baseUrl, '/api/tts/transcribe'),
    );
    request.headers.contentType = ContentType.parse('audio/wav');
    request.headers.set(HttpHeaders.acceptHeader, 'application/json');
    _authToken(request.headers);
    if (_cookies.isNotEmpty) {
      request.cookies.addAll([
        for (final entry in _cookies.entries)
          Cookie(entry.key, entry.value),
      ]);
    }
    request.add(wavBytes);
    final response = await request.close();
    _storeCookies(response.headers, response.cookies);
    final text = await response.transform(utf8.decoder).join();
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw _decodeError(response.statusCode, text);
    }
    final json = jsonDecode(text) as Map<String, Object?>;
    return (json['text'] as String?) ?? '';
  }

  /// POST /api/live/session — trade a WebRTC offer for a live call.
  @override
  Future<LiveSession> startLiveSession(
    String baseUrl, {
    required String botId,
    required String threadId,
    required String sdp,
    required String client,
  }) async {
    final json = await _json('POST', _u(baseUrl, '/api/live/session'),
        body: {
          'botId': botId,
          'threadId': threadId,
          'sdp': sdp,
          'client': client,
        });
    final call = json['call'];
    final transport = json['transport'] as Map?;
    final answer = transport?['sdp'] as String?;
    if (call is! Map<String, Object?> || answer == null) {
      throw ApiError(200, 'live session returned no call');
    }
    final state = LiveCallState.fromJson(call);
    if (state == null) throw ApiError(200, 'live session returned no call');
    return LiveSession(call: state, answerSdp: answer);
  }

  /// POST /api/live/call/end — hang up.
  @override
  Future<LiveCallState?> endLiveCall(String baseUrl, String callId) async {
    try {
      final json = await _json('POST', _u(baseUrl, '/api/live/call/end'),
          body: {'callId': callId});
      final call = json['call'];
      return call is Map<String, Object?>
          ? LiveCallState.fromJson(call)
          : null;
    } on ApiError catch (error) {
      // Hanging up an already-gone call is success.
      if (error.status == 404) return null;
      rethrow;
    }
  }

  /// GET /api/live/call — the currently running call, if any.
  @override
  Future<LiveCallState?> currentLiveCall(String baseUrl) async {
    final json = await _json('GET', _u(baseUrl, '/api/live/call'));
    final call = json['call'];
    return call is Map<String, Object?>
        ? LiveCallState.fromJson(call)
        : null;
  }

  /// GET /api/routines — schedules plus recent runs.
  @override
  Future<RoutineList> routines(String baseUrl) async {
    final json = await _json('GET', _u(baseUrl, '/api/routines'));
    final routines = json['routines'] as List? ?? const [];
    final runs = json['runs'] as List? ?? const [];
    return RoutineList(
      routines: [
        for (final item in routines)
          if (item is Map<String, Object?>) Routine.fromJson(item),
      ],
      runs: [
        for (final item in runs)
          if (item is Map<String, Object?>) RoutineRun.fromJson(item),
      ],
    );
  }

  /// POST /api/routines — create a schedule.
  @override
  Future<Routine> createRoutine(
    String baseUrl, {
    required String name,
    required String prompt,
    required String botId,
    required Map<String, Object?> schedule,
    bool enabled = true,
  }) async {
    final json = await _json('POST', _u(baseUrl, '/api/routines'),
        body: {
          'name': name,
          'prompt': prompt,
          'botId': botId,
          'schedule': schedule,
          'enabled': enabled,
        });
    final routine = json['routine'] ?? json;
    if (routine is Map<String, Object?>) return Routine.fromJson(routine);
    throw ApiError(200, 'create returned no routine');
  }

  /// PATCH /api/routines/:id — pause/resume/retarget.
  @override
  Future<Routine> patchRoutine(
    String baseUrl,
    String routineId,
    Map<String, Object?> patch,
  ) async {
    final json = await _json(
      'PATCH',
      _u(baseUrl, '/api/routines/$routineId'),
      body: patch,
    );
    final routine = json['routine'] ?? json;
    if (routine is Map<String, Object?>) return Routine.fromJson(routine);
    throw ApiError(200, 'patch returned no routine');
  }

  /// DELETE /api/routines/:id.
  @override
  Future<bool> deleteRoutine(String baseUrl, String routineId) async {
    try {
      await _json('DELETE', _u(baseUrl, '/api/routines/$routineId'));
      return true;
    } on ApiError catch (error) {
      if (error.status == 404) return false;
      rethrow;
    }
  }

  /// POST /api/routines/:id/run — run now.
  @override
  Future<RoutineRun> runRoutineNow(String baseUrl, String routineId) async {
    final json = await _json(
      'POST',
      _u(baseUrl, '/api/routines/$routineId/run'),
    );
    final run = json['run'] ?? json;
    if (run is Map<String, Object?>) return RoutineRun.fromJson(run);
    throw ApiError(200, 'run returned no run');
  }

  /// GET /api/computers/frames — shared-computer screenshots.
  @override
  Future<ComputerFrames> computerFrames(
    String baseUrl, {
    Map<String, int> have = const {},
  }) async {
    final json = await _json(
      'GET',
      _u(baseUrl, '/api/computers/frames', {
        if (have.isNotEmpty)
          'have': have.entries.map((e) => '${e.key}:${e.value}').join(','),
      }),
    );
    final computers = json['computers'] as List? ?? const [];
    return ComputerFrames(
      configured: (json['configured'] as bool?) ?? false,
      available: (json['available'] as bool?) ?? false,
      computers: [
        for (final item in computers)
          if (item is Map<String, Object?>) ?ComputerInfo.fromJson(item),
      ],
    );
  }

  /// POST /api/bots/:id/browser/action — v1 viewer actions.
  @override
  Future<Map<String, Object?>> browserAction(
    String baseUrl,
    String botId,
    Map<String, Object?> action,
  ) async {
    return _json('POST', _u(baseUrl, '/api/bots/$botId/browser/action'),
        body: action);
  }

  /// GET /api/phones — registered phones (admin).
  @override
  Future<List<PublicPhone>> phones(String baseUrl) async {
    final json = await _json('GET', _u(baseUrl, '/api/phones'));
    final list = json['phones'] as List? ?? const [];
    return [
      for (final item in list)
        if (item is Map<String, Object?>) ?PublicPhone.fromJson(item),
    ];
  }

  /// DELETE /api/phones/:key — remove a phone (admin).
  @override
  Future<bool> removePhone(String baseUrl, String key) async {
    try {
      final json = await _json(
        'DELETE',
        _u(baseUrl, '/api/phones/${Uri.encodeComponent(key)}'),
      );
      return (json['removed'] as bool?) ?? true;
    } on ApiError catch (error) {
      if (error.status == 404) return false;
      rethrow;
    }
  }

  /// PUT /api/phones/self — register this phone's apps.
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
    final json = await _json('PUT', _u(baseUrl, '/api/phones/self'),
        body: {
          'installId': installId,
          'name': name,
          'platform': platform,
          'appVersion': appVersion,
          'timeZone': timeZone,
          'capabilities': capabilities,
        });
    final phone = json['phone'];
    return phone is Map<String, Object?>
        ? PublicPhone.fromJson(phone)
        : null;
  }

  /// GET /api/phones/self — this phone's registration.
  @override
  Future<PublicPhone?> phoneSelf(String baseUrl) async {
    try {
      final json = await _json('GET', _u(baseUrl, '/api/phones/self'));
      final phone = json['phone'];
      return phone is Map<String, Object?>
          ? PublicPhone.fromJson(phone)
          : null;
    } on ApiError catch (error) {
      if (error.status == 404) return null;
      rethrow;
    }
  }

  /// DELETE /api/phones/self — unregister this phone.
  @override
  Future<bool> unregisterPhone(String baseUrl) async {
    final json =
        await _json('DELETE', _u(baseUrl, '/api/phones/self'));
    return (json['removed'] as bool?) ?? true;
  }

  /// GET /api/phones/self/jobs — long-poll one assigned job (null: none).
  @override
  Future<PhoneJob?> pollPhoneJob(String baseUrl) async {
    final json =
        await _json('GET', _u(baseUrl, '/api/phones/self/jobs'));
    final job = json['job'];
    return job is Map<String, Object?> ? PhoneJob.fromJson(job) : null;
  }

  /// POST .../jobs/:id/lease — hold the job while executing.
  @override
  Future<bool> leasePhoneJob(String baseUrl, String jobId) async {
    final json = await _json(
      'POST',
      _u(baseUrl, '/api/phones/self/jobs/$jobId/lease'),
    );
    return (json['active'] as bool?) ?? false;
  }

  /// POST .../jobs/:id/result — deliver the outcome.
  @override
  Future<void> completePhoneJob(
    String baseUrl,
    String jobId, {
    required bool ok,
    Object? result,
    String? error,
    String? code,
  }) async {
    await _json(
      'POST',
      _u(baseUrl, '/api/phones/self/jobs/$jobId/result'),
      body: ok
          ? {'ok': true, 'result': result}
          : {
              'ok': false,
              'error': error ?? 'failed',
              'code': ?code,
            },
    );
  }

  // ---- Phase 7: workspace (control plane via the server proxy) ----

  Map<String, Object?> _ws(Map<String, Object?> json, String key) {
    final nested = json[key];
    if (nested is Map<String, Object?>) return nested;
    return json;
  }

  @override
  Future<void> consoleOtpStart(String baseUrl, String email) async {
    await _json(
      'POST',
      _u(baseUrl, '/api/console/auth/otp/start'),
      body: {'email': email},
    );
  }

  @override
  Future<ConsoleLogin> consoleOtpVerify(
    String baseUrl, {
    required String email,
    required String code,
  }) async {
    final json = await _json(
      'POST',
      _u(baseUrl, '/api/console/auth/otp/verify'),
      body: {'email': email, 'code': code},
    );
    return ConsoleLogin.fromJson(json);
  }

  @override
  Future<List<ConsoleMembership>> consoleMemberships(
    String baseUrl,
    String accountToken,
  ) async {
    final json = await _json(
      'GET',
      _u(baseUrl, '/api/console/memberships'),
      accountToken: accountToken,
    );
    return [
      for (final row in (json['memberships'] as List? ?? const []))
        ?ConsoleMembership.tryFrom(row),
    ];
  }

  @override
  Future<ConsoleWorkspace> consoleWorkspace(
    String baseUrl,
    String accountToken,
    String workspaceId,
  ) async {
    final json = await _json(
      'GET',
      _u(baseUrl, '/api/console/workspaces/$workspaceId'),
      accountToken: accountToken,
    );
    return ConsoleWorkspace.fromJson(_ws(json, 'workspace'));
  }

  @override
  Future<ConsoleWorkspace> consoleWorkspaceCreate(
    String baseUrl,
    String accountToken, {
    required String workspace,
    String? displayName,
    String? plan,
  }) async {
    final json = await _json(
      'POST',
      _u(baseUrl, '/api/console/workspaces'),
      accountToken: accountToken,
      body: {
        'workspace': workspace,
        'displayName': ?displayName,
        'plan': ?plan,
      },
    );
    return ConsoleWorkspace.fromJson(_ws(json, 'workspace'));
  }

  @override
  Future<ConsoleInviteSend> consoleInviteSend(
    String baseUrl,
    String accountToken, {
    required String workspace,
    required String email,
    required String role,
  }) async {
    final json = await _json(
      'POST',
      _u(baseUrl, '/api/console/invites'),
      accountToken: accountToken,
      body: {'workspace': workspace, 'email': email, 'role': role},
    );
    return ConsoleInviteSend.fromJson(json);
  }

  @override
  Future<bool> consoleInviteRevoke(
    String baseUrl,
    String accountToken, {
    required String workspace,
    String? userId,
    String? inviteId,
  }) async {
    final json = await _json(
      'POST',
      _u(baseUrl, '/api/console/invites/revoke'),
      accountToken: accountToken,
      body: {'workspace': workspace, 'userId': ?userId, 'inviteId': ?inviteId},
    );
    return json['ok'] == true;
  }

  @override
  Future<ConsoleWorkspace> consoleInviteAccept(
    String baseUrl,
    String accountToken,
    String inviteToken,
  ) async {
    final json = await _json(
      'POST',
      _u(baseUrl, '/api/console/invites/accept'),
      accountToken: accountToken,
      body: {'token': inviteToken},
    );
    return ConsoleWorkspace.fromJson(_ws(json, 'workspace'));
  }

  @override
  Future<WorkspaceSeats> consoleSeats(
    String baseUrl,
    String accountToken,
    String workspaceId,
  ) async {
    final json = await _json(
      'GET',
      _u(baseUrl, '/api/console/admin/seats', {'workspace': workspaceId}),
      accountToken: accountToken,
    );
    return WorkspaceSeats.fromJson(json);
  }

  @override
  Future<WorkspaceSpend> consoleSpend(
    String baseUrl,
    String accountToken,
    String workspaceId,
  ) async {
    final json = await _json(
      'GET',
      _u(baseUrl, '/api/console/workspaces/$workspaceId/spend'),
      accountToken: accountToken,
    );
    return WorkspaceSpend.fromJson(json);
  }

  @override
  Future<Map<String, Object?>> consoleEntitlements(
    String baseUrl,
    String accountToken,
    String workspaceId,
  ) async {
    return _json(
      'GET',
      _u(baseUrl, '/api/console/workspaces/$workspaceId/entitlements'),
      accountToken: accountToken,
    );
  }

  @override
  Future<List<WorkspaceProvider>> consoleProviders(
    String baseUrl,
    String accountToken,
    String workspaceId,
  ) async {
    final json = await _json(
      'GET',
      _u(baseUrl, '/api/console/workspaces/$workspaceId/providers'),
      accountToken: accountToken,
    );
    return WorkspaceProvider.listFrom(json);
  }

  @override
  Future<List<WorkspaceProvider>> consoleSetProviders(
    String baseUrl,
    String accountToken,
    String workspaceId,
    Map<String, Object?> body,
  ) async {
    final json = await _json(
      'PUT',
      _u(baseUrl, '/api/console/workspaces/$workspaceId/providers'),
      accountToken: accountToken,
      body: body,
    );
    return WorkspaceProvider.listFrom(json);
  }

  @override
  Future<List<WorkspaceProvider>> consoleSetProvider(
    String baseUrl,
    String accountToken,
    String workspaceId,
    String providerId,
    Map<String, Object?> body,
  ) async {
    final json = await _json(
      'PUT',
      _u(baseUrl, '/api/console/workspaces/$workspaceId/providers/$providerId'),
      accountToken: accountToken,
      body: body,
    );
    return WorkspaceProvider.listFrom(json);
  }

  @override
  Future<List<ConsolePlan>> consolePlans(String baseUrl) async {
    final json = await _json('GET', _u(baseUrl, '/api/console/plans'));
    return [
      for (final row in (json['plans'] as List? ?? const []))
        ?ConsolePlan.tryFrom(row),
    ];
  }

  @override
  Future<BillingOffer> billingOffer(String baseUrl, {required String timeZone}) async {
    final json = await _json('GET', _u(baseUrl, '/api/billing/offer', {'timeZone': timeZone}));
    return BillingOffer.fromJson(json);
  }

  @override
  Future<BillingCheckout> billingCheckout(
    String baseUrl, {
    required String plan,
    required String customerEmail,
    required String successUrl,
    required String cancelUrl,
    required String timeZone,
  }) async {
    final json = await _json('POST', _u(baseUrl, '/api/billing/checkout'), body: {
      'provider': 'paystack',
      'plan': plan,
      'customerEmail': customerEmail,
      'successUrl': successUrl,
      'cancelUrl': cancelUrl,
      'timeZone': timeZone,
    });
    return BillingCheckout.fromJson(json);
  }

  @override
  Future<StoreGrant> consoleStoreVerify(
    String baseUrl,
    String accountToken, {
    required String workspace,
    required String platform,
    required String receipt,
  }) async {
    final json = await _json(
      'POST',
      _u(baseUrl, '/api/console/billing/store/verify'),
      accountToken: accountToken,
      body: {'workspace': workspace, 'platform': platform, 'receipt': receipt},
    );
    return StoreGrant.fromJson(json);
  }

  @override
  Future<StoreSubscription> consoleStoreStatus(
    String baseUrl,
    String accountToken,
    String workspace,
  ) async {
    final json = await _json(
      'GET',
      _u(baseUrl, '/api/console/billing/store/status', {'workspace': workspace}),
      accountToken: accountToken,
    );
    return StoreSubscription.fromJson(json);
  }

  // ---- Phase 7: settings (paired session) ----

  @override
  Future<AuthSessionInfo> authSession(String baseUrl) async {
    final json = await _json('GET', _u(baseUrl, '/api/auth/session'));
    return AuthSessionInfo.fromJson(json);
  }

  @override
  Future<void> logout(String baseUrl) async {
    await _json('POST', _u(baseUrl, '/api/auth/logout'));
  }

  @override
  Future<List<DeviceSession>> sessions(String baseUrl) async {
    final json = await _json('GET', _u(baseUrl, '/api/auth/sessions'));
    final current = json['current'];
    return [
      for (final row in (json['sessions'] as List? ?? const []))
        ?DeviceSession.tryFrom(
          row,
          currentId: current is String ? current : null,
        ),
    ];
  }

  @override
  Future<bool> revokeSession(String baseUrl, String sessionId) async {
    try {
      await _json('DELETE', _u(baseUrl, '/api/auth/sessions/$sessionId'));
      return true;
    } on ApiError catch (error) {
      if (error.status == 404) return false;
      rethrow;
    }
  }

  @override
  Future<UsageReport> usageReport(
    String baseUrl, {
    required String from,
    required String to,
    String groupBy = 'bot',
  }) async {
    final json = await _json(
      'GET',
      _u(baseUrl, '/api/usage', {'from': from, 'to': to, 'groupBy': groupBy}),
    );
    return UsageReport.fromJson(json);
  }

  @override
  Future<RationWallet> rationWallet(
    String baseUrl, {
    String? installId,
  }) async {
    final json = await _json(
      'GET',
      _u(baseUrl, '/api/ration'),
      headers: installId == null || installId.isEmpty
          ? null
          : {'x-maximus-install': installId},
    );
    return RationWallet.fromJson(json);
  }

  @override
  Future<RationWallet> acceptRationContributor(
    String baseUrl,
    bool accept,
  ) async {
    final json = await _json(
      'POST',
      _u(baseUrl, '/api/ration/contributor'),
      body: {'accept': accept},
    );
    return RationWallet.fromJson(json);
  }

  @override
  Future<void> presenceActive(
    String baseUrl, {
    String? timeZone,
    String? language,
  }) async {
    await _json(
      'POST',
      _u(baseUrl, '/api/presence/active'),
      body: {'source': 'phone', 'timeZone': ?timeZone, 'language': ?language},
    );
  }

  @override
  Future<BotComputerStatus> localComputer(String baseUrl) async {
    final json = await _json('GET', _u(baseUrl, '/api/local-computer'));
    return BotComputerStatus.fromJson(json);
  }

  @override
  Future<List<Map<String, Object?>>> localComputerInstances(
    String baseUrl,
  ) async {
    final json = await _json(
      'GET',
      _u(baseUrl, '/api/local-computer/instances'),
    );
    final list = json['instances'] ?? json['vms'] ?? json['computers'];
    return [
      for (final row in (list as List? ?? const []))
        if (row is Map<String, Object?>) row,
    ];
  }

  @override
  Future<BotComputerStatus> localComputerAction(
    String baseUrl,
    String action,
  ) async {
    final json = await _json(
      'POST',
      _u(baseUrl, '/api/local-computer/$action'),
      body: const {},
    );
    return BotComputerStatus.fromJson(json);
  }

  @override
  Future<Uint8List?> localComputerScreenshot(String baseUrl) async {
    final json = await _json(
      'POST',
      _u(baseUrl, '/api/local-computer/screenshot'),
      body: const {},
    );
    final image = json['image'] as String?;
    if (image == null || image.isEmpty) return null;
    final comma = image.indexOf(',');
    final payload = comma >= 0 ? image.substring(comma + 1) : image;
    try {
      return Uint8List.fromList(base64Decode(payload));
    } catch (_) {
      return null;
    }
  }

  @override
  Future<void> localComputerInput(
    String baseUrl,
    Map<String, Object?> action,
  ) async {
    await _json(
      'POST',
      _u(baseUrl, '/api/local-computer/input'),
      body: action,
    );
  }

  /// Opens `/api/events` and parses the SSE stream into [LiveEvent]s.
  /// The caller owns the subscription; closing it ends the request.
  /// `client=mobile` marks the stream so desktop-preferred push routing
  /// can tell the phone apart from desktop/web streams.
  @override
  Future<StreamSubscription<LiveEvent>> events(
    String baseUrl,
    void Function(LiveEvent) onEvent, {
    void Function(Object error)? onError,
  }) async {
    final request =
        await _http.getUrl(_u(baseUrl, '/api/events', {'client': 'mobile'}));
    request.headers.set(HttpHeaders.acceptHeader, 'text/event-stream');
    _authToken(request.headers);
    if (_cookies.isNotEmpty) {
      request.cookies.addAll([
        for (final entry in _cookies.entries)
          Cookie(entry.key, entry.value),
      ]);
    }
    final response = await request.close();
    if (response.statusCode != 200) {
      final text = await response.transform(utf8.decoder).join();
      throw _decodeError(response.statusCode, text);
    }
    final parser = SseParser();
    final sub = parser.events.listen(onEvent, onError: onError);
    bindLines(response, parser, onError: (error) {
      // Teardown races (client closed mid-stream) are quiet; anything else
      // goes to the caller's handler when one is registered.
      if (_closed) return;
      onError?.call(error);
    }).onDone(() async {
      await sub.cancel();
      await parser.close();
    });
    return sub;
  }

  /// GET /api/bots/:id/browser/live — v1 viewer SSE frames as raw maps.
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
    final request = await _http.getUrl(
      _u(baseUrl, '/api/bots/$botId/browser/live', {
        'threadId': threadId,
        'width': '$width',
        'height': '$height',
      }),
    );
    request.headers.set(HttpHeaders.acceptHeader, 'text/event-stream');
    _authToken(request.headers);
    if (_cookies.isNotEmpty) {
      request.cookies.addAll([
        for (final entry in _cookies.entries)
          Cookie(entry.key, entry.value),
      ]);
    }
    final response = await request.close();
    if (response.statusCode != 200) {
      final text = await response.transform(utf8.decoder).join();
      throw _decodeError(response.statusCode, text);
    }
    final parser = SseParser();
    final sub = parser.events
        .map(browserLiveFrame)
        .listen(onFrame, onError: onError);
    bindLines(response, parser, onError: (error) {
      if (_closed) return;
      onError?.call(error);
    }).onDone(() async {
      await sub.cancel();
      await parser.close();
    });
    return sub;
  }

  @override
  void close() {
    _closed = true;
    _http.close(force: true);
  }
}

class ThreadMessages {
  const ThreadMessages({required this.messages, required this.hasMore});
  final List<ChatMessage> messages;
  final bool hasMore;
}

/// A started live call: server state plus the SDP answer to apply.
class LiveSession {
  const LiveSession({required this.call, required this.answerSdp});
  final LiveCallState call;
  final String answerSdp;
}

/// GET /api/routines payload.
class RoutineList {
  const RoutineList({required this.routines, required this.runs});
  final List<Routine> routines;
  final List<RoutineRun> runs;
}

/// GET /api/computers/frames payload.
class ComputerFrames {
  const ComputerFrames({
    required this.configured,
    required this.available,
    required this.computers,
  });
  final bool configured;
  final bool available;
  final List<ComputerInfo> computers;
}

class PairedSession {
  const PairedSession({this.token, this.scopes = const []});
  final String? token;
  final List<String> scopes;
}
