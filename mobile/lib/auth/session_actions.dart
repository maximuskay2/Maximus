import 'package:flutter/material.dart';

import '../api/models.dart';
import 'auth_state.dart';
import 'signin_page.dart';

/// Opens email sign-in for the server this phone is already talking to.
void openSignIn(BuildContext context, AuthState auth, {String? baseUrl}) {
  final url = baseUrl ?? auth.active?.baseUrl;
  Navigator.of(context).push(
    MaterialPageRoute<void>(
      builder: (_) => SignInPage(auth: auth, initialBaseUrl: url),
    ),
  );
}

/// Ends the server session, then forgets it on this phone.
Future<void> signOutOfActiveServer(BuildContext context, AuthState auth) async {
  final active = auth.active;
  if (active == null) return;
  final confirm = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: const Text('Sign out?'),
      content: Text('This phone forgets ${active.name} and its session ends.'),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(false),
          child: const Text('Stay'),
        ),
        FilledButton(
          onPressed: () => Navigator.of(context).pop(true),
          child: const Text('Sign out'),
        ),
      ],
    ),
  );
  if (confirm != true || !context.mounted) return;
  try {
    await auth.client.logout(active.baseUrl);
  } on ApiError {
    // A dead server must not trap the phone.
  }
  await auth.removeServer(active.id);
  if (context.mounted) {
    Navigator.of(context).popUntil((route) => route.isFirst);
  }
}

/// Sign in and Sign out, used wherever a page would otherwise only offer Retry.
class SessionActions extends StatelessWidget {
  const SessionActions({super.key, required this.auth, this.baseUrl});

  final AuthState auth;
  final String? baseUrl;

  @override
  Widget build(BuildContext context) {
    final signedIn = auth.scopes.isNotEmpty;
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (signedIn)
          FilledButton.tonal(
            onPressed: () => signOutOfActiveServer(context, auth),
            child: const Text('Sign out'),
          )
        else
          FilledButton(
            onPressed: () => openSignIn(context, auth, baseUrl: baseUrl),
            child: const Text('Sign in'),
          ),
      ],
    );
  }
}

/// Shown when a page needs admin and this phone only has client.
class OwnerOnlyBody extends StatelessWidget {
  const OwnerOnlyBody({
    super.key,
    required this.auth,
    required this.baseUrl,
    this.detail =
        'Sign out, then sign in with the home owner account.',
  });

  final AuthState auth;
  final String baseUrl;
  final String detail;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              'Owner only',
              style: theme.textTheme.titleMedium,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 8),
            Text(
              detail,
              style: theme.textTheme.bodyMedium,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 16),
            SessionActions(auth: auth, baseUrl: baseUrl),
            if (auth.scopes.isNotEmpty) ...[
              const SizedBox(height: 8),
              TextButton(
                onPressed: () => openSignIn(context, auth, baseUrl: baseUrl),
                child: const Text('Sign in as owner'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
