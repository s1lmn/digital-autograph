# Privacy and consent foundation — EGO-74 / EGO-75 / EGO-110

This is backend evidence infrastructure, not completion of EGO-110. PostgreSQL
and the server registry authorize legal state; browser fields do not. No universal
privacy checkbox is introduced. Terms, content rules and the paid Offer are
contractual documents; Privacy Policy is information, not a consent event.

## Canonical documents and publication

Seven public source texts in `docs/legal/public` and two internal specifications
in `docs/legal/internal` were transcribed from the operator's legal bundle. Only
formatting was normalized. Internal texts are never served by the API. The supplied
DOCX transfer checksums matched all nine sources; those binary checksums are not
runtime legal hashes.

The registry is `packages/config/src/legal-documents.json`. SHA-256 lowercase hex
covers the exact UTF-8 bytes of each canonical Markdown file, including whitespace
and final newline. `loadLegalDocuments()` validates bytes against this registry;
the public text endpoint serves those same bytes. No client supplies authoritative
versions or hashes. An approved content change requires a new immutable version,
new path/file/hash and reviewed registry update; retain the old file and registry
entry so existing evidence remains interpretable. Exactly one `current: true` entry per document type is required. Archived versions
remain readable by their immutable version path; never silently replace old contents.

**All supplied documents still contain operator/contact/resource placeholders.**
The registry therefore marks every document `ready: false`. Draft text is available
with `X-Legal-Document-Status: draft` and no-store. Acceptance/grant and creation of
new paid Orders fail closed until finalized publication is independently verified.
There is no environment flag to bypass this gate. Existing Orders can still be
queried/reconciled/fulfilled without rewriting their original legal snapshot.
OAuth and ordinary existing content flows are unchanged by this foundation gate.

Before marking a version ready: fill operator details, exact public/archive URLs
and working contacts through legal/operator review, verify the exact served bytes
and hash, publish approved files and implement the appropriate user-facing legal
gate. DOCX source filenames containing “final” are not publication evidence.
The public wording also describes target workflows not all implemented today;
production/public-beta activation remains blocked by their operational completion.

## Evidence and effective state

`legal_evidence_events` is a new append-only journal. Old `consent_records` remains
unchanged and immutable, but its rows have no invented hash/action/context and do
not authorize current legal state. No backfill claims that legacy acceptance was
proved against these new documents.

Each new event stores authenticated user, document type/version/hash, explicit
`accepted`, `granted` or `withdrawn` action, bounded source/context identifiers,
database time, immutable consent scope and predecessor. Contractual types only
allow `accepted`; consent types only allow grant/withdrawal. Privacy Policy cannot
produce an acceptance/consent event. No IP, User-Agent, fingerprint, raw OAuth
assertion or extra profile data is added.

Evidence is ordered by database identity sequence assigned after stream
serialization; DB time is sampled then too. Repository mutations and the insert
guard serialize `(user, type, purpose)` using a transaction advisory lock. The
insert trigger requires the actual predecessor, enforces withdrawal binding and
rejects repeated identical events. UPDATE/DELETE triggers reject mutation. The
application database owner can still perform administrative operations: this is
protection against ordinary application writes, not a promise against a privileged
DB administrator. Fixtures alone use TRUNCATE on isolated databases.

Repository retry semantics: identical current action/version/hash/scope returns
its existing event. Another version, withdrawal or regrant after withdrawal appends.
Two purposes have separate streams. Withdrawal copies the actual latest grant's
version/hash/scope even if the registry has changed or is now unavailable; repeated
withdrawal returns the withdrawal, and withdrawal without a grant is a no-op.
The history is never edited. `isCurrentLegalState` requires a ready current registry
version/hash and a latest nonwithdrawn event. Legacy rows never satisfy it.

`LegalScope` records purpose, exact data item codes, resources and conditions. These
fields are immutable evidence of a future configured optional function, not a
blanket authorization for all processing. No optional-purpose grant HTTP route is
enabled because the associated purpose-specific UI/process is not implemented.
Trusted backend callers must supply an approved purpose and scope shown to the
subject. Withdrawal is not account deletion and does not revoke contractual/law
based processing. Actual erasure/queue/retention processing remains EGO-110.

