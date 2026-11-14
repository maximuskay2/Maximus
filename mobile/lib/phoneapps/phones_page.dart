import 'package:flutter/material.dart';

import '../api/models.dart';
import '../theme/tokens.dart';
import '../auth/auth_state.dart';
import 'dart:io';

import 'drivers.dart';
import 'executor.dart';
import 'native_phone_apps.dart';
import 'policy.dart';
import 'poller.dart';

/// Asks the OS for a capability grant without sharing anything yet.
abstract class CapabilityGate {
  Future<CapPermission> check(String capability);
  Future<bool> request(String capability);
}

class SystemCapabilityGate implements CapabilityGate {
  SystemCapabilityGate({
    SystemCalendarDriver? calendar,
    SystemRemindersDriver? reminders,
    SystemAlarmsDriver? alarms,
    SystemHomeDriver? home,
  })  : _calendar = calendar ?? SystemCalendarDriver(),
        _reminders = reminders ?? SystemRemindersDriver(),
        _alarms = alarms ?? SystemAlarmsDriver(),
        _home = home ?? SystemHomeDriver();

  final SystemCalendarDriver _calendar;
  final SystemRemindersDriver _reminders;
  final SystemAlarmsDriver _alarms;
  final SystemHomeDriver _home;

  CapPermission _map(CapPermissionLike value) => switch (value) {
        CapPermissionLike.granted => CapPermission.granted,
        CapPermissionLike.denied => CapPermission.denied,
        CapPermissionLike.notAsked => CapPermission.notAsked,
      };

  @override
  Future<CapPermission> check(String capability) async {
    switch (capability) {
      case 'calendar':
        return _calendar.permission();
      case 'reminders':
        if (!Platform.isIOS) return CapPermission.denied;
        return _map(await _reminders.permission());
      case 'alarms':
        if (Platform.isIOS) {
          final status = await NativePhoneApps().alarmsPermission();
          return status == 'granted'
              ? CapPermission.granted
              : status == 'denied'
                  ? CapPermission.denied
                  : CapPermission.notAsked;
        }
        return CapPermission.granted;
      case 'home':
        if (!Platform.isIOS) return CapPermission.denied;
        final status = await NativePhoneApps().homePermission();
        return status == 'granted'
            ? CapPermission.granted
            : status == 'denied'
                ? CapPermission.denied
                : CapPermission.notAsked;
      case 'contacts':
      case 'location':
        // Checked lazily at execution time; the request flow grants them.
        return CapPermission.notAsked;
      case 'messages':
        return CapPermission.granted;
      default:
        return CapPermission.denied;
    }
  }

  @override
  Future<bool> request(String capability) async {
    switch (capability) {
      case 'calendar':
        return _calendar.requestPermission();
      case 'reminders':
        return _reminders.requestPermission();
      case 'alarms':
        return _alarms.requestPermission();
      case 'home':
        return _home.requestPermission();
      case 'contacts':
        return SystemContactsDriver().search('').then(
          (_) => true,
          onError: (_) => false,
        );
      case 'location':
        return SystemLocationDriver().current().then(
          (_) => true,
          onError: (_) => false,
        );
      case 'messages':
        return true;
      default:
        return false;
    }
  }
}

/// This phone's apps as bot tools: registration, per-capability OS grants,
/// per-tool policy (ask/always/never), and the owner's device list.
class PhonesPage extends StatefulWidget {
  const PhonesPage({
    super.key,
    required this.auth,
    required this.baseUrl,
    required this.poller,
    this.gate,
    this.appVersion = '0.1.0',
    this.deviceName,
  });

  final AuthState auth;
  final String baseUrl;
  final PhoneJobPoller poller;
  final CapabilityGate? gate;
  final String appVersion;
  final String? deviceName;

  @override
  State<PhonesPage> createState() => _PhonesPageState();
}

