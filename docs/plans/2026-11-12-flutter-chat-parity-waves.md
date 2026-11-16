# Flutter chat + product waves (no Slack/X host)

Maximus is not a Grok Slack/X teammate product. Scope is phone/web/desktop
parity for finishing work in chat, phone tools, and server durability.

## Wave A — Flutter chat

1. Connector cards in thread + authorize/status/dismiss (Connect apps catalog later)
2. Widget draft Send/Discard (`emailDraft`-shaped) + outbound Allow/Deny
3. Share-sheet ingest: `maximus://share?text=` + Android `ACTION_SEND` text;
   iOS Share Extension still open
4. Library (published pages) + home needs-you strip
5. Room `@everyone` + member `@` names; outbound ask/allow; `custom` stays desktop

## Wave B — Phone device tools

Alarms, Reminders, Apple Home (where platform allows); keep-app-open UX for
phone tools.

## Wave C — Server

Durable turn queue across restart; bot→bot handoff envelope; browser
teach-recorder; meetings join/recap product.

Out of scope: Slack/X first-class teammate hosting.

## Status (2026-11-12)

Wave A: chat cards + Android share + iOS Share Extension target.
Wave B: iOS reminders/HomeKit + alarms (iOS notifications / Android Clock).
Wave C: durable turn park/interrupt on boot; handoff envelope; browser
teach-session; meetings Join already in brief cards.

Phone chat cards include connector, widget confirm/cancel, and `show_html`
app rows (sandboxed document fetch + frame). Full ChatKit RPC on the phone
is still open. SSE reconnect and the dropped-radio drill are
[2026-11-15 Maximus roadmap](2026-11-15-maximus-roadmap.md) (v1 gates).
