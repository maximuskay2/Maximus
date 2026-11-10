import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../api/models.dart';
import 'auth_state.dart';
import 'pairing_link.dart';

/// Pair by QR scan or manual server URL + code.
class PairPage extends StatefulWidget {
  const PairPage({super.key, required this.auth, this.label});
  final AuthState auth;
  final String? label;

  @override
  State<PairPage> createState() => _PairPageState();
}

class _PairPageState extends State<PairPage> {
  final _urlController = TextEditingController(text: 'http://127.0.0.1:8799');
  final _codeController = TextEditingController();
  MobileScannerController? _scanner;
  bool _scanning = false;
  bool _busy = false;
  String? _error;
  bool _handledScan = false;

  void _startScan() {
    setState(() {
      _scanner = MobileScannerController();
      _scanning = true;
    });
  }

  @override
  void dispose() {
    _urlController.dispose();
    _codeController.dispose();
    _scanner?.dispose();
    super.dispose();
  }

  Future<void> _pair({required String baseUrl, required String code}) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.auth.pair(
        baseUrl: baseUrl.trim().replaceAll(RegExp(r'/+$'), ''),
        code: code.trim(),
        label: widget.label ?? 'Phone',
      );
      if (mounted) Navigator.of(context).popUntil((route) => route.isFirst);
    } on ApiError catch (error) {
      setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _onScan(BarcodeCapture capture) {
    if (_handledScan || _busy) return;
    final raw = capture.barcodes.firstOrNull?.rawValue;
    if (raw == null) return;
    final parsed = ParsedPairing.tryParse(raw);
    if (parsed == null || parsed.code == null) {
      setState(() => _error = 'That code is not a Maximus pairing link.');
      return;
    }
    _handledScan = true;
    final baseUrl = parsed.serverUrl ?? _urlController.text;
    _urlController.text = baseUrl;
    _codeController.text = parsed.code!;
    _pair(baseUrl: baseUrl, code: parsed.code!);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Pair a server')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          if (_scanning && _scanner != null)
            ClipRRect(
              borderRadius: BorderRadius.circular(24),
              child: SizedBox(
                height: 260,
                child: MobileScanner(
                  controller: _scanner!,
                  onDetect: _onScan,
                ),
              ),
            )
          else
            OutlinedButton.icon(
              onPressed: _busy ? null : _startScan,
              icon: const Icon(Icons.qr_code_scanner_outlined),
              label: const Text('Scan QR code'),
              style: OutlinedButton.styleFrom(
                minimumSize: const Size.fromHeight(52),
              ),
            ),
          const SizedBox(height: 8),
          Text(
            'Scan the QR from your server’s pair screen, or enter it by hand.',
            style: Theme.of(context).textTheme.bodyMedium,
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _urlController,
            keyboardType: TextInputType.url,
            autocorrect: false,
            decoration: const InputDecoration(
              labelText: 'Server address',
              hintText: 'https://maus.example.com',
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _codeController,
            autocorrect: false,
            textCapitalization: TextCapitalization.characters,
            decoration: const InputDecoration(
              labelText: 'Pairing code',
              hintText: 'RR8Y-BLR6-H939',
            ),
          ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(top: 12),
              child: Text(
                _error!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: _busy
                ? null
                : () => _pair(
                      baseUrl: _urlController.text,
                      code: _codeController.text,
                    ),
            style: FilledButton.styleFrom(
              minimumSize: const Size.fromHeight(52),
            ),
            child: _busy
                ? const SizedBox.square(
                    dimension: 20,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: Colors.white,
                    ),
                  )
                : const Text('Pair this phone'),
          ),
        ],
      ),
    );
  }
}
