import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../api/client.dart';
import '../api/models.dart';

/// Watches a bot's browser over the frozen v1 viewer protocol (SSE frames
/// + action posts): live screenshot, take over / hand back for passwords,
/// 2FA and CAPTCHAs, tap-to-click, typed text, and page navigation.
class ComputerPage extends StatefulWidget {
  const ComputerPage({
    super.key,
    required this.client,
    required this.baseUrl,
    required this.bot,
    required this.thread,
    this.embedded = false,
  });

  final MaximusApi client;
  final String baseUrl;
  final BotSummary bot;
  final ThreadSummary thread;

  /// Drawn inside Bot computer's Browser tab, which already has the page bar.
  final bool embedded;

  @override
  State<ComputerPage> createState() => _ComputerPageState();
}

class _ComputerPageState extends State<ComputerPage> {
  StreamSubscription<Map<String, Object?>>? _live;
  String? _viewerId;
  Uint8List? _frame;
  int _deviceWidth = 0;
  int _deviceHeight = 0;
  String? _url;
  bool _held = false;
  bool _owned = false;
  bool _controlling = false;
  String? _error;
  bool _connecting = true;
  String? _waiting;
  Timer? _giveUp;
  int _connectGeneration = 0;
  final _typeController = TextEditingController();
  final _openController = TextEditingController();
  List<_LiveTab> _tabs = const [];

  @override
  void initState() {
    super.initState();
    // The viewport size rides the first layout; connect right after.
    WidgetsBinding.instance.addPostFrameCallback((_) => _connect());
  }

  @override
  void dispose() {
    _giveUp?.cancel();
    _live?.cancel();
    _typeController.dispose();
    _openController.dispose();
    super.dispose();
  }

  Future<void> _connect() async {
    if (!mounted) return;
    _giveUp?.cancel();
    final generation = ++_connectGeneration;
    await _live?.cancel();
    final size = MediaQuery.sizeOf(context);
    try {
      _live = await widget.client.browserLive(
        widget.baseUrl,
        widget.bot.id,
        widget.thread.threadId,
        size.width.round(),
        size.height.round(),
        _onFrame,
        onError: (error) {
          if (!mounted) return;
          _giveUp?.cancel();
          setState(() {
            _error = '$error';
            _connecting = false;
          });
        },
      );
      final live = _live;
      if (live != null) {
        unawaited(live.asFuture<void>().then((_) {
          if (!mounted || generation != _connectGeneration) return;
          if (_viewerId != null || _error != null) return;
          _giveUp?.cancel();
          setState(() {
            _error = 'The browser closed before it opened.';
            _connecting = false;
          });
        }));
      }
    } on ApiError catch (error) {
      if (mounted) {
        setState(() {
          _error = error.message;
          _connecting = false;
        });
      }
    }
    if (!mounted || _viewerId != null || _error != null) return;
    _giveUp = Timer(const Duration(seconds: 25), () {
      if (!mounted || _viewerId != null || _error != null) return;
      setState(() {
        _connecting = false;
        _error = 'The browser did not open. Reconnect to try again.';
      });
    });
  }

  void _onFrame(Map<String, Object?> frame) {
    if (!mounted) return;
    switch (frame['type']) {
      case 'ready':
        _giveUp?.cancel();
        setState(() {
          _viewerId = frame['viewerId'] as String?;
          _connecting = false;
          _waiting = null;
        });
      case 'waiting':
        setState(() {
          _waiting = 'The browser is starting. The first open can take a minute.';
        });
      case 'frame':
        final data = frame['data'] as String?;
        final meta = frame['metadata'] as Map?;
        final seq = (frame['seq'] as num?)?.toInt();
        if (data != null) {
          try {
            final bytes = base64Decode(data);
            setState(() {
              _frame = bytes;
              _deviceWidth =
                  (meta?['deviceWidth'] as num?)?.toInt() ?? 0;
              _deviceHeight =
                  (meta?['deviceHeight'] as num?)?.toInt() ?? 0;
            });
          } catch (_) {}
        }
        if (seq != null) _act({'type': 'ack', 'seq': seq}, quiet: true);
      case 'control':
        setState(() {
          _held = (frame['held'] as bool?) ?? false;
          _owned = (frame['owned'] as bool?) ?? false;
          _controlling = (frame['controlling'] as bool?) ?? false;
        });
      case 'url':
        setState(() => _url = frame['url'] as String?);
      case 'error':
        setState(() {
          _error =
              (frame['message'] as String?) ?? 'The browser stream ended.';
          _connecting = false;
        });
      case 'tabs':
        final raw = frame['tabs'];
        if (raw is! List) break;
        setState(() {
          _tabs = [
            for (final item in raw)
              if (item is Map)
                _LiveTab(
                  id: '${item['tabId'] ?? ''}',
                  title: '${item['title'] ?? ''}',
                  url: '${item['url'] ?? ''}',
                  active: item['active'] == true,
                ),
          ].where((tab) => tab.id.isNotEmpty).toList();
        });
      case 'heartbeat':
      case 'status':
        break;
    }
  }

