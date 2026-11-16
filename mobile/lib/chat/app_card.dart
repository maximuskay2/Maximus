import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../api/client.dart';
import '../api/models.dart';

typedef AppFrameBuilder = Widget Function(
  BuildContext context,
  ChatAppDocument doc,
  double height,
);

/// Bot HTML / MCP app row: fetches the document and mounts a sandboxed frame.
class AppCard extends StatefulWidget {
  const AppCard({
    super.key,
    required this.client,
    required this.baseUrl,
    required this.botId,
    required this.threadId,
    required this.messageId,
    required this.payload,
    this.fallbackText,
    this.frameBuilder,
  });

  final MaximusApi client;
  final String baseUrl;
  final String botId;
  final String threadId;
  final String messageId;
  final ChatAppPayload payload;
  final String? fallbackText;
  final AppFrameBuilder? frameBuilder;

  @override
  State<AppCard> createState() => _AppCardState();
}

class _AppCardState extends State<AppCard> {
  ChatAppDocument? _doc;
  String? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    if (widget.payload.blocked != null || widget.payload.doc.isEmpty) {
      _loading = false;
      _error = widget.fallbackText ?? 'This page is not available.';
    } else {
      _load();
    }
  }

  Future<void> _load() async {
    try {
      final doc = await widget.client.fetchAppDocument(
        widget.baseUrl,
        widget.threadId,
        widget.messageId,
        rev: widget.payload.rev,
      );
      if (!mounted) return;
      setState(() {
        _doc = doc;
        _loading = false;
        _error = null;
      });
    } on ApiError catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = error.message;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = '$error';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final height = widget.payload.frameHeight.toDouble();
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(top: 8),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(22),
        border: widget.payload.border
            ? Border.all(color: const Color(0xFFE5E5EA))
            : null,
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 10, 12, 8),
            child: Text(
              widget.payload.title,
              style: Theme.of(context).textTheme.titleSmall,
            ),
          ),
          if (_loading)
            SizedBox(
              height: height,
              child: const Center(child: CircularProgressIndicator(strokeWidth: 2)),
            )
          else if (_doc != null)
            SizedBox(
              height: height,
              child: (widget.frameBuilder ?? defaultAppFrame)(
                context,
                _doc!,
                height,
              ),
            )
          else
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
              child: Text(
                _error ?? widget.fallbackText ?? 'This page is not available.',
                style: const TextStyle(color: Color(0xFF8E8E93), fontSize: 14),
              ),
            ),
        ],
      ),
    );
  }
}

Widget defaultAppFrame(BuildContext context, ChatAppDocument doc, double height) {
  if (WidgetsBinding.instance.runtimeType.toString().contains('Test')) {
    return SingleChildScrollView(child: Text(doc.srcdoc));
  }
  return AppWebFrame(doc: doc, height: height);
}

class AppWebFrame extends StatefulWidget {
  const AppWebFrame({super.key, required this.doc, required this.height});

  final ChatAppDocument doc;
  final double height;

  @override
  State<AppWebFrame> createState() => _AppWebFrameState();
}

class _AppWebFrameState extends State<AppWebFrame> {
  late final WebViewController _controller = WebViewController()
    ..setJavaScriptMode(JavaScriptMode.unrestricted)
    ..setBackgroundColor(Colors.transparent)
    ..setNavigationDelegate(
      NavigationDelegate(
        onNavigationRequest: (request) {
          if (request.isMainFrame &&
              request.url != 'about:blank' &&
              !request.url.startsWith('data:')) {
            return NavigationDecision.prevent;
          }
          return NavigationDecision.navigate;
        },
      ),
    )
    ..loadHtmlString(widget.doc.srcdoc);

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: widget.height,
      child: WebViewWidget(controller: _controller),
    );
  }
}