class _PhonesPageState extends State<PhonesPage> {
  PublicPhone? _self;
  List<PublicPhone> _devices = const [];
  Map<String, ToolPolicy> _policies = const {};
  Map<String, CapPermission> _grants = const {};
  bool _loading = true;
  bool _busy = false;

  static List<String> get _capabilities => [
    'calendar',
    if (Platform.isIOS) 'reminders',
    'alarms',
    'contacts',
    'location',
    if (Platform.isIOS) 'home',
    'messages',
  ];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      PublicPhone? self;
      try {
        self = await widget.auth.client.phoneSelf(widget.baseUrl);
      } on ApiError {
        // Unregistered phones read as null self; the enable row shows.
        self = null;
      }
      final policies = await PhonePolicyStore().read();
      final gate = widget.gate;
      final grants = <String, CapPermission>{};
      if (gate != null) {
        for (final cap in _capabilities) {
          grants[cap] = await gate.check(cap);
        }
      }
      List<PublicPhone> devices = const [];
      if (widget.auth.isAdmin) {
        try {
          devices = await widget.auth.client.phones(widget.baseUrl);
        } on ApiError {
          devices = const [];
        }
      }
      if (mounted) {
        setState(() {
          _self = self;
          _policies = policies;
          _grants = grants;
          _devices = devices;
        });
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Map<String, String> _grantedCaps() => {
    for (final cap in _capabilities)
      if (_grants[cap] == CapPermission.granted)
        cap: cap == 'location' ? 'when_in_use' : 'full',
  };

  Future<void> _register() async {
    setState(() => _busy = true);
    try {
      final phone = await widget.auth.client.registerPhone(
        widget.baseUrl,
        installId: await widget.poller.installId(),
        name: widget.deviceName ?? 'This phone',
        platform: PhoneJobPoller.platform,
        appVersion: widget.appVersion,
        timeZone: DateTime.now().timeZoneName,
        capabilities: _grantedCaps(),
      );
      widget.poller.start();
      if (mounted) setState(() => _self = phone);
    } on ApiError catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(error.message)));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _unregister() async {
    setState(() => _busy = true);
    try {
      widget.poller.stop();
      await widget.auth.client.unregisterPhone(widget.baseUrl);
      if (mounted) setState(() => _self = null);
    } on ApiError catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(error.message)));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _grant(String capability) async {
    final gate = widget.gate;
    if (gate == null) return;
    final ok = await gate.request(capability);
    if (!mounted) return;
    setState(() {
      _grants = {
        ..._grants,
        capability: ok ? CapPermission.granted : CapPermission.denied,
      };
    });
    // Re-register so the server's tool list matches the new grants.
    if (_self != null && ok) {
      try {
        final phone = await widget.auth.client.registerPhone(
          widget.baseUrl,
          installId: await widget.poller.installId(),
          name: _self!.name,
          platform: PhoneJobPoller.platform,
          appVersion: widget.appVersion,
          timeZone: DateTime.now().timeZoneName,
          capabilities: _grantedCaps(),
        );
        if (mounted) setState(() => _self = phone);
      } on ApiError catch (error) {
        if (mounted) {
          ScaffoldMessenger.of(
            context,
          ).showSnackBar(SnackBar(content: Text(error.message)));
        }
      }
    }
  }

  Future<void> _flipPolicy(String tool, ToolPolicy policy) async {
    await PhonePolicyStore().write(tool, policy);
    if (mounted) {
      setState(() {
        _policies = {..._policies, tool: policy};
      });
    }
  }

  Future<void> _removeDevice(PublicPhone phone) async {
    try {
      await widget.auth.client.removePhone(widget.baseUrl, phone.key);
      await _load();
    } on ApiError catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(error.message)));
      }
    }
  }

  String _toolLabel(String tool) => tool
      .replaceFirst('PHONE_', '')
      .split('_')
      .map((w) => w[0] + w.substring(1).toLowerCase())
      .join(' ');

  static const _appMeta = <String, (String, IconData)>{
    'calendar': ('Calendar', Icons.calendar_today_outlined),
    'reminders': ('Reminders', Icons.checklist_outlined),
    'alarms': ('Alarms', Icons.alarm_outlined),
    'contacts': ('Contacts', Icons.person_outline),
    'location': ('Location', Icons.location_on_outlined),
    'messages': ('Messages', Icons.chat_bubble_outline),
    'home': ('Home', Icons.home_outlined),
  };

  String _capLabel(String cap) =>
      _appMeta[cap]?.$1 ?? '${cap[0].toUpperCase()}${cap.substring(1)}';

  IconData _capIcon(String cap) =>
      _appMeta[cap]?.$2 ?? Icons.apps_outlined;

  void _lockedGrant(String capability) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          '${_capLabel(capability)} stays shared. Turn it off in Settings to take it back.',
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final writes = [
      for (final tool in phoneToolCapability.keys)
        if (isPhoneWrite(tool)) tool,
    ];
    final grouped = <String, List<String>>{};
    for (final tool in writes) {
      grouped.putIfAbsent(phoneToolCapability[tool] ?? tool, () => []).add(tool);
    }
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(title: const Text('Connect apps')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
                children: [
                  const _SectionLabel('This phone'),
                  _Group(
                    children: [
                      if (_self == null)
                        Padding(
                          padding: const EdgeInsets.fromLTRB(16, 16, 16, 16),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text(
                                'Let your bots use this phone’s apps. Jobs run only while the app is open, and every change asks first.',
                                style: TextStyle(height: 1.35),
                              ),
                              const SizedBox(height: 14),
                              SizedBox(
                                width: double.infinity,
                                child: FilledButton(
                                  style: FilledButton.styleFrom(
                                    backgroundColor: MaxTokens.ember,
                                    foregroundColor: Colors.white,
                                    shape: const StadiumBorder(),
                                    padding: const EdgeInsets.symmetric(vertical: 14),
                                  ),
                                  onPressed: _busy ? null : _register,
                                  child: Text(
                                    _busy ? 'Sharing…' : 'Share this phone’s apps',
                                  ),
                                ),
                              ),
                            ],
                          ),
                        )
                      else
                        ListTile(
                          leading: const _IconWell(icon: Icons.phone_iphone),
                          title: Text(
                            _self!.name,
                            style: const TextStyle(fontWeight: FontWeight.w600),
                          ),
                          subtitle: Text(
                            '${_self!.platform} · ${_self!.capabilities.length} apps shared'
                            '${_self!.busy ? ' · working now' : ''}',
                          ),
                          trailing: TextButton(
                            onPressed: _busy ? null : _unregister,
                            child: const Text('Stop sharing'),
                          ),
                        ),
                    ],
                  ),
                  const _SectionLabel('App access'),
                  _Group(
                    children: [
                      for (var i = 0; i < _capabilities.length; i++) ...[
                        if (i > 0) const Divider(height: 1, indent: 68),
                        _AccessRow(
                          icon: _capIcon(_capabilities[i]),
                          title: _capLabel(_capabilities[i]),
                          detail: _grants[_capabilities[i]] == CapPermission.granted
                              ? 'Shared with your bots'
                              : _capabilities[i] == 'reminders'
                              ? 'Needs the iOS Reminders update'
                              : 'Not shared',
                          on: _grants[_capabilities[i]] == CapPermission.granted,
                          enabled: widget.gate != null,
                          onTurnOn: () => _grant(_capabilities[i]),
                          onLocked: () => _lockedGrant(_capabilities[i]),
                        ),
                      ],
                    ],
                  ),
                  const _SectionLabel('Ask first'),
                  const Padding(
                    padding: EdgeInsets.only(left: 8, bottom: 8),
                    child: Text(
                      'Changes ask every time unless you pick Always or Never.',
                      style: TextStyle(fontSize: 13, color: Color(0xFF8E8E93)),
                    ),
                  ),
                  for (final cap in grouped.keys) ...[
                    Padding(
                      padding: const EdgeInsets.only(left: 8, bottom: 6),
                      child: Text(
                        _capLabel(cap),
                        style: const TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                          color: Color(0xFF8E8E93),
                        ),
                      ),
                    ),
                    _Group(
                      children: [
                        for (var i = 0; i < grouped[cap]!.length; i++) ...[
                          if (i > 0) const Divider(height: 1, indent: 16),
                          _PolicyRow(
                            title: _toolLabel(grouped[cap]![i]),
                            value: _policies[grouped[cap]![i]] ?? ToolPolicy.ask,
                            onChanged: (policy) =>
                                _flipPolicy(grouped[cap]![i], policy),
                          ),
                        ],
                      ],
                    ),
                    const SizedBox(height: 8),
                  ],
                  if (widget.auth.isAdmin) ...[
                    const _SectionLabel('Phones'),
                    _Group(
                      children: [
                        if (_devices.isEmpty)
                          const ListTile(
                            title: Text('No phones registered.'),
                          )
                        else
                          for (var i = 0; i < _devices.length; i++) ...[
                            if (i > 0) const Divider(height: 1, indent: 68),
                            ListTile(
                              leading: _IconWell(
                                icon: _devices[i].online
                                    ? Icons.phone_iphone
                                    : Icons.phone_disabled_outlined,
                              ),
                              title: Text(
                                _devices[i].name,
                                style: const TextStyle(fontWeight: FontWeight.w600),
                              ),
                              subtitle: Text(
                                '${_devices[i].platform} · ${_devices[i].online ? 'online' : 'offline'}'
                                '${_devices[i].busy ? ' · busy' : ''}'
                                '${_devices[i].capabilities.isEmpty ? '' : ' · ${_devices[i].capabilities.keys.join(', ')}'}',
                              ),
                              trailing: IconButton(
                                icon: const Icon(Icons.delete_outline),
                                tooltip: 'Remove ${_devices[i].name}',
                                onPressed: () => _removeDevice(_devices[i]),
                              ),
                            ),
                          ],
                      ],
                    ),
                  ],
                ],
              ),
            ),
    );
  }
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
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
  }
}

