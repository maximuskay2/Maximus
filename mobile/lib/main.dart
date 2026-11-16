import 'dart:async';

import 'package:app_links/app_links.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';

import 'api/client.dart';
import 'api/models.dart';
import 'api/session_store.dart';
import 'api/thread_cache.dart';
import 'auth/auth_state.dart';
import 'auth/forgot_password_page.dart';
import 'auth/signin_page.dart';
import 'auth/splash_page.dart';
import 'auth/welcome_page.dart';
import 'home/home_page.dart';
import 'dart:io' show Platform;

import 'phoneapps/drivers.dart';
import 'phoneapps/executor.dart';
import 'phoneapps/native_phone_apps.dart';
import 'phoneapps/phones_page.dart';
import 'phoneapps/policy.dart';
import 'phoneapps/poller.dart';
import 'push/push_deep_link.dart';
import 'push/push_service.dart';
import 'settings/preferences.dart';
import 'system/app_link.dart';
import 'system/deep_link_router.dart';
import 'system/live_activities.dart';
import 'theme/tokens.dart';
import 'workspace/console_account.dart';

@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  await Firebase.initializeApp();
}

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  try {
    await Firebase.initializeApp();
    FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);
  } catch (_) {}
  runApp(const MaximusApp());
}

class MaximusApp extends StatefulWidget {
  const MaximusApp({super.key, this.auth, this.push});

  /// Injectable for tests.
  final AuthState? auth;
  final PushController? push;

  @override
  State<MaximusApp> createState() => _MaximusAppState();
}

