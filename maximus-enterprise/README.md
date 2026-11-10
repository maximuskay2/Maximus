# maximus-enterprise/

The Maximus enterprise layer, under the [Maximus Enterprise License](LICENSE)
— not Apache 2.0. Clean-room code: written from the interface in
`server/enterprise.ts` alone after upstream `enterprise/` was deleted.

- `license.ts` — `max1.<claims>.<signature>` issue/verify (Ed25519).
- `server/index.ts` — the entry core dynamically loads: `register()` turns
  `MAXIMUS_LICENSE_KEY` into entitlements; `createWorkspaceAccess()` is the
  hosted sign-in adapter.
- `workspace-access.ts` — portal-only sign-in for portal-managed workspaces.
- `scripts/keygen.mjs` — generates a signing keypair (private key outside
  the repo, mode 0600).
- `scripts/issue-license.mjs` — signs a key for a customer.
- `FEATURES` — the entitlement ids a key may grant.

Delete this folder and what remains is the open-source edition: the server
reports `{"edition":"oss"}` and ordinary standalone operation is unchanged.
A workspace explicitly configured for hosted sign-in refuses remote access
without the adapter; removing the layer never bypasses its sign-in authority.
