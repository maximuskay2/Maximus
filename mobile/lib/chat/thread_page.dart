import 'dart:async';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';

import 'package:flutter/services.dart';

import '../api/client.dart';
import '../api/models.dart';
import '../api/thread_cache.dart';
import '../bots/bot_pages.dart';
import '../call/call_page.dart';
import '../settings/preferences.dart';
import '../theme/blobs.dart';
import 'approval_card.dart';
import '../system/live_activities.dart';
import 'composer.dart';
import 'dictation.dart';
import 'drafts.dart';
import 'message_bubble.dart';

/// Live chat thread: transcript, streaming replies, composer, reactions.
class ThreadPage extends StatefulWidget {
  const ThreadPage({
    super.key,
    required this.client,
    required this.baseUrl,
    required this.bot,
    required this.thread,
    this.groupId,
    this.botNames = const [],
    this.imageLoader = defaultAttachmentImageLoader,
    this.drafts,
    this.eventStream,
    this.cache,
    this.serverId,
    this.speech,
    this.initialText,
    this.autoDictate = false,
    this.liveActivities,
  });

  final MaximusApi client;
  final String baseUrl;
  final BotSummary bot;
  final ThreadSummary thread;

  /// Set for room threads: sends go to the group endpoint.
  final String? groupId;
  final List<String> botNames;
  final AttachmentImageLoader imageLoader;

  /// Injectable draft store (memory in tests).
  final DraftStore? drafts;

  /// Injectable live events for tests (defaults to /api/events).
  final Stream<LiveEvent>? eventStream;

  /// Disk cache for stale-while-revalidate (both must be set to enable).
  final ThreadCache? cache;
  final String? serverId;

  /// Prefilled composer text (Siri links); a saved draft wins over this.
  final String? initialText;

  /// Starts composer dictation on open (Siri dictate links).
  final bool autoDictate;

  /// Lock-screen activity driver for dictation; null keeps it in-app only.
  final LiveActivities? liveActivities;

  /// Speech driver for composer dictation (on-device by default).
  final SpeechDriver? speech;

  @override
  State<ThreadPage> createState() => _ThreadPageState();
}

class _ThreadPageState extends State<ThreadPage> {
  final List<ChatMessage> _messages = [];
  bool _hasMore = false;
  bool _loading = true;
  bool _loadingMore = false;
  bool _sending = false;
  bool _working = false;
  bool _finding = false;
  final _find = TextEditingController();
  String? _error;
  String? _sendError;
  ChatMessage? _replyTo;
  final _scroll = ScrollController();
  StreamSubscription<LiveEvent>? _events;
  late final DraftStore _drafts = widget.drafts ?? DraftStore();
  final SpeechDriver _speech = SystemSpeechDriver();

  static const _emojis = ['👍', '❤️', '😂', '🎉', '👀', '🙏'];

  @override
  void initState() {
    super.initState();
    _load();
    _subscribe();
    _scroll.addListener(() {
      if (_scroll.position.pixels <= 120 && _hasMore && !_loadingMore) {
        _loadMore();
      }
    });
  }

  @override
  void dispose() {
    _events?.cancel();
    _scroll.dispose();
    _find.dispose();
    super.dispose();
  }

  Future<void> _subscribe() async {
    if (widget.eventStream != null) {
      _events = widget.eventStream!.listen(_onEvent);
      return;
    }
    try {
      _events = await widget.client.events(widget.baseUrl, _onEvent);
    } catch (_) {
      // Live updates are best-effort; pull-to-refresh still works.
    }
  }

  void _onEvent(LiveEvent event) {
    final threadId = event.data['threadId'] as String?;
    if (threadId != null && threadId != widget.thread.threadId) return;
    final raw = event.data['message'];
    if (raw is! Map<String, Object?>) return;
    final message = ChatMessage.fromJson(raw);
    if (!mounted) return;
    setState(() {
      final index = _messages.indexWhere((m) => m.id == message.id);
      if (index >= 0) {
        _messages[index] = message; // streaming patch / reaction update
      } else {
        _messages.add(message);
      }
      // Empty bot rows are in-progress activity. A work receipt is not
      // the reply, so it leaves the thinking indicator alone.
      if (message.role == 'bot' && !message.workLog) _working = message.blank;
    });
    _scrollToBottom();
  }

  void _scrollToBottom() {
    if (!_scroll.hasClients) return;
    _scroll.animateTo(
      _scroll.position.maxScrollExtent,
      duration: const Duration(milliseconds: 200),
      curve: Curves.easeOut,
    );
  }