class _MaximusAppState extends State<MaximusApp>
    with WidgetsBindingObserver {
  late final AuthState _auth;
  late final MaximusApi _client;
  late final PushController _push;
  final _nav = GlobalKey<NavigatorState>();
  final _banners = GlobalKey<ScaffoldMessengerState>();
  Timer? _bannerTimer;
  PhoneJobPoller? _phonePoller;
  String? _phoneServer;
  late final AppPreferences _prefs;
  ConsoleAccount? _console;
  String? _consoleServer;
  late final DeepLinkRouter _links;
  StreamSubscription<Uri>? _linkSub;
  String? _siriServer;
  String? _linkFlushServer;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    if (widget.auth != null) {
      _auth = widget.auth!;
      _client = _auth.client;
    } else {
      _client = MaximusClient();
      _auth = AuthState(store: SecureSessionStore(), client: _client);
      _auth.load();
    }
    _push = widget.push ?? PushController(messaging: FirebasePushMessaging());
    _push.onForeground = _showBanner;
    _push.onTap = _openTap;
    _links = DeepLinkRouter(auth: _auth, live: LiveActivities());
    // `maximus://` links from Siri, Shortcuts, and the Action button.
    // uriLinkStream replays the cold-start link on subscribe.
    _linkSub = AppLinks().uriLinkStream.listen(
      _onAppLink,
      onError: (_) {},
    );
    _prefs = AppPreferences();
    _prefs.load();
    // Disk cache is best-effort: the app works fully without it.
    DiskCache.shared().then(
      (disk) => _auth.cache = ThreadCache(disk),
      onError: (_) {},
    );
  }

  void _onAppLink(Uri uri) {
    if (uri.scheme == 'maximus' && uri.host == 'oauth') {
      unawaited(_redeemOAuth(uri));
      return;
    }
    final resetToken = uri.queryParameters['token']?.trim() ?? '';
    if ((uri.scheme == 'https' || uri.scheme == 'http') && uri.path == '/reset' && resetToken.isNotEmpty) {
      _nav.currentState?.push(
        MaterialPageRoute<void>(
          builder: (_) => ForgotPasswordPage(auth: _auth, initialToken: resetToken),
        ),
      );
      return;
    }
    final link = AppLink.parse(uri);
    if (link == null) return;
    final nav = _nav.currentState;
    if (nav == null) {
      _links.pending = link;
      return;
    }
    unawaited(_links.open(nav.context, link));
  }

  Future<void> _redeemOAuth(Uri uri) async {
    final ticket = uri.queryParameters['ticket']?.trim() ?? '';
    final server = uri.queryParameters['server']?.trim() ?? '';
    final error = uri.queryParameters['error']?.trim() ?? '';
    final origin = Uri.tryParse(server);
    final usable = origin != null &&
        (origin.scheme == 'http' || origin.scheme == 'https') &&
        origin.host.isNotEmpty &&
        origin.userInfo.isEmpty;
    if (error.isNotEmpty || ticket.isEmpty || !usable) {
      _banners.currentState?.showSnackBar(
        SnackBar(content: Text(error.isEmpty ? 'Sign-in could not be finished.' : error)),
      );
      return;
    }
    try {
      await _auth.redeemOAuth(baseUrl: origin.origin, ticket: ticket);
      _nav.currentState?.popUntil((route) => route.isFirst);
    } on ApiError catch (error) {
      _banners.currentState?.showSnackBar(SnackBar(content: Text(error.message)));
    }
  }

  /// Siri bot names follow the active server; the pending link (if any)
  /// opens once, right after activation.
  void _ensureSiriNames(String serverId) {
    if (_siriServer == serverId) return;
    _siriServer = serverId;
    unawaited(_links.syncNames());
  }

  void _flushPendingLink(String serverId) {
    if (_linkFlushServer == serverId) return;
    _linkFlushServer = serverId;
    final nav = _nav.currentState;
    if (nav == null) return;
    WidgetsBinding.instance.addPostFrameCallback(
      (_) => _links.flush(nav.context),
    );
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _linkSub?.cancel();
    _bannerTimer?.cancel();
    _phonePoller?.dispose();
    _console?.dispose();
    _prefs.dispose();
    if (widget.auth == null) _client.close();
    if (widget.push == null) _push.dispose();
    _auth.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _phonePoller?.foreground = state == AppLifecycleState.resumed;
    if (state == AppLifecycleState.resumed) _reportPresence();
  }

  /// Best-effort zone + language report so briefs and schedules use
  /// this phone's context. Never blocks, never surfaces errors.
  void _reportPresence() {
    final active = _auth.active;
    if (active == null) return;
    unawaited(
      _client
          .presenceActive(
            active.baseUrl,
            timeZone: _prefs.timeZone ?? DateTime.now().timeZoneName,
            language: _prefs.language,
          )
          .then((_) {}, onError: (_) {}),
    );
  }

  /// One console account per active server (created on demand).
  void _ensureConsoleAccount(String baseUrl, String serverId) {
    if (_consoleServer == serverId && _console != null) return;
    _console?.dispose();
    final account = ConsoleAccount(
      client: _client,
      serverId: serverId,
      baseUrl: baseUrl,
    );
    _console = account;
    _consoleServer = serverId;
    account.load();
  }

  /// One job poller per active server, started when the phone registered
  /// its apps (the Phones page's Share tap, or a previous session).
  void _ensurePhonePoller(String baseUrl, String serverId) {
    if (_phoneServer == serverId && _phonePoller != null) return;
    _phonePoller?.dispose();
    final poller = PhoneJobPoller(
      client: _client,
      baseUrl: baseUrl,
      executor: PhoneToolExecutor(
        capabilities: {
          'calendar',
          if (Platform.isIOS) 'reminders',
          'alarms',
          'contacts',
          'location',
          if (Platform.isIOS) 'home',
          'messages',
        },
        calendar: SystemCalendarDriver(),
        reminders: Platform.isIOS ? SystemRemindersDriver() : null,
        alarms: SystemAlarmsDriver(),
        contacts: SystemContactsDriver(),
        location: SystemLocationDriver(),
        home: Platform.isIOS ? SystemHomeDriver() : null,
        messages: SystemMessageDriver(),
      ),
      policies: PhonePolicyStore(),
    );
    poller.approver = _askAboutJob;
    _phonePoller = poller;
    _phoneServer = serverId;
    // Resume polling when the phone already shared its apps.
    _client.phoneSelf(baseUrl).then((self) {
      if (self != null) poller.start();
    }, onError: (_) {});
  }

  /// Permission card for one job; resolves true on Allow. The card is
  /// one decision — Always/Never live on the Phones page.
  Future<bool> _askAboutJob(PhoneJob job, {required bool isWrite}) async {
    final context = _nav.currentContext;
    if (context == null) return false;
    final answer = await showModalBottomSheet<bool>(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (sheet) => Align(
        alignment: Alignment.bottomCenter,
        child: Container(
          decoration: const BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
          ),
          child: SafeArea(
            top: false,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                PhoneJobCard(job: job),
                Padding(
                  padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
                  child: Row(
                    children: [
                      Expanded(
                        child: OutlinedButton(
                          style: OutlinedButton.styleFrom(
                            shape: const StadiumBorder(),
                            padding: const EdgeInsets.symmetric(vertical: 14),
                          ),
                          onPressed: () => Navigator.of(sheet).pop(false),
                          child: const Text('Deny'),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: FilledButton(
                          style: FilledButton.styleFrom(
                            backgroundColor: MaxTokens.ember,
                            foregroundColor: Colors.white,
                            shape: const StadiumBorder(),
                            padding: const EdgeInsets.symmetric(vertical: 14),
                          ),
                          onPressed: () => Navigator.of(sheet).pop(true),
                          child: const Text('Allow'),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
    return answer == true;
  }

  void _showBanner(PushTap tap) {
    final messenger = _banners.currentState;
    if (messenger == null) return;
    _bannerTimer?.cancel();
    messenger
      ..clearMaterialBanners()
      ..showMaterialBanner(
        MaterialBanner(
          content: Text(
            tap.title ?? tap.body ?? 'Update from Maximus',
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
          ),
          actions: [
            TextButton(
              onPressed: () {
                messenger.clearMaterialBanners();
                _openTap(tap);
              },
              child: const Text('View'),
            ),
            TextButton(
              onPressed: messenger.clearMaterialBanners,
              child: const Text('Later'),
            ),
          ],
        ),
      );
    _bannerTimer = Timer(const Duration(seconds: 6), () {
      _banners.currentState?.clearMaterialBanners();
    });
  }

  void _openTap(PushTap tap) {
    final server = _auth.active;
    if (server == null || tap.threadId.isEmpty) return;
    _nav.currentState?.push(
      MaterialPageRoute(
        builder: (_) => PushDeepLinkPage(
          client: _client,
          baseUrl: server.baseUrl,
          tap: tap,
          cache: _auth.cache,
          serverId: server.id,
          onSessionEnded: _auth.sessionEnded,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: _auth,
      builder: (context, _) {
        final active = _auth.active;
        // Push follows the active server; leaving it (logout, removal)
        // unregisters this phone.
        if (active == null) {
          unawaited(_push.stop());
          _phonePoller?.stop();
          _phonePoller?.dispose();
          _phonePoller = null;
          _phoneServer = null;
          _console?.dispose();
          _console = null;
          _consoleServer = null;
        } else {
          unawaited(_push.ensureStarted(_client, active.baseUrl));
          _ensurePhonePoller(active.baseUrl, active.id);
          _ensureConsoleAccount(active.baseUrl, active.id);
          _ensureSiriNames(active.id);
          _flushPendingLink(active.id);
        }
        return ListenableBuilder(
          listenable: _prefs,
          builder: (context, _) => MaterialApp(
            title: 'Maximus',
            theme: MaxTokens.light(),
            darkTheme: MaxTokens.dark(),
            themeMode: _prefs.theme,
            navigatorKey: _nav,
            scaffoldMessengerKey: _banners,
            home: SplashGate(
              ready: _auth.loaded,
              child: active == null
                  ? WelcomePage(auth: _auth)
                  : _auth.needsSignIn
                  ? SignInPage(auth: _auth, initialBaseUrl: active.baseUrl)
                  : HomePage(
                      auth: _auth,
                      push: _push,
                      phonePoller: _phonePoller,
                      prefs: _prefs,
                      consoleAccount: _console,
                    ),
            ),
          ),
        );
      },
    );
  }
}
