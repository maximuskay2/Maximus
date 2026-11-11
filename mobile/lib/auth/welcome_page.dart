import 'package:flutter/material.dart';

import '../gallery/gallery_page.dart';
import 'auth_state.dart';
import 'signin_page.dart';

/// First-run: tour + sign-in options. Existing users (paired servers)
/// skip straight to the synced home.
class WelcomePage extends StatelessWidget {
  const WelcomePage({super.key, required this.auth});
  final AuthState auth;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Spacer(),
              const MaximusMark(size: 64),
              const SizedBox(height: 24),
              Text(
                'Your proactive AI teammate.',
                style: Theme.of(context).textTheme.headlineMedium,
              ),
              const SizedBox(height: 8),
              Text(
                'Bots that do the work, approvals you tap, results anywhere.',
                style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                  color: scheme.onSurfaceVariant,
                ),
              ),
              const SizedBox(height: 24),
              const _TourRow(
                icon: Icons.chat_bubble_outline,
                text: 'Chat with your bots, anywhere',
              ),
              const _TourRow(
                icon: Icons.check_circle_outline,
                text: 'Approve steps with one tap',
              ),
              const _TourRow(
                icon: Icons.notifications_outlined,
                text: 'Get pinged when a bot needs you',
              ),
              const Spacer(),
              FilledButton(
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => SignInPage(auth: auth),
                  ),
                ),
                style: FilledButton.styleFrom(
                  minimumSize: const Size.fromHeight(52),
                ),
                child: const Text('Sign in'),
              ),
              const SizedBox(height: 12),
              OutlinedButton(
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => SignInPage(auth: auth, creating: true),
                  ),
                ),
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size.fromHeight(52),
                ),
                child: const Text('Create account'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _TourRow extends StatelessWidget {
  const _TourRow({required this.icon, required this.text});
  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Icon(icon, color: Theme.of(context).colorScheme.primary),
          const SizedBox(width: 12),
          Expanded(child: Text(text)),
        ],
      ),
    );
  }
}
