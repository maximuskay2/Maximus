import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../api/client.dart';
import '../api/models.dart';
import '../automations/computer_page.dart';
import '../theme/chrome.dart';

/// Phase 7: the shared bot computer (Local VM) — status, inventory,
/// and lifecycle (start/stop/remove). Destructive actions confirm
/// and refuse while a bot is using the desktop.
class BotComputerPage extends StatefulWidget {
  const BotComputerPage({
    super.key,
    required this.client,
    required this.baseUrl,
    this.bots = const [],
  });

  final MaximusApi client;
  final String baseUrl;

  /// Null when a hot reload kept a page built before this field existed.
  final List<BotSummary>? bots;

  @override
  State<BotComputerPage> createState() => _BotComputerPageState();
}

class _BotComputerPageState extends State<BotComputerPage> {
  BotComputerStatus? _status;
  List<Map<String, Object?>> _instances = const [];
  bool _loading = true;
  bool _busy = false;
  String? _error;
  Uint8List? _screen;
  Size? _pixels;
  final _desktopType = TextEditingController();
  final _desktopOpen = TextEditingController();
  String? _pending;
  String _pane = 'desktop';
  String? _browserBotId;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _desktopType.dispose();
    _desktopOpen.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final status = await widget.client.localComputer(widget.baseUrl);
      List<Map<String, Object?>> instances = const [];
      try {
        instances = await widget.client.localComputerInstances(
          widget.baseUrl,
        );
      } on ApiError {
        instances = const [];
      }
      if (mounted) {
        setState(() {
          _status = status;
          _instances = instances;
        });
      }
      if (_showing(status)) await _capture();
    } on ApiError catch (error) {
      if (mounted) setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _act(String action, {bool confirm = false}) async {
    if (confirm) {
      final yes = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text('${action[0].toUpperCase()}${action.substring(1)} the bot computer?'),
          content: Text(
            action == 'remove'
                ? 'Its disk is thrown away. Sign-ins are kept where the server can.'
                : 'Running turns that need the desktop will fail.',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: const Text('Keep'),
            ),
            FilledButton(
              onPressed: () => Navigator.of(context).pop(true),
              child: Text(action[0].toUpperCase() + action.substring(1)),
            ),
          ],
        ),
      );
      if (yes != true || !mounted) return;
    }
    final messenger = ScaffoldMessenger.of(context);
    setState(() {
      _busy = true;
      _pending = action;
    });
    try {
      final status = await widget.client.localComputerAction(
        widget.baseUrl,
        action,
      );
      if (mounted) setState(() => _status = status);
      await _load();
    } on ApiError catch (error) {
      if (mounted) {
        messenger.showSnackBar(SnackBar(content: Text(error.message)));
      }
    } finally {
      if (mounted) {
        setState(() {
          _busy = false;
          _pending = null;
        });
      }
    }
  }

  /// Width and height from a PNG IHDR. The desktop preview is a PNG.
  Size? _pngSize(Uint8List bytes) {
    if (bytes.length < 24 || bytes[0] != 0x89 || bytes[1] != 0x50) return null;
    final data = ByteData.sublistView(bytes);
    final width = data.getUint32(16);
    final height = data.getUint32(20);
    if (width == 0 || height == 0 || width > 8192 || height > 8192) return null;
    return Size(width.toDouble(), height.toDouble());
  }

  bool _showing(BotComputerStatus? status) {
    if (status == null) return false;
    return status.ready ||
        status.container == 'running' ||
        (status.container == null && status.state == 'running');
  }

  Future<void> _capture() async {
    try {
      final bytes = await widget.client.localComputerScreenshot(
        widget.baseUrl,
      );
      if (!mounted) return;
      setState(() {
        _screen = bytes;
        _pixels = bytes == null ? null : _pngSize(bytes);
      });
    } on ApiError {
      if (mounted) setState(() => _screen = null);
    }
  }

  Future<void> _sendDesktop(Map<String, Object?> action) async {
    try {
      await widget.client.localComputerInput(widget.baseUrl, action);
      if (action['action'] == 'type' && mounted) _desktopType.clear();
      if (mounted) await _capture();
    } on ApiError catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(error.message)),
      );
    }
  }

  bool _driverDown(BotComputerStatus status) {
    if (status.ready) return false;
    final detail = status.detail ?? '';
    return detail.contains('daemon is not running') ||
        detail.contains('failed to start');
  }

  String _headline(BotComputerStatus status) {
    if (_driverDown(status)) return "Driver isn't running";
    if (status.ready ||
        (status.state == 'running' && status.container == null)) {
      return 'Running';
    }
    if (status.image == false) return 'No desktop yet';
    return switch (status.container ?? status.state) {
      'missing' => 'Not created',
      'stopped' => 'Stopped',
      'running' => 'Starting',
      _ => status.state ?? 'Not ready',
    };
  }

  String? _plain(BotComputerStatus status) {
    final detail = status.detail;
    if (detail == null || detail.isEmpty) return null;
    if (detail.contains('docker exec') || detail.contains('Command failed')) {
      return 'The desktop is on, but its driver is not running. Try again restarts it.';
    }
    return detail;
  }

  Future<void> _retryDesktop() async {
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _busy = true);
    try {
      await widget.client.localComputerAction(widget.baseUrl, 'stop');
      await widget.client.localComputerAction(widget.baseUrl, 'start');
      await _load();
    } on ApiError catch (error) {
      if (mounted) {
        messenger.showSnackBar(SnackBar(content: Text(error.message)));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// The one step that can move this desktop forward. `start` only
  /// resumes a stopped machine, so a missing image or container uses
  /// prepare (`pull`) or create (`run`) instead.
  ({String label, String action})? _next(BotComputerStatus status) {
    if (status.image == false) {
      return (label: 'Prepare desktop', action: 'pull');
    }
    final container = status.container ?? status.state;
    if (container == 'missing') return (label: 'Start', action: 'run');
    if (container == 'stopped') return (label: 'Start', action: 'start');
    return null;
  }

  bool _hasMachine(BotComputerStatus status) {
    final container = status.container ?? status.state;
    return container == 'running' || container == 'stopped';
  }

  @override
  Widget build(BuildContext context) {
    final status = _status;
    return Scaffold(
      appBar: AppBar(title: const Text('Bot computer')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
            child: MaxSegment<String>(
              value: _pane,
              options: const [('desktop', 'Desktop'), ('browser', 'Browser')],
              onChanged: (value) => setState(() => _pane = value),
            ),
          ),
          Expanded(child: _pane == 'browser' ? _browser() : _desktop(status)),
        ],
      ),
    );
  }

  Widget _browser() {
    final bots = widget.bots ?? const <BotSummary>[];
    if (bots.isEmpty) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(32),
          child: Text(
            'Add a bot first. Its browser opens here, with each page it is reading.',
            textAlign: TextAlign.center,
          ),
        ),
      );
    }
    BotSummary? selected;
    for (final bot in bots) {
      if (bot.id == _browserBotId) selected = bot;
    }
    selected ??= bots.length == 1 ? bots.first : null;
    if (selected == null) {
      return ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
        children: [
          const Text('Which bot’s browser?'),
          const SizedBox(height: 8),
          for (final bot in bots)
            ListTile(
              leading: const Icon(Icons.language),
              title: Text(bot.name),
              onTap: () => setState(() => _browserBotId = bot.id),
            ),
        ],
      );
    }
    return Column(
      children: [
        if (bots.length > 1)
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton.icon(
              onPressed: () => setState(() => _browserBotId = null),
              icon: const Icon(Icons.swap_horiz),
              label: Text(selected.name),
            ),
          ),
        Expanded(
          child: ComputerPage(
            key: ValueKey(selected.id),
            client: widget.client,
            baseUrl: widget.baseUrl,
            bot: selected,
            thread: ThreadSummary(
              threadId: selected.threadId,
              title: selected.name,
              createdAt: 0,
            ),
            embedded: true,
          ),
        ),
      ],
    );
  }

  Widget _desktop(BotComputerStatus? status) {
    return _loading && status == null
          ? const Center(child: CircularProgressIndicator())
          : _error != null && status == null
          ? Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(_error!),
                  const SizedBox(height: 12),
                  FilledButton(
                    onPressed: _load,
                    child: const Text('Retry'),
                  ),
                ],
              ),
            )
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
                children: [
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Shared desktop',
                            style: Theme.of(context).textTheme.titleMedium,
                          ),
                          const SizedBox(height: 8),
                          Text(
                            status == null || !status.available
                                ? 'Not set up'
                                : _headline(status),
                            style: Theme.of(
                              context,
                            ).textTheme.headlineSmall,
                          ),
                          if (status?.image == false) ...[
                            const SizedBox(height: 4),
                            const Text(
                              'This computer has no desktop image yet, so there is nothing to start or show. Preparing it downloads the image and can take several minutes.',
                            ),
                          ] else if (status != null && _plain(status) != null) ...[
                            const SizedBox(height: 4),
                            Text(_plain(status)!),
                          ],
                          if (_pending == 'pull') ...[
                            const SizedBox(height: 12),
                            const LinearProgressIndicator(),
                          ],
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 8),
                  if (_instances.isNotEmpty) ...[
                    Text(
                      'Desktops',
                      style: Theme.of(context).textTheme.titleSmall,
                    ),
                    for (final vm in _instances)
                      ListTile(
                        contentPadding: EdgeInsets.zero,
                        leading: const Icon(Icons.desktop_windows_outlined),
                        title: Text('${vm['name'] ?? 'Desktop'}'),
                        subtitle: Text('${vm['state'] ?? ''}'),
                      ),
                    const SizedBox(height: 8),
                  ],
                  if (_screen != null) ...[
                    ClipRRect(
                      borderRadius: BorderRadius.circular(14),
                      child: Builder(
                        builder: (imageContext) {
                          final pixels = _pixels;
                          final picture = GestureDetector(
                            key: const Key('desktop-picture'),
                            onTapUp: (details) {
                              final box = imageContext.findRenderObject();
                              if (box is! RenderBox || pixels == null) return;
                              final point = imagePoint(
                                details.localPosition,
                                box.size,
                                pixels.width.round(),
                                pixels.height.round(),
                              );
                              if (point == null) return;
                              _sendDesktop({
                                'action': 'click',
                                'x': point.dx.round(),
                                'y': point.dy.round(),
                              });
                            },
                            child: Image.memory(
                              _screen!,
                              fit: BoxFit.contain,
                            ),
                          );
                          if (pixels == null || pixels.height == 0) return picture;
                          final width = MediaQuery.sizeOf(imageContext).width;
                          final height = (width / (pixels.width / pixels.height)).clamp(160.0, 480.0);
                          return SizedBox(height: height, width: double.infinity, child: picture);
                        },
                      ),
                    ),
                    const SizedBox(height: 8),
                    TextField(
                      controller: _desktopType,
                      decoration: const InputDecoration(
                        hintText: 'Type on the desktop',
                        isDense: true,
                        border: OutlineInputBorder(),
                      ),
                      textInputAction: TextInputAction.send,
                      onSubmitted: (text) {
                        if (text.isEmpty) return;
                        _sendDesktop({'action': 'type', 'text': text});
                      },
                    ),
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 8,
                      children: [
                        for (final key in ['Return', 'BackSpace', 'Tab', 'Escape'])
                          ActionChip(
                            label: Text(key == 'BackSpace' ? 'Delete' : key),
                            onPressed: () => _sendDesktop({'action': 'key', 'key': key}),
                          ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    TextField(
                      controller: _desktopOpen,
                      decoration: const InputDecoration(
                        hintText: 'Open a page on the desktop',
                        isDense: true,
                        border: OutlineInputBorder(),
                      ),
                      keyboardType: TextInputType.url,
                      textInputAction: TextInputAction.go,
                      onSubmitted: (text) {
                        final url = text.contains('://') ? text : 'https://$text';
                        _sendDesktop({'action': 'open', 'url': url});
                      },
                    ),
                    const SizedBox(height: 8),
                  ],
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      if (status != null && _driverDown(status))
                        FilledButton(
                          onPressed: _busy ? null : _retryDesktop,
                          child: const Text('Try again'),
                        ),
                      if (status != null && _next(status) != null)
                        FilledButton(
                          onPressed: _busy
                              ? null
                              : () => _act(_next(status)!.action),
                          child: Text(_next(status)!.label),
                        ),
                      if (status != null && _hasMachine(status)) ...[
                        OutlinedButton(
                          onPressed: _busy ? null : () => _act('stop'),
                          child: const Text('Stop'),
                        ),
                        OutlinedButton(
                          onPressed: _busy
                              ? null
                              : () => _act('remove', confirm: true),
                          child: const Text('Reset disk'),
                        ),
                      ],
                    ],
                  ),
                  if (_error != null) ...[
                    const SizedBox(height: 8),
                    Text(
                      _error!,
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
                  ],
                ],
              ),
            );
  }
}