  Future<void> _load() async {
    final cache = widget.cache;
    final serverId = widget.serverId;
    setState(() {
      _loading = true;
      _error = null;
    });
    // Stale-while-revalidate: cached page renders instantly, network refreshes.
    if (cache != null && serverId != null) {
      final cached = await cache.readThread(serverId, widget.thread.threadId);
      if (cached != null && mounted) {
        setState(() {
          _messages
            ..clear()
            ..addAll(cached.messages);
          _hasMore = cached.hasMore;
          _loading = false;
        });
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (_scroll.hasClients) {
            _scroll.jumpTo(_scroll.position.maxScrollExtent);
          }
        });
      }
    }
    try {
      final page = await widget.client.threadMessages(
        widget.baseUrl,
        widget.thread.threadId,
      );
      if (cache != null && serverId != null) {
        await cache.writeThread(serverId, widget.thread.threadId, page);
      }
      if (!mounted) return;
      setState(() {
        _messages
          ..clear()
          ..addAll(page.messages);
        _hasMore = page.hasMore;
      });
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (_scroll.hasClients) {
          _scroll.jumpTo(_scroll.position.maxScrollExtent);
        }
      });
    } on ApiError catch (error) {
      // With cached content on screen, a refresh failure is not fatal.
      if (_messages.isEmpty && mounted) {
        setState(() => _error = error.message);
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _loadMore() async {
    if (_messages.isEmpty) return;
    setState(() => _loadingMore = true);
    try {
      final page = await widget.client.threadMessages(
        widget.baseUrl,
        widget.thread.threadId,
        before: _messages.first.id,
      );
      setState(() {
        _messages.insertAll(0, page.messages);
        _hasMore = page.hasMore;
      });
    } on ApiError catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(error.message)));
      }
    } finally {
      if (mounted) setState(() => _loadingMore = false);
    }
  }

  Future<void> _send(OutgoingMessage outgoing) async {
    final optimistic = ChatMessage(
      id: 'optimistic-${DateTime.now().microsecondsSinceEpoch}',
      role: 'user',
      kind: 'text',
      text: outgoing.text,
      replyToId: outgoing.replyToId,
    );
    unawaited(AppPreferences.buzz());
    setState(() {
      _messages.add(optimistic);
      _sending = true;
      _sendError = null;
      _working = true;
    });
    _scrollToBottom();
    try {
      final sent = widget.groupId != null
          ? await widget.client.sendGroupMessage(
              widget.baseUrl,
              widget.groupId!,
              outgoing.text,
              attachments: [
                for (final a in outgoing.attachments)
                  {'path': a.path, 'mime': a.mime},
              ],
            )
          : await widget.client.sendMessage(
              widget.baseUrl,
              widget.bot.id,
              outgoing.text,
              attachments: [
                for (final a in outgoing.attachments)
                  {'path': a.path, 'mime': a.mime},
              ],
              replyToId: outgoing.replyToId,
            );
      if (mounted) {
        setState(() {
          final index = _messages.indexWhere((m) => m.id == optimistic.id);
          if (index >= 0) _messages[index] = sent;
          _working = _awaitingReply;
        });
      }
    } on ApiError catch (error) {
      if (mounted) {
        setState(() {
          _messages.removeWhere((m) => m.id == optimistic.id);
          _sendError = error.message;
          _working = false;
        });
      }
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _stop() async {
    try {
      await widget.client.interrupt(
        widget.baseUrl,
        widget.bot.id,
        widget.thread.threadId,
      );
    } on ApiError catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(error.message)));
      }
    } finally {
      if (mounted) setState(() => _working = false);
    }
  }

  Future<List<UploadedAttachment>> _attach() async {
    final files = await FilePicker.pickFiles();
    final uploaded = <UploadedAttachment>[];
    for (final file in files) {
      try {
        final bytes = await file.readAsBytes();
        final mime = _mimeOf(file.name);
        uploaded.add(
          await widget.client.uploadAttachment(widget.baseUrl, bytes, mime),
        );
      } on ApiError catch (error) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('${file.name}: ${error.message}')),
          );
        }
      }
    }
    return uploaded;
  }

  static String _mimeOf(String name) {
    final lower = name.toLowerCase();
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
    if (lower.endsWith('.gif')) return 'image/gif';
    if (lower.endsWith('.webp')) return 'image/webp';
    if (lower.endsWith('.mp3')) return 'audio/mpeg';
    if (lower.endsWith('.m4a')) return 'audio/mp4';
    if (lower.endsWith('.wav')) return 'audio/wav';
    if (lower.endsWith('.pdf')) return 'application/pdf';
    if (lower.endsWith('.txt')) return 'text/plain';
    return 'application/octet-stream';
  }

  Future<void> _react(ChatMessage message) async {
    final emoji = await showModalBottomSheet<String>(
      context: context,
      builder: (_) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Wrap(
            spacing: 8,
            children: [
              for (final e in _emojis)
                InkWell(
                  onTap: () => Navigator.of(context).pop(e),
                  borderRadius: BorderRadius.circular(24),
                  child: Padding(
                    padding: const EdgeInsets.all(10),
                    child: Text(e, style: const TextStyle(fontSize: 28)),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
    if (emoji == null) return;
    final mine = message.reactions.any((r) => r.emoji == emoji);
    try {
      final updated = await widget.client.react(
        widget.baseUrl,
        widget.thread.threadId,
        message.id,
        emoji,
        !mine,
      );
      if (updated != null && mounted) {
        setState(() {
          final index = _messages.indexWhere((m) => m.id == message.id);
          if (index >= 0) _messages[index] = updated;
        });
      }
    } on ApiError catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(error.message)));
      }
    }
  }

  CardAnswerer _cardAnswerer(ChatMessage target) {
    return (
      String requestId,
      String behavior, {
      String? message,
      bool always = false,
      bool dismiss = false,
    }) => _answerCard(
      target,
      requestId,
      behavior,
      answer: message,
      always: always,
      dismiss: dismiss,
    );
  }

  Future<void> _answerCard(
    ChatMessage message,
    String requestId,
    String behavior, {
    String? answer,
    bool always = false,
    bool dismiss = false,
  }) async {
    try {
      await widget.client.respondToCard(
        widget.baseUrl,
        widget.thread.threadId,
        requestId: requestId,
        behavior: behavior,
        message: answer,
        always: always,
        dismiss: dismiss,
      );
      unawaited(AppPreferences.buzz(medium: true));
      // Optimistic settlement; the server's card update arrives over SSE.
      if (mounted && message.card != null) {
        setState(() {
          final index = _messages.indexWhere((m) => m.id == message.id);
          if (index < 0) return;
          final settled = behavior == 'deny' && !dismiss
              ? message.card!.settled(answered: 'Denied')
              : dismiss
              ? message.card!.settled(dismissed: true)
              : message.card!.settled(
                  answered: behavior == 'allow' ? 'Allowed' : null,
                  answeredText: answer,
                );
          _messages[index] = ChatMessage(
            id: message.id,
            role: message.role,
            kind: message.kind,
            text: message.text,
            attachments: message.attachments,
            reactions: message.reactions,
            hasCard: true,
            card: settled,
            replyToId: message.replyToId,
          );
        });
      }
    } on ApiError catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(error.message)));
      }
    }
  }

  /// True while the latest visible turn is still the person's message,
  /// or the bot has only sent empty in-progress rows.
  bool get _awaitingReply {
    for (var i = _messages.length - 1; i >= 0; i--) {
      final message = _messages[i];
      if (message.blank || message.workLog) continue;
      return message.role != 'bot';
    }
    return _messages.isNotEmpty;
  }

  String? _replyText(String? replyToId) {
    if (replyToId == null) return null;
    for (final message in _messages) {
      if (message.id == replyToId) return message.text ?? message.kind;
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final query = _find.text.trim().toLowerCase();
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.white,
        title: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            BotBlob(color: widget.bot.color, seed: widget.bot.id, size: 22),
            const SizedBox(width: 8),
            Flexible(
              child: Text(
                widget.bot.name,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.more_horiz),
            tooltip: 'Chat menu',
            onPressed: _openMenu,
          ),
        ],
      ),
      body: Column(
        children: [
          if (_finding)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
              child: TextField(
                controller: _find,
                autofocus: true,
                decoration: InputDecoration(
                  hintText: 'Find in chat',
                  isDense: true,
                  filled: true,
                  fillColor: const Color(0xFFF2F2F7),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                    borderSide: BorderSide.none,
                  ),
                  suffixIcon: IconButton(
                    icon: const Icon(Icons.close),
                    onPressed: () => setState(() {
                      _finding = false;
                      _find.clear();
                    }),
                  ),
                ),
                onChanged: (_) => setState(() {}),
              ),
            ),
          Expanded(child: _transcript(query)),
          if (_sendError != null)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              color: Theme.of(context).colorScheme.errorContainer,
              child: Row(
                children: [
                  Expanded(child: Text(_sendError!)),
                  TextButton(
                    onPressed: () => setState(() => _sendError = null),
                    child: const Text('Dismiss'),
                  ),
                ],
              ),
            ),
          Composer(
            threadId: widget.thread.threadId,
            drafts: _drafts,
            botNames: widget.botNames,
            speech: widget.speech ?? _speech,
            onSend: _send,
            onStop: _stop,
            sending: _sending,
            working: _working,
            replyTo: _replyTo,
            onClearReply: () => setState(() => _replyTo = null),
            onAttach: _attach,
            initialText: widget.initialText,
            autoDictate: widget.autoDictate,
            liveActivities: widget.liveActivities,
            liveBotName: widget.bot.name,
            hintText: 'Ask ${widget.bot.name}',
            onCall: widget.groupId == null ? _call : null,
          ),
        ],
      ),
    );
  }

  void _call() {
    Navigator.of(context).push(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => CallPage(
          client: widget.client,
          baseUrl: widget.baseUrl,
          bot: widget.bot,
          thread: widget.thread,
        ),
      ),
    );
  }

  Future<void> _openMenu() async {
    final action = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: Colors.white,
      builder: (sheet) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
          child: Material(
            color: const Color(0xFFF2F2F7),
            borderRadius: BorderRadius.circular(16),
            clipBehavior: Clip.antiAlias,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (widget.groupId == null)
                  ListTile(
                    leading: const Icon(Icons.person_outline),
                    title: const Text('View profile'),
                    onTap: () => Navigator.of(sheet).pop('profile'),
                  ),
                ListTile(
                  leading: const Icon(Icons.search),
                  title: const Text('Find in chat'),
                  onTap: () => Navigator.of(sheet).pop('find'),
                ),
                ListTile(
                  leading: const Icon(Icons.ios_share_outlined),
                  title: const Text('Share as template'),
                  onTap: () => Navigator.of(sheet).pop('template'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
    if (action != null) {
      await _menu(action);
    }
  }

  Future<void> _menu(String action) async {
    switch (action) {
      case 'profile':
        await Navigator.of(context).push(
          MaterialPageRoute(
            builder: (_) => BotProfilePage(
              client: widget.client,
              baseUrl: widget.baseUrl,
              bot: widget.bot,
              cache: widget.cache,
              serverId: widget.serverId,
            ),
          ),
        );
      case 'find':
        setState(() => _finding = true);
      case 'template':
        final lines = [
          '# ${widget.bot.name}',
          if (widget.bot.title.isNotEmpty) widget.bot.title,
          if (widget.bot.description.isNotEmpty) widget.bot.description,
          if ((widget.bot.soul ?? '').isNotEmpty) widget.bot.soul!,
        ];
        await Clipboard.setData(ClipboardData(text: lines.join('\n\n')));
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Template copied. Paste it to share.'),
            ),
          );
        }
    }
  }

  Widget _transcript(String query) {
    if (_loading) return const Center(child: CircularProgressIndicator());
    if (_error != null) {
      return _StateMessage(
        icon: Icons.cloud_off_outlined,
        title: 'Could not load this thread',
        detail: _error!,
        actionLabel: 'Retry',
        onAction: _load,
      );
    }
    if (_messages.isEmpty) {
      return const _StateMessage(
        icon: Icons.chat_bubble_outline,
        title: 'No messages yet',
        detail: 'Say hello below.',
      );
    }
    final visible = [
      for (final message in _messages)
        if (!message.blank &&
            !message.workLog &&
            (query.isEmpty ||
                (message.text ?? '').toLowerCase().contains(query)))
          message,
    ];
    final thinking = query.isEmpty && _working;
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.builder(
        controller: _scroll,
        padding: const EdgeInsets.all(12),
        itemCount: visible.length + (thinking ? 1 : 0) + (_loadingMore ? 1 : 0),
        itemBuilder: (context, index) {
          if (_loadingMore && index == 0) {
            return const Center(
              child: Padding(
                padding: EdgeInsets.all(8),
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
            );
          }
          final offset = _loadingMore ? index - 1 : index;
          if (offset >= visible.length) return const ThinkingBubble();
          final message = visible[offset];
          return MessageBubble(
            message: message,
            baseUrl: widget.baseUrl,
            headers: widget.client.authedHeaders(),
            imageLoader: widget.imageLoader,
            onReact: _react,
            onReply: (m) => setState(() => _replyTo = m),
            replyToText: _replyText(message.replyToId),
            onAnswerCard: _cardAnswerer(message),
          );
        },
      ),
    );
  }
}

class _StateMessage extends StatelessWidget {
  const _StateMessage({
    required this.icon,
    required this.title,
    required this.detail,
    this.actionLabel,
    this.onAction,
  });

  final IconData icon;
  final String title;
  final String detail;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              icon,
              size: 48,
              color: Theme.of(context).colorScheme.onSurfaceVariant,
            ),
            const SizedBox(height: 12),
            Text(title, style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 4),
            Text(
              detail,
              textAlign: TextAlign.center,
              style: TextStyle(
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
            ),
            if (actionLabel != null) ...[
              const SizedBox(height: 16),
              FilledButton(onPressed: onAction, child: Text(actionLabel!)),
            ],
          ],
        ),
      ),
    );
  }
}
