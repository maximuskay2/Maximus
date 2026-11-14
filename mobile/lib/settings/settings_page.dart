import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/client.dart';
import '../api/models.dart';
import '../auth/auth_state.dart';
import '../engines/engines_page.dart';
import 'account_page.dart';
import 'bot_settings_page.dart';
import 'computer_settings_page.dart';
import 'devices_page.dart';
import 'preferences.dart';
import 'usage_page.dart';
import '../theme/chrome.dart';
import '../theme/tokens.dart';

/// Phase 7: everything about this phone and its server — account,
/// bots, devices, usage, computer, display, and sign-out.
class SettingsPage extends StatelessWidget {
  const SettingsPage({
    super.key,
    required this.auth,
    required this.baseUrl,
    required this.serverName,
    required this.bots,
    required this.prefs,
  });

  final AuthState auth;
  final String baseUrl;
  final String serverName;
  final List<BotSummary> bots;
  final AppPreferences prefs;

  MaximusApi get _client => auth.client;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListenableBuilder(
        listenable: prefs,
        builder: (context, _) => ListView(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
          children: [
            _header(context, 'This server'),
            _group(children: [
            _row(
              context,
              icon: Icons.person_outline,
              title: 'Account',
              subtitle: serverName,
              page: AccountPage(
                auth: auth,
                baseUrl: baseUrl,
                serverName: serverName,
              ),
            ),
            _row(
              context,
              icon: Icons.devices_outlined,
              title: 'Devices',
              subtitle: 'Signed-in phones and browsers',
              page: DevicesPage(client: _client, baseUrl: baseUrl),
            ),
            if (auth.isAdmin)
              _row(
                context,
                icon: Icons.receipt_long_outlined,
                title: 'Usage',
                subtitle: 'Tokens and cost by bot',
                page: UsagePage(client: _client, baseUrl: baseUrl, auth: auth),
              ),
            if (auth.isAdmin)
              _row(
                context,
                icon: Icons.key_outlined,
                title: 'Your AI',
                subtitle: 'Connect your own LLM key or account',
                page: EnginesPage(
                  client: _client,
                  baseUrl: baseUrl,
                  auth: auth,
                ),
              ),
            _row(
              context,
              icon: Icons.computer_outlined,
              title: 'Bot computer',
              subtitle: 'The desktop your bots share',
              page: BotComputerPage(
                client: _client,
                baseUrl: baseUrl,
                bots: bots,
              ),
            ),
            ]),
            _header(context, 'Bots'),
            _group(children: [
            if (bots.isEmpty)
              const ListTile(
                title: Text('No bots yet'),
                subtitle: Text('Add one from the Bots tab.'),
              )
            else
              for (final bot in bots)
                _row(
                  context,
                  icon: Icons.smart_toy_outlined,
                  title: bot.name,
                  subtitle: bot.title.isEmpty
                      ? 'Profile and autonomy'
                      : bot.title,
                  page: BotSettingsPage(
                    client: _client,
                    baseUrl: baseUrl,
                    bot: bot,
                  ),
                ),
            ]),
            _header(context, 'This phone'),
            _group(children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 14, 16, 12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Appearance',
                    style: TextStyle(fontWeight: FontWeight.w600),
                  ),
                  const SizedBox(height: 8),
                  MaxSegment<ThemeMode>(
                    value: prefs.theme,
                    options: const [
                      (ThemeMode.system, 'System'),
                      (ThemeMode.light, 'Light'),
                      (ThemeMode.dark, 'Dark'),
                    ],
                    onChanged: prefs.setTheme,
                  ),
                ],
              ),
            ),
            SwitchListTile(
              secondary: const Icon(Icons.vibration_outlined),
              title: const Text('Haptics'),
              subtitle: const Text('Buzz on approvals and sends'),
              value: prefs.haptics,
              onChanged: prefs.setHaptics,
            ),
            ListTile(
              leading: const Icon(Icons.language_outlined),
              title: const Text('Language'),
              subtitle: Text(
                prefs.language == null
                    ? 'Phone default'
                    : _languageName(prefs.language!),
              ),
              onTap: () => _languageSheet(context),
            ),
            ListTile(
              leading: const Icon(Icons.schedule_outlined),
              title: const Text('Time zone'),
              subtitle: Text(
                prefs.timeZone ?? 'Phone default',
              ),
              onTap: () => _timeZoneSheet(context),
            ),
            ]),
            _header(context, 'Support'),
            _group(children: [
            ListTile(
              leading: const Icon(Icons.forum_outlined),
              title: const Text('Feedback'),
              subtitle: const Text('Talk to us on Discord'),
              onTap: () => launchUrl(
                Uri.parse('https://discord.gg/9Wb8MEpXRs'),
                mode: LaunchMode.externalApplication,
              ),
            ),
            ]),
          ],
        ),
      ),
    );
  }

  Widget _header(BuildContext context, String text) => Padding(
    padding: const EdgeInsets.fromLTRB(8, 16, 8, 8),
    child: Text(
      text,
      style: const TextStyle(
        fontSize: 13,
        fontWeight: FontWeight.w600,
        color: Color(0xFF8E8E93),
      ),
    ),
  );

  Widget _group({required List<Widget> children}) => Material(
    color: const Color(0xFFF2F2F7),
    borderRadius: BorderRadius.circular(16),
    clipBehavior: Clip.antiAlias,
    child: Column(children: children),
  );

  Widget _row(
    BuildContext context, {
    required IconData icon,
    required String title,
    required String subtitle,
    required Widget page,
  }) => ListTile(
    leading: Icon(icon),
    title: Text(title),
    subtitle: Text(subtitle),
    trailing: const Icon(Icons.chevron_right_outlined),
    onTap: () => Navigator.of(
      context,
    ).push(MaterialPageRoute(builder: (_) => page)),
  );

  static const _languages = <String, String>{
    'en': 'English',
    'de': 'Deutsch',
    'es': 'Español',
    'fr': 'Français',
    'it': 'Italiano',
    'ja': '日本語',
    'pt-BR': 'Português (Brasil)',
    'ru': 'Русский',
    'tr': 'Türkçe',
    'zh': '中文',
  };

  static String _languageName(String tag) =>
      _languages[tag] ?? _languages[tag.split('-').first] ?? tag;

  Future<void> _languageSheet(BuildContext context) async {
    final picked = await showModalBottomSheet<String>(
      context: context,
      builder: (sheet) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
          children: [
            const Padding(
              padding: EdgeInsets.fromLTRB(8, 4, 8, 8),
              child: Text(
                'Language for server-written lines',
                style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600),
              ),
            ),
            Material(
              color: const Color(0xFFF2F2F7),
              borderRadius: BorderRadius.circular(16),
              clipBehavior: Clip.antiAlias,
              child: Column(
                children: [
                  ListTile(
                    title: const Text('Phone default'),
                    trailing: prefs.language == null
                        ? const Icon(Icons.check, color: MaxTokens.ember)
                        : null,
                    onTap: () => Navigator.of(sheet).pop(''),
                  ),
                  for (final entry in _languages.entries)
                    ListTile(
                      title: Text(entry.value),
                      trailing: prefs.language == entry.key
                          ? const Icon(Icons.check, color: MaxTokens.ember)
                          : null,
                      onTap: () => Navigator.of(sheet).pop(entry.key),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
    if (picked == null || !context.mounted) return;
    await prefs.setLanguage(picked.isEmpty ? null : picked);
    // Tell the server right away so the next brief uses it.
    try {
      await _client.presenceActive(
        baseUrl,
        timeZone: prefs.timeZone ?? DateTime.now().timeZoneName,
        language: prefs.language,
      );
    } on ApiError {
      // Best-effort: the next foreground report retries.
    }
  }

  Future<void> _timeZoneSheet(BuildContext context) async {
    final controller = TextEditingController(text: prefs.timeZone ?? '');
    final messenger = ScaffoldMessenger.of(context);
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (sheet) => Padding(
        padding: EdgeInsets.fromLTRB(
          20,
          20,
          20,
          20 + MediaQuery.of(sheet).viewInsets.bottom,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              'Time zone',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            const Text(
              'Schedules and briefs use this zone. Empty means the phone\u2019s own zone.',
            ),
            const SizedBox(height: 12),
            TextField(
              controller: controller,
              autofocus: true,
              autocorrect: false,
              decoration: const InputDecoration(
                labelText: 'IANA zone, e.g. Europe/Berlin',
              ),
            ),
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: () => Navigator.of(sheet).pop(true),
                child: const Text('Save'),
              ),
            ),
          ],
        ),
      ),
    );
    if (saved != true || !context.mounted) return;
    final zone = controller.text.trim();
    if (zone.isNotEmpty && !zone.contains('/')) {
      messenger.showSnackBar(
        const SnackBar(
          content: Text('Use a zone like Europe/Berlin.'),
        ),
      );
      return;
    }
    await prefs.setTimeZone(zone.isEmpty ? null : zone);
    try {
      await _client.presenceActive(
        baseUrl,
        timeZone: prefs.timeZone ?? DateTime.now().timeZoneName,
        language: prefs.language,
      );
    } on ApiError {
      // Best-effort: the next foreground report retries.
    }
  }
}
