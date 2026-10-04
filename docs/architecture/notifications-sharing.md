# EGO-94: notifications, deep links and sharing

Base: merged EGO-93/EGO-100 on main `7e4c50d`. EGO-95 remains outside scope.
The owner explicitly reselected EGO-94 after the dependency review. EGO-82 is
still Backlog: cards use a provisional text template/current application styles,
not an approved final brand kit. No EGO-82 deliverable is claimed.

## Authority and event capture

`packages/notifications` owns application ports and worker orchestration;
framework-independent kinds/titles/deep links live in `packages/domain`.
PostgreSQL AFTER triggers append a small outbox fact in the same transaction as
Placement insertion, takeover displacement and terminal Order status change.
Rollback rolls back the fact. The source key uniquely identifies each fact.
No provider response, price, user-supplied event or browser return authorizes it.
No network or preference lookup occurs under claim/payment business locks.
Existing ownership writers/lock order and immutable financial rows are unchanged.

Terminal payment notices are `fulfilled`, `canceled`, `paid_but_not_fulfilled`.
Pending/unknown status is available through the existing order-status UI. A
payment notification links to the owner-only payment-return context. There is
no refund subsystem in merged main: `refund_status` is a defined event category
and preference, awaiting authoritative EGO-102 events. This task does not create
refunds, report manual compensation as refunded, or implement EGO-102/103.

The worker discovers cooldown completion from the active Placement's persisted
start and pinned pricing version while the Wall is live; no browser clock is
used. Reminders older than 15 minutes are omitted after downtime. Explicit Wall
subscriptions receive notices within 15 minutes before scheduled start or end;
notifications do not schedule/publish/end a Wall. There is no historical backfill
on migration and no subscription inferred from a social login.

## Preferences, delivery and limits

Web delivery defaults on; Telegram defaults off. The owner-only inbox returns
the latest 100 delivered in-app items with stable deep links and idempotent read
markers. Preferences can disable either channel or each event type. All private
responses are `no-store`; ordinary session and Origin protections apply.

Worker fanout locks an event with `SKIP LOCKED` and serializes each recipient's
preferences. One `(event, channel)` record is enforced by PostgreSQL. Suppression
is recorded, rather than repeatedly processing disabled recipients. Rate policy:
one notice of a given type per Wall/channel in a sliding 10-minute window and at
most 20 per recipient/channel in an hour. All source facts remain available even
when their notices are suppressed. Limits are shared across application pools.

Telegram linking requires an authenticated application session and an explicit
consent button. A 256-bit one-time `/start` challenge expires in 10 minutes; only
its hash is persisted. The configured secret header authenticates the webhook;
only a private non-bot chat whose sender ID matches chat ID can consume it. A
username or Telegram OIDC subject is never treated as a routable chat/consent.
One chat can bind to only one local account. Challenges are issued at most once
per minute. `/stop`, preferences and disconnect revoke future sending; old events
are not sent to newly linked chats. A request already sent at unsubscribe may
still complete.

Sending reserves a persisted token/60-second lease, then releases SQL locks.
Across workers a PostgreSQL advisory gate limits all bot sends to one per second.
An explicit rejected Bot API 429 retries using its bounded `retry_after`, at most
five attempts. Transport failure, malformed/oversized response, 5xx and a crash
after send reservation enter `uncertain`: they are **never automatically resent**.
Bot API `sendMessage` has no idempotency key; pretending external exactly-once
delivery would duplicate notices. Operators inspect uncertain/failed deliveries
without exposing chat IDs, message text or bot credentials in logs. In-app
notifications remain available independently of external delivery.

## Public cards and attribution

An authenticated owner creates a share for their own ready autograph Placement
on a public Wall, or for a final ended Wall they own/participated in. The server
selects event, creator and slot number. A public username is optional and requires
separate explicit publication consent; no provider username is inferred. There
is a 20-share/hour owner budget. Links can be revoked by their owner. Archived
Walls, nonready autographs and revoked links fail closed for public reads/cards.

`/s/:id` provides OG and Twitter large-image metadata. The API renders a fixed
1200×630 PNG containing creator, one-based slot number, optional public username,
event and CTA. It renders escaped text only and never reads original/private
autograph bytes, avatars, keys, signed URLs, payments or claimant identifiers.
The API runtime image includes DejaVu fonts so a minimal Linux image renders text.
PNG and share metadata use `no-store`; previously copied social previews cannot
be recalled from a third-party cache.

Slot links use `/walls/:id#slot-:slotId` and stable focusable anchors. Sharing
uses native Web Share when available; cancellation ends the action, unsupported
or rejected sharing falls back to copying a visible URL. Clipboard failure leaves
the URL available for manual copying.

`share_clicked` and `referral_arrived` are narrowly scoped, deduplicated telemetry
events. Incoming attribution records the public share ID and a session-scoped
random UUID; it does not collect IP, referrer URL, provider identity or user-agent.
It records landing on the shared page, not a claimed conversion. Each share has
a persistent 300-interaction/hour budget; telemetry failures never block sharing.
General analytics/referral rewards remain outside EGO-94.

## Operations

Apply migrations 0015/0016 before starting the new API/worker. The additive six
tables and triggers preserve existing placements/financial history. No cloud,
production deployment, IAM, Lockbox or payment configuration is changed.

In-app delivery needs only the existing worker/PostgreSQL. Optional Telegram
configuration must be complete in both API and worker:

- `NOTIFICATION_TELEGRAM_BOT_TOKEN`: server-only Bot API credential;
- `NOTIFICATION_TELEGRAM_BOT_USERNAME`: nonsensitive bot username;
- `NOTIFICATION_TELEGRAM_WEBHOOK_SECRET`: 32–256 URL-safe characters;
- existing canonical `WEB_ORIGIN` (HTTPS in staging/production).

With no bot variables, Telegram linking/webhook/sending are disabled. Partial
configuration fails startup with redacted values. The operator configures an HTTPS
`/notifications/telegram/webhook` using Bot API `setWebhook` with `secret_token`
and only `message` updates. Never log the token-bearing API URL or payload. API
requests are bounded by 10 seconds/64 KiB; the webhook body is limited to 16 KiB.
Configure perimeter limits for public metadata/card/webhook endpoints on deployment.

Check `notification_events.processed_at IS NULL` backlog and delivery states
`retry`, `failed`, `uncertain`; worker cycle errors use fixed messages. Retention
and formal data-deletion operations belong to EGO-110. No real Telegram messages
are sent by automated tests, and real channel/social-client smoke remains a
runtime gate after authorized sandbox deployment.

Protocol references checked during implementation:
[Telegram sendMessage](https://core.telegram.org/bots/api#sendmessage),
[Telegram webhook authentication](https://core.telegram.org/bots/api#setwebhook),
[Web Share](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share).