class _Group extends StatelessWidget {
  const _Group({required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: const Color(0xFFF2F2F7),
      borderRadius: BorderRadius.circular(16),
      clipBehavior: Clip.antiAlias,
      child: Column(children: children),
    );
  }
}

class _IconWell extends StatelessWidget {
  const _IconWell({required this.icon});

  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 36,
      height: 36,
      decoration: const BoxDecoration(
        color: Colors.white,
        shape: BoxShape.circle,
      ),
      child: Icon(icon, size: 18, color: const Color(0xFF1C1C1E)),
    );
  }
}

class _AccessRow extends StatelessWidget {
  const _AccessRow({
    required this.icon,
    required this.title,
    required this.detail,
    required this.on,
    required this.enabled,
    required this.onTurnOn,
    required this.onLocked,
  });

  final IconData icon;
  final String title;
  final String detail;
  final bool on;
  final bool enabled;
  final VoidCallback onTurnOn;
  final VoidCallback onLocked;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: _IconWell(icon: icon),
      title: Text(title, style: const TextStyle(fontWeight: FontWeight.w600)),
      subtitle: Text(detail),
      trailing: _ShareSwitch(
        on: on,
        enabled: enabled,
        onTap: !enabled
            ? null
            : () {
                if (on) {
                  onLocked();
                } else {
                  onTurnOn();
                }
              },
      ),
    );
  }
}

