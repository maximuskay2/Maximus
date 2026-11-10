import 'package:flutter/material.dart';

import '../api/client.dart';
import '../api/models.dart';
import '../theme/blobs.dart';
import '../theme/tokens.dart';

/// Create sheet: name, body, color. The harness still creates
/// the bot; look is a follow-up patch so a failed look never loses the bot.
Future<bool> showCreateBotSheet({
  required BuildContext context,
  required MaximusApi client,
  required String baseUrl,
}) async {
  final created = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (sheet) => _CreateBotSheet(client: client, baseUrl: baseUrl),
  );
  return created == true;
}

class _CreateBotSheet extends StatefulWidget {
  const _CreateBotSheet({required this.client, required this.baseUrl});

  final MaximusApi client;
  final String baseUrl;

  @override
  State<_CreateBotSheet> createState() => _CreateBotSheetState();
}

class _CreateBotSheetState extends State<_CreateBotSheet> {
  final _name = TextEditingController();
  String _shape = 'drop';
  String _color = 'pink';
  bool _busy = false;

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  Future<void> _create() async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      final name = _name.text.trim();
      final bot = await widget.client.createBot(
        widget.baseUrl,
        name: name.isEmpty ? null : name,
      );
      try {
        await widget.client.patchBot(widget.baseUrl, bot.id, {
          'color': _color,
          'mascotBody': _shape,
        });
      } on ApiError {
        // The bot exists. Look can be changed later from its profile.
      }
      if (mounted) Navigator.of(context).pop(true);
    } on ApiError catch (error) {
      if (mounted) {
        setState(() => _busy = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(error.message)),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final bottom = MediaQuery.viewInsetsOf(context).bottom;
    return Padding(
      padding: EdgeInsets.only(bottom: bottom),
      child: Align(
        alignment: Alignment.bottomCenter,
        child: Container(
          constraints: BoxConstraints(
            maxHeight: MediaQuery.sizeOf(context).height * 0.92,
          ),
          decoration: const BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
          ),
          child: SafeArea(
            top: false,
            child: ListView(
              shrinkWrap: true,
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 16),
              children: [
                Row(
                  children: [
                    _CircleButton(
                      icon: Icons.close,
                      onPressed: () => Navigator.of(context).pop(false),
                    ),
                    const Expanded(
                      child: Text(
                        'Create New Bot',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontSize: 17,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                    const SizedBox(width: 36),
                  ],
                ),
                const SizedBox(height: 18),
                Center(
                  child: BotBlob(
                    color: _color,
                    seed: _shape,
                    shape: _shape,
                    size: 112,
                  ),
                ),
                const SizedBox(height: 22),
                TextField(
                  controller: _name,
                  textAlign: TextAlign.center,
                  style: const TextStyle(fontSize: 17),
                  decoration: InputDecoration(
                    hintText: 'Name your Bot',
                    hintStyle: TextStyle(color: Colors.black.withValues(alpha: 0.28)),
                    filled: true,
                    fillColor: const Color(0xFFF4F4F5),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(14),
                      borderSide: BorderSide.none,
                    ),
                    contentPadding: const EdgeInsets.symmetric(vertical: 16),
                  ),
                ),
                const SizedBox(height: 18),
                Wrap(
                  alignment: WrapAlignment.center,
                  spacing: 10,
                  runSpacing: 10,
                  children: [
                    for (final shape in blobShapes)
                      GestureDetector(
                        onTap: () => setState(() => _shape = shape),
                        child: AnimatedScale(
                          duration: const Duration(milliseconds: 180),
                          curve: Curves.easeOutCubic,
                          scale: _shape == shape ? 1.08 : 1,
                          child: Container(
                            padding: const EdgeInsets.all(3),
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              border: Border.all(
                                color: _shape == shape
                                    ? MaxTokens.ember
                                    : Colors.transparent,
                                width: 1.5,
                              ),
                            ),
                            child: BotBlob(
                              color: _color,
                              seed: shape,
                              shape: shape,
                              size: 36,
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 18),
                Wrap(
                  alignment: WrapAlignment.center,
                  spacing: 12,
                  runSpacing: 12,
                  children: [
                    for (final name in blobColorNames)
                      GestureDetector(
                        onTap: () => setState(() => _color = name),
                        child: AnimatedScale(
                          duration: const Duration(milliseconds: 180),
                          curve: Curves.easeOutCubic,
                          scale: _color == name ? 1.12 : 1,
                          child: Container(
                            width: 28,
                            height: 28,
                            decoration: BoxDecoration(
                              color: blobColor(name),
                              shape: BoxShape.circle,
                              border: Border.all(
                                color: _color == name
                                    ? MaxTokens.ember
                                    : Colors.white,
                                width: 2,
                              ),
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 22),
                SizedBox(
                  width: double.infinity,
                  height: 52,
                  child: FilledButton(
                    style: FilledButton.styleFrom(
                      backgroundColor: MaxTokens.ember,
                      foregroundColor: Colors.white,
                      shape: const StadiumBorder(),
                    ),
                    onPressed: _busy ? null : _create,
                    child: Text(_busy ? 'Creating…' : 'Create'),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _CircleButton extends StatelessWidget {
  const _CircleButton({required this.icon, required this.onPressed});

  final IconData icon;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: const Color(0xFFF2F2F7),
      shape: const CircleBorder(),
      child: InkWell(
        customBorder: const CircleBorder(),
        onTap: onPressed,
        child: SizedBox.square(
          dimension: 36,
          child: Icon(icon, size: 18),
        ),
      ),
    );
  }
}
