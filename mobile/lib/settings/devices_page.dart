import 'package:flutter/material.dart';

import '../api/client.dart';
import '../api/models.dart';

/// Phase 7: signed-in devices, with revoke.
class DevicesPage extends StatefulWidget {
  const DevicesPage({
    super.key,
    required this.client,
    required this.baseUrl,
  });

  final MaximusApi client;
  final String baseUrl;

  @override
  State<DevicesPage> createState() => _DevicesPageState();
}

class _DevicesPageState extends State<DevicesPage> {
  List<DeviceSession> _devices = const [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final devices = await widget.client.sessions(widget.baseUrl);
      if (mounted) setState(() => _devices = devices);
    } on ApiError catch (error) {
      if (mounted) setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _revoke(DeviceSession device) async {
    final messenger = ScaffoldMessenger.of(context);
    final confirm = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('Remove ${device.label}?'),
        content: Text(
          device.current
              ? 'This is this phone — it will sign out.'
              : 'That device signs out immediately.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Keep'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Remove'),
          ),
        ],
      ),
    );
    if (confirm != true || !mounted) return;
    try {
      await widget.client.revokeSession(widget.baseUrl, device.id);
      _load();
    } on ApiError catch (error) {
      if (mounted) {
        messenger.showSnackBar(SnackBar(content: Text(error.message)));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Devices')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
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
                padding: const EdgeInsets.only(bottom: 32),
                children: [
                  if (_devices.isEmpty)
                    const ListTile(
                      title: Text('No devices'),
                      subtitle: Text('Pull to refresh.'),
                    )
                  else
                    for (final device in _devices)
                      ListTile(
                        leading: Icon(
                          device.current
                              ? Icons.phone_android_outlined
                              : Icons.devices_outlined,
                        ),
                        title: Text(device.label),
                        subtitle: Text(
                          "${device.current ? 'This phone · ' : ''}"
                          "${device.scopes.join(', ')}"
                          "${device.lastSeenAt == null ? '' : ' · seen ${_ago(device.lastSeenAt!)}'}",
                        ),
                        trailing: IconButton(
                          icon: const Icon(Icons.logout_outlined),
                          tooltip: 'Remove',
                          onPressed: () => _revoke(device),
                        ),
                      ),
                ],
              ),
            ),
    );
  }

  String _ago(int at) {
    final diff = DateTime.now().difference(
      DateTime.fromMillisecondsSinceEpoch(at),
    );
    if (diff.inMinutes < 1) return 'just now';
    if (diff.inHours < 1) return '${diff.inMinutes}m ago';
    if (diff.inDays < 1) return '${diff.inHours}h ago';
    return '${diff.inDays}d ago';
  }
}