/// iOS-style switch. Turning a shared app off is refused here: the OS
/// grant has to be removed in Settings, and the thumb stays on.
class _ShareSwitch extends StatelessWidget {
  const _ShareSwitch({required this.on, required this.enabled, this.onTap});

  final bool on;
  final bool enabled;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedOpacity(
        duration: const Duration(milliseconds: 180),
        opacity: enabled ? 1 : 0.4,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 220),
          curve: Curves.easeOutCubic,
          width: 51,
          height: 31,
          padding: const EdgeInsets.all(2),
          decoration: BoxDecoration(
            color: on ? MaxTokens.ember : const Color(0xFFE5E5EA),
            borderRadius: BorderRadius.circular(16),
          ),
          child: AnimatedAlign(
            duration: const Duration(milliseconds: 220),
            curve: Curves.easeOutCubic,
            alignment: on ? Alignment.centerRight : Alignment.centerLeft,
            child: Container(
              width: 27,
              height: 27,
              decoration: BoxDecoration(
                color: Colors.white,
                shape: BoxShape.circle,
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withValues(alpha: 0.15),
                    blurRadius: 2,
                    offset: const Offset(0, 1),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _PolicyRow extends StatelessWidget {
  const _PolicyRow({
    required this.title,
    required this.value,
    required this.onChanged,
  });

  final String title;
  final ToolPolicy value;
  final ValueChanged<ToolPolicy> onChanged;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: const TextStyle(fontWeight: FontWeight.w600)),
          const SizedBox(height: 8),
          _AskPicker(value: value, onChanged: onChanged),
        ],
      ),
    );
  }
}

