import 'package:flutter/material.dart';

import '../api/client.dart';
import '../api/models.dart';

/// Home search across messages, bots, threads, and files (`/api/search`).
class SearchPage extends StatefulWidget {
  const SearchPage({super.key, required this.client, required this.baseUrl});
  final MaximusApi client;
  final String baseUrl;

  @override
  State<SearchPage> createState() => _SearchPageState();
}

class _SearchPageState extends State<SearchPage> {
  final _controller = TextEditingController();
  List<Map<String, Object?>> _hits = const [];
  bool _busy = false;
  bool _searched = false;
  String? _error;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _search() async {
    final query = _controller.text.trim();
    if (query.isEmpty) return;
    setState(() {
      _busy = true;
      _error = null;
      _searched = true;
    });
    try {
      final hits = await widget.client.search(widget.baseUrl, query);
      if (mounted) setState(() => _hits = hits);
    } on ApiError catch (error) {
      if (mounted) setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Search')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(16),
            child: SearchBar(
              controller: _controller,
              hintText: 'Messages, bots, files…',
              onSubmitted: (_) => _search(),
              trailing: [
                if (_busy)
                  const SizedBox.square(
                    dimension: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                else
                  IconButton(
                    icon: const Icon(Icons.search),
                    onPressed: _search,
                  ),
              ],
            ),
          ),
          Expanded(child: _body()),
        ],
      ),
    );
  }

  Widget _body() {
    if (_error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(_error!),
              const SizedBox(height: 12),
              FilledButton(onPressed: _search, child: const Text('Retry')),
            ],
          ),
        ),
      );
    }
    if (!_searched) {
      return Center(
        child: Text(
          'Find anything across your bots.',
          style: TextStyle(
            color: Theme.of(context).colorScheme.onSurfaceVariant,
          ),
        ),
      );
    }
    if (_hits.isEmpty && !_busy) {
      return const Center(child: Text('No results.'));
    }
    return ListView.builder(
      itemCount: _hits.length,
      itemBuilder: (context, index) {
        final hit = _hits[index];
        final kind = '${hit['kind'] ?? 'result'}';
        return ListTile(
          leading: Icon(
            switch (kind) {
              'message' => Icons.chat_bubble_outline,
              'bot' => Icons.smart_toy_outlined,
              'file' => Icons.insert_drive_file_outlined,
              _ => Icons.search_outlined,
            },
          ),
          title: Text(
            '${hit['title'] ?? hit['text'] ?? hit['id'] ?? kind}',
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
          ),
          subtitle: Text(kind),
        );
      },
    );
  }
}
