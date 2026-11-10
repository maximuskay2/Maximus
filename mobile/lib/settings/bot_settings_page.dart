import 'package:flutter/material.dart';

import '../api/client.dart';
import '../api/models.dart';
import '../theme/chrome.dart';

/// Phase 7: one bot's profile and autonomy (approval mode).
/// Only changed fields are patched; approval mode widening asks first
/// server-side when the engine needs it.
class BotSettingsPage extends StatefulWidget {
  const BotSettingsPage({
    super.key,
    required this.client,
    required this.baseUrl,
    required this.bot,
  });

  final MaximusApi client;
  final String baseUrl;
  final BotSummary bot;

  @override
  State<BotSettingsPage> createState() => _BotSettingsPageState();
}

class _BotSettingsPageState extends State<BotSettingsPage> {
  late final TextEditingController _name;
  late final TextEditingController _title;
  late final TextEditingController _description;
  late final TextEditingController _soul;
  late bool _notifications;
  late bool _speakReplies;
  late String? _replyStyle;
  late String _approvalMode;
  bool _busy = false;

  static const _modes = ['ask', 'edits', 'auto', 'full', 'custom'];

  static const _modeBlurbs = {
    'ask': 'Asks before every step.',
    'edits': 'Edits freely, asks for the rest.',
    'auto': 'Reviews its own steps, asks when unsure.',
    'full': 'Full access — answers its own prompts.',
    'custom': 'A custom permission set.',
  };

  @override
  void initState() {
    super.initState();
    final bot = widget.bot;
    _name = TextEditingController(text: bot.name);
    _title = TextEditingController(text: bot.title);
    _description = TextEditingController(text: bot.description);
    _soul = TextEditingController(text: bot.soul ?? '');
    _notifications = bot.notifications;
    _speakReplies = bot.speakReplies ?? false;
    _replyStyle = bot.replyStyle;
    _approvalMode = _modes.contains(bot.approvalMode)
        ? bot.approvalMode!
        : 'full';
  }

  @override
  void dispose() {
    _name.dispose();
    _title.dispose();
    _description.dispose();
    _soul.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final bot = widget.bot;
    final patch = <String, Object?>{
      if (_name.text.trim() != bot.name) 'name': _name.text.trim(),
      if (_title.text.trim() != bot.title) 'title': _title.text.trim(),
      if (_description.text.trim() != bot.description)
        'description': _description.text.trim(),
      if (_soul.text.trim() != (bot.soul ?? '')) 'soul': _soul.text.trim(),
      if (_notifications != bot.notifications)
        'notifications': _notifications,
      if (_speakReplies != (bot.speakReplies ?? false))
        'speakReplies': _speakReplies,
      if (_replyStyle != null && _replyStyle != bot.replyStyle)
        'replyStyle': _replyStyle,
      if (_approvalMode != (bot.approvalMode ?? 'full'))
        'approvalMode': _approvalMode,
    };
    if (patch.isEmpty) {
      Navigator.of(context).pop();
      return;
    }
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _busy = true);
    try {
      await widget.client.patchBot(widget.baseUrl, bot.id, patch);
      if (mounted) Navigator.of(context).pop(true);
    } on ApiError catch (error) {
      if (mounted) {
        messenger.showSnackBar(SnackBar(content: Text(error.message)));
        setState(() => _busy = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(widget.bot.name),
        actions: [
          TextButton(
            onPressed: _busy ? null : _save,
            child: Text(_busy ? 'Saving…' : 'Save'),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
        children: [
          TextField(
            controller: _name,
            decoration: const InputDecoration(labelText: 'Name'),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _title,
            decoration: const InputDecoration(labelText: 'Title'),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _description,
            maxLines: 3,
            decoration: const InputDecoration(labelText: 'Description'),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _soul,
            maxLines: 5,
            decoration: const InputDecoration(
              labelText: 'Standing instructions',
              helperText: 'What this bot always knows about you.',
            ),
          ),
          const SizedBox(height: 16),
          const Text(
            'Autonomy',
            style: TextStyle(fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 8),
          MaxSegment<String>(
            value: _approvalMode,
            options: [
              for (final mode in _modes)
                (mode, '${mode[0].toUpperCase()}${mode.substring(1)}'),
            ],
            onChanged: (mode) => setState(() => _approvalMode = mode),
          ),
          const SizedBox(height: 8),
          Text(
            _modeBlurbs[_approvalMode] ?? '',
            style: const TextStyle(fontSize: 13, color: Color(0xFF8E8E93)),
          ),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Notifications'),
            subtitle: const Text('Ping this phone for this bot'),
            value: _notifications,
            onChanged: (on) => setState(() => _notifications = on),
          ),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Spoken replies'),
            subtitle: const Text('Talk back during voice calls'),
            value: _speakReplies,
            onChanged: (on) => setState(() => _speakReplies = on),
          ),
          const SizedBox(height: 8),
          const Text(
            'Reply style',
            style: TextStyle(fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 8),
          MaxSegment<String>(
            value: _replyStyle ?? 'default',
            options: const [
              ('default', 'Default'),
              ('conversational', 'Conversational'),
            ],
            onChanged: (style) => setState(() => _replyStyle = style),
          ),
        ],
      ),
    );
  }
}