  Future<bool> _act(Map<String, Object?> action, {bool quiet = false}) async {
    final viewerId = _viewerId;
    if (viewerId == null) return false;
    try {
      await widget.client.browserAction(
        widget.baseUrl,
        widget.bot.id,
        {'viewerId': viewerId, ...action},
      );
      return true;
    } on ApiError catch (error) {
      if (!quiet && mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(error.message)));
      }
      return false;
    }
  }

  Future<void> _takeThen(Future<void> Function() next) async {
    if (_viewerId == null) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('The browser is still opening.')),
        );
      }
      return;
    }
    if (_held && !_owned) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Someone else is driving this browser.')),
        );
      }
      return;
    }
    if (!_controlling) {
      final took = await _act({'type': 'take'});
      if (!took || !mounted) return;
      setState(() => _controlling = true);
    }
    await next();
  }

  /// Tap position in device pixels for the input_mouse action.
  Future<void> _tapAt(Offset local, Size shown) async {
    final point = imagePoint(local, shown, _deviceWidth, _deviceHeight);
    if (point == null) return;
    final x = point.dx.round();
    final y = point.dy.round();
    await _takeThen(() async {
      await _act({
        'type': 'input_mouse',
        'eventType': 'mousePressed',
        'x': x,
        'y': y,
        'button': 'left',
        'clickCount': 1,
        'modifiers': 0,
      });
      await _act({
        'type': 'input_mouse',
        'eventType': 'mouseReleased',
        'x': x,
        'y': y,
        'button': 'left',
        'clickCount': 1,
        'modifiers': 0,
      });
    });
  }

  Future<void> _key(String key, String code, int keyCode) async {
    await _takeThen(() async {
      await _act({
        'type': 'input_keyboard',
        'eventType': 'keyDown',
        'key': key,
        'code': code,
        'windowsVirtualKeyCode': keyCode,
        'modifiers': 0,
      });
      await _act({
        'type': 'input_keyboard',
        'eventType': 'keyUp',
        'key': key,
        'code': code,
        'windowsVirtualKeyCode': keyCode,
        'modifiers': 0,
      });
    });
  }

  Future<void> _type() async {
    final text = _typeController.text;
    if (text.isEmpty) return;
    await _takeThen(() async {
      final sent = await _act({
        'type': 'input_keyboard',
        'eventType': 'char',
        'text': text,
      });
      if (sent && mounted) _typeController.clear();
    });
  }

  Future<void> _openPage() async {
    var url = _openController.text.trim();
    if (url.isEmpty) return;
    if (!url.contains('://')) url = 'https://$url';
    await _takeThen(() async {
      await _act({'type': 'navigate', 'url': url});
    });
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final column = Column(
        children: [
          if (widget.embedded)
            Row(
              children: [
                const SizedBox(width: 4),
                IconButton(
                  icon: const Icon(Icons.arrow_back_outlined),
                  tooltip: 'Browser back',
                  onPressed: _controlling ? () => _act({'type': 'back'}) : null,
                ),
                IconButton(
                  icon: const Icon(Icons.refresh_outlined),
                  tooltip: 'Reload',
                  onPressed: _controlling ? () => _act({'type': 'reload'}) : null,
                ),
                Expanded(
                  child: Text(
                    '${widget.bot.name}’s browser',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
          if (_tabs.isNotEmpty)
            SizedBox(
              height: 44,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                itemCount: _tabs.length,
                separatorBuilder: (_, _) => const SizedBox(width: 6),
                itemBuilder: (context, index) {
                  final tab = _tabs[index];
                  final label = tab.title.isEmpty ? tab.url : tab.title;
                  return ActionChip(
                    label: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 160),
                      child: Text(
                        label,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    avatar: tab.active
                        ? const Icon(Icons.circle, size: 8)
                        : null,
                    onPressed: () => _act({
                      'type': 'tab-select',
                      'tabId': tab.id,
                    }),
                  );
                },
              ),
            ),
          if (_url != null)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
              color: scheme.surfaceContainerHighest,
              child: Text(
                _url!,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ),
          Expanded(
            child: Center(
              child: _error != null
                  ? Padding(
                      padding: const EdgeInsets.all(32),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(Icons.computer_outlined, size: 48),
                          const SizedBox(height: 12),
                          Text(_error!, textAlign: TextAlign.center),
                          const SizedBox(height: 12),
                          FilledButton(
                            onPressed: () {
                              setState(() {
                                _error = null;
                                _waiting = null;
                                _connecting = true;
                              });
                              _connect();
                            },
                            child: const Text('Reconnect'),
                          ),
                        ],
                      ),
                    )
                  : _frame == null
                  ? _viewerId != null && _tabs.isEmpty
                  ? const Padding(
                      padding: EdgeInsets.all(24),
                      child: Text(
                        'No page yet. Type an address below and open it.',
                        textAlign: TextAlign.center,
                      ),
                    )
                  : Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const CircularProgressIndicator(),
                        const SizedBox(height: 12),
                        Text(
                          _waiting ??
                              (_connecting
                                  ? 'Opening the browser…'
                                  : 'Waiting for the first frame…'),
                          textAlign: TextAlign.center,
                        ),
                      ],
                    )
                  : LayoutBuilder(
                      builder: (context, constraints) {
                        final shown = Size(
                          constraints.maxWidth,
                          constraints.maxHeight,
                        );
                        return GestureDetector(
                          onTapUp: (details) => _tapAt(details.localPosition, shown),
                          child: Image.memory(
                            _frame!,
                            width: shown.width,
                            height: shown.height,
                            fit: BoxFit.contain,
                            gaplessPlayback: true,
                          ),
                        );
                      },
                    ),
            ),
          ),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 4, 12, 12),
              child: Column(
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: TextField(
                          controller: _openController,
                          decoration: const InputDecoration(
                            hintText: 'Open a page',
                            isDense: true,
                            border: OutlineInputBorder(),
                          ),
                          keyboardType: TextInputType.url,
                          textInputAction: TextInputAction.go,
                          onSubmitted: (_) => _openPage(),
                        ),
                      ),
                      const SizedBox(width: 8),
                      IconButton.filled(
                        onPressed: _openPage,
                        icon: const Icon(Icons.arrow_forward),
                        tooltip: 'Open',
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      Expanded(
                        child: TextField(
                          controller: _typeController,
                          decoration: const InputDecoration(
                            hintText: 'Type into the page',
                            isDense: true,
                            border: OutlineInputBorder(),
                          ),
                          textInputAction: TextInputAction.send,
                          onSubmitted: (_) => _type(),
                        ),
                      ),
                      const SizedBox(width: 8),
                      IconButton.filled(
                        onPressed: _type,
                        icon: const Icon(Icons.keyboard_outlined),
                        tooltip: 'Type',
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      TextButton(
                        onPressed: () => _key('Enter', 'Enter', 13),
                        child: const Text('Enter'),
                      ),
                      TextButton(
                        onPressed: () => _key('Backspace', 'Backspace', 8),
                        child: const Text('Delete'),
                      ),
                      const Spacer(),
                      if (_controlling)
                        FilledButton.tonal(
                          onPressed: () async {
                            await _act({'type': 'release'});
                            if (mounted) setState(() => _controlling = false);
                          },
                          child: const Text('Hand back'),
                        )
                      else
                        FilledButton(
                          onPressed: _viewerId == null || (_held && !_owned)
                              ? null
                              : () => _takeThen(() async {}),
                          child: const Text('Take over'),
                        ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ],
      );
    if (widget.embedded) return column;
    return Scaffold(
      appBar: AppBar(
        title: Text('${widget.bot.name}’s browser'),
        actions: [
          IconButton(
            icon: const Icon(Icons.arrow_back_outlined),
            tooltip: 'Browser back',
            onPressed: _controlling ? () => _act({'type': 'back'}) : null,
          ),
          IconButton(
            icon: const Icon(Icons.refresh_outlined),
            tooltip: 'Reload',
            onPressed: _controlling ? () => _act({'type': 'reload'}) : null,
          ),
        ],
      ),
      body: column,
    );
  }
}

/// A tap on a [BoxFit.contain] picture, in the picture's own pixels.
/// Taps in the empty margin are ignored.
Offset? imagePoint(Offset local, Size box, int pixelWidth, int pixelHeight) {
  if (pixelWidth <= 0 || pixelHeight <= 0 || box.width <= 0 || box.height <= 0) {
    return null;
  }
  final scale = math.min(box.width / pixelWidth, box.height / pixelHeight);
  final shownWidth = pixelWidth * scale;
  final shownHeight = pixelHeight * scale;
  final dx = local.dx - (box.width - shownWidth) / 2;
  final dy = local.dy - (box.height - shownHeight) / 2;
  if (dx < 0 || dy < 0 || dx > shownWidth || dy > shownHeight) return null;
  return Offset(dx / shownWidth * pixelWidth, dy / shownHeight * pixelHeight);
}

class _LiveTab {
  const _LiveTab({
    required this.id,
    required this.title,
    required this.url,
    required this.active,
  });

  final String id;
  final String title;
  final String url;
  final bool active;
}