class _AskPicker extends StatelessWidget {
  const _AskPicker({required this.value, required this.onChanged});

  final ToolPolicy value;
  final ValueChanged<ToolPolicy> onChanged;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(2),
      decoration: BoxDecoration(
        color: const Color(0xFFE5E5EA),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        children: [
          for (final policy in ToolPolicy.values)
            Expanded(
              child: GestureDetector(
                onTap: () => onChanged(policy),
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 200),
                  curve: Curves.easeOutCubic,
                  height: 30,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: value == policy ? MaxTokens.ember : Colors.transparent,
                    borderRadius: BorderRadius.circular(8),
                    boxShadow: value == policy
                        ? [
                            BoxShadow(
                              color: Colors.black.withValues(alpha: 0.08),
                              blurRadius: 3,
                              offset: const Offset(0, 1),
                            ),
                          ]
                        : null,
                  ),
                  child: Text(
                    switch (policy) {
                      ToolPolicy.ask => 'Ask',
                      ToolPolicy.always => 'Always',
                      ToolPolicy.never => 'Never',
                    },
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: value == policy
                          ? FontWeight.w600
                          : FontWeight.w500,
                      color: value == policy
                          ? Colors.white
                          : const Color(0xFF8E8E93),
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// The permission card for one job: what the bot wants, in words.
class PhoneJobCard extends StatelessWidget {
  const PhoneJobCard({super.key, required this.job});

  final PhoneJob job;

  String get _title {
    final label = job.tool
        .replaceFirst('PHONE_', '')
        .split('_')
        .map((w) => w[0] + w.substring(1).toLowerCase())
        .join(' ');
    return 'Let your bot $label?';
  }

  String get _detail {
    final args = job.arguments;
    final interesting = [
      for (final key in ['title', 'text', 'to', 'query', 'start', 'name'])
        if (args[key] is String && (args[key] as String).isNotEmpty)
          '${args[key]}',
    ];
    return interesting.take(2).join(' · ');
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 12),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 56,
            height: 56,
            decoration: const BoxDecoration(
              color: Color(0xFFF2F2F7),
              shape: BoxShape.circle,
            ),
            child: const Icon(Icons.phone_iphone, color: Color(0xFF1C1C1E)),
          ),
          const SizedBox(height: 12),
          Text(
            _title,
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600),
          ),
          if (_detail.isNotEmpty) ...[
            const SizedBox(height: 6),
            Text(
              _detail,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 15),
            ),
          ],
          const SizedBox(height: 6),
          const Text(
            'Runs on this phone only, right now.',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 13, color: Color(0xFF8E8E93)),
          ),
        ],
      ),
    );
  }
}