Dissemination grants are rejected both by the domain and PostgreSQL. Ordinary
profile/username/avatar publication remains disabled. A future separate Article
10.1 implementation must add restricted subject identity/contact evidence, item
selection, exact resources, restrictions/conditions publication and immediate
access revocation before enabling this grant. This PR collects none of that extra
identity data and cannot be used as a shortcut to public profile publication.
Moderation already rejects personal-data content; private original assets and
public cleaned-placement evidence checks are unchanged.

## HTTP contracts

- `GET /legal/documents/:type/:version`: public canonical text only; no internal docs.
- `GET /legal/state/:type?purpose=…`: current session subject's latest event and
  current-version match; no-store, never another user's state.
- `POST /legal/accept { type }`: session-only, current Terms or content-rules version;
  source `web`, context `legal_gate`. Strict input rejects user/version/hash/scope.
- `POST /legal/withdraw { type: personal_data_consent, purpose }`: session-only,
  existing optional grant scope, source `web`, context `privacy_settings`; retries
  are no-op/idempotent. Only known optional purposes are accepted.

The existing exact-origin credentialed CSRF/CORS/session controls apply unchanged.
There is no contractual consent to all personal data, silent acceptance at login,
public consent-write endpoint, payment authorization via legal endpoint, or public
identity endpoint. A grant never happens implicitly on login/upload/payment.

The first-use age/Terms/rules UI, effective-version enforcement on interactive
operations and checkout checkbox/display contract are explicitly deferred. The
foundation does not claim that any user has passed them; no fake age or
`checkout_confirmed_at` event is inferred from existing API calls. These UI gates
must use current displayed document identities when implemented, including stale
page/version handling, before production activation.

## Payment Order snapshot

Before inserting a new Order the trusted registry pins Offer, content rules and
Refund Policy version/hash. All six fields are populated together, and the existing
Order snapshot trigger protects them from later UPDATE/DELETE alongside economic
inputs. The insert-only gate requires a complete snapshot for future Orders. Legacy
Orders retain all-null legal fields, explicitly meaning “not captured”; no sentinel
or new timestamp fabricates historic agreement. Acceptance/payment confirmation is
not inferred from the snapshot alone.

Snapshot occurs when a reservation becomes an Order, before provider I/O. A retry
returns the existing Order and preserves its documents even after config/version
change. Keep the displayed checkout terms pinned to that Order through payment;
a later publication must never silently substitute a different contract while an
Order is in flight. This foundation does not implement checkout UI or claim its
checkbox has been confirmed. The approved legal wording binds terms to the paid
Order; the implementation pins them earlier without rewriting at fulfillment.

One payment/Order/takeover/earning, duplicate webhook, late-payment safe path,
PostgreSQL lock order and network-outside-locks invariants remain unchanged. Tests
inject explicitly synthetic published legal documents, not operator production
acceptance. With the provided unfinished documents new real checkout is blocked.

## OAuth minimization

Google requests `openid` only. The adapter still verifies Google's ID token and
returns only `sub`/nonce; signature, issuer, audience, expiry, authorized presenter,
state, browser binding and one-time consumption are unchanged. No email linking or
profile persistence is introduced. See the official [Google OIDC contract](https://developers.google.com/identity/openid-connect/openid-connect)
and [claim reference](https://developers.google.com/identity/openid-connect/reference).

Telegram also requests `openid` only after checking its official
[available scopes](https://core.telegram.org/bots/telegram-login#available-scopes):
openid provides subject/authentication claims; profile provides unused personal
claims. PKCE/state/nonce/JWKS verification remains unchanged. Tests verify signed
minimal tokens without profile claims. Genuine provider login is a separate manual
rollout smoke; local fixtures do not claim a real Google or Telegram login.

## Migration and remaining operations

Forward migration `0017_legal_evidence` adds the new journal, guards and nullable
legacy Order columns. Earlier migrations and snapshots are not changed. Clean
migration, repeat migration, populated pre-0017 upgrade, legacy data preservation,
new snapshot protection, concurrency and existing financial tests are required.

Deferred EGO-110: export/delete/admin request queue, retention jobs, backup tombstone
replay, legal holds and full consent-dependent processing shutdown. EGO-74/75 still
need operator identity, processor/localization/cross-border verification, public
publication, age/re-consent/checkout UI and legal launch review. Receipt/refund/
payout implementations remain their own tasks. No production rollout, secrets,
cloud provisioning or privacy-compliance certification is performed by this PR.
