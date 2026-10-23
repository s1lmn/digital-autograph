# Privacy and consent foundation — EGO-74 / EGO-75 / EGO-110

This is backend evidence infrastructure, not completion of EGO-110. PostgreSQL
and the server registry authorize legal state; browser fields do not. No universal
privacy checkbox is introduced. Terms, content rules and the paid Offer are
contractual documents; Privacy Policy is information, not a consent event.

## Canonical documents and publication

The current seven legal types use the eight verified Destka DOCX transfer dated
2026-10-10 (seven legal documents and a separate vulnerability disclosure policy).
Original public DOCX and unchanged incoming manifests are preserved under
`docs/legal/sources/destka-20261010`. No private internal contract bundle is added.
The old nine-source `source-integrity.json`, original public `*-v1.md` files and
internal specifications remain historical source evidence, not current approved
operator policies. A separate `destka-source-integrity.json` records actual source
SHA-256, exact canonical byte SHA-256, paragraph/placeholder counts and conversion
changes. Run `python3 scripts/legal-canonical.py --check` to reproduce conversion
from the pinned DOCX. Python stdlib is used only offline/in CI, never in API runtime.

Serialization preserves literal wording and numbering, Word line breaks/tabs and
paragraph order, joins nonempty paragraphs with blank lines, and emits UTF-8
without BOM with final LF. Unsupported Word structures fail instead of silently
losing content. Markdown is a plain-text container, not permission to render raw
HTML. There are no substantive source-to-canonical changes and no URL replacements.
The supplied NOT_CANONICAL text extraction hashes are not runtime legal hashes.

The registry is `packages/config/src/legal-documents.json`. Each old `1.0` draft
identity is retained with `current: false`, unchanged file/hash and `ready: false`.
Each new Destka identity uses technical version `1.0-destka-20261010`; the source's
human revision remains 1.0. This technical identifier distinguishes source bytes,
not a legal effective date or publication approval. New versions must never replace
historical files/identities. Exactly one current entry for each of the seven legal
types is required, with unique type/version and bounded public-only file paths.
`loadLegalDocuments()` verifies exact UTF-8 bytes against registry hashes and
rejects ready documents with unfilled placeholders.

**Every registry entry remains `ready: false`, including sources without URL
placeholders.** There are 16 URL placeholders in four current Destka documents.
The publication notice explicitly withholds final publication approval. Public
`GET /legal/documents/:type/:version` returns the same no-store 404 for unknown,
unapproved or placeholder-containing versions, with no canonical text or draft
header. Authentication, request headers/query fields and historical identity do
not bypass this boundary. A future approved historical version remains readable
after a later version becomes current. Offline file inspection is the only draft
preview; no development HTTP bypass is introduced.

`docs/legal/security/vulnerability-disclosure-destka-20261010.md` is the eighth
canonical source. It is not a legal registry type, consent event or Order snapshot,
and has no enabled public route in this foundation. Its separate future security
page/security.txt require approved contacts/expiry and source drafting corrections.
The API image copies only legal public canonical files; internal specs, source DOCX
and security draft are not copied to API/Web runtime bundles. The private build and
migration stages still inherit repository source; they do not provide public HTTP.

See `docs/architecture/legal-url-contract.md` for proposed web current/version/archive
routes, the existing API boundary and all 16 URL replacement tasks. No proposed
URL is inserted into legal wording before its route exists and is tested. Caddy
still uses the existing deployment domains; no DNS/domain/deploy changes are made.

Acceptance/grant and new paid Order creation fail closed until publication is
independently approved and verified. There is no environment bypass. Existing
Orders can still be queried/reconciled/fulfilled without rewriting their snapshots.
The EGO-149 incident controls keep their independent server-only behavior: they
stop new admission while existing recovery/webhooks remain available. `buildApi`
keeps main's incidentControls argument before the appended legal dependency.
OAuth cleanup EGO-150 and existing financial concurrency guarantees are preserved.

Before marking any version ready: approve texts/metadata/versions and actual public
URLs through owner/legal review, verify working channels, implement user-facing
and server-side legal gates, and confirm operational processing promises. Source
availability, successful conversion and CI do not authorize publication/payments.

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

Dissemination grants are rejected both by the domain and PostgreSQL. This grant API does not enable
profile/username/avatar publication. Existing main share cards still support an
optional alias via their separate checkbox; that choice is not versioned legal
evidence and is not gated by this journal. Resolving the alias flow is a required
separate publication follow-up. A future separate Article
10.1 implementation must add restricted subject identity/contact evidence, item
selection, exact resources, restrictions/conditions publication and immediate
access revocation before enabling this grant. This PR collects none of that extra
identity data and cannot be used as a shortcut to public profile publication.
Moderation already rejects personal-data content; private original assets and
public cleaned-placement evidence checks are unchanged.

## HTTP contracts

- `GET /legal/documents/:type/:version`: approved canonical text only; draft/unknown
  return no-store 404, no internal documents. Published historical versions remain readable.
- `GET /legal/state/:type?purpose=…`: current session subject's latest event and
  current-version match; no-store, never another user's state.
- `POST /legal/accept { type, version, hash }`: session-only Terms/content rules.
  Displayed version/hash must exactly match the current trusted registry; stale
  display returns 409 `LEGAL_DOCUMENT_CHANGED` without recording evidence. They
  are preconditions, not client-authoritative values: the repository receives only
  the server document. Source/context remain `web`/`legal_gate`; strict input rejects
  user/scope/source overrides. Type-only silent current acceptance is rejected.
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
must use the current displayed identity preconditions already required by the
accept API and enforce actual action gates before production activation. Paid
checkout displayed identity/evidence still requires its own Order-linked flow.

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
checkbox has been confirmed. The supplied legal wording binds terms to the paid
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
need operator detail verification, processor/localization/cross-border review, public
publication, age/re-consent/checkout UI and legal launch review. Receipt/refund/
payout implementations remain their own tasks. No production rollout, secrets,
cloud provisioning or privacy-compliance certification is performed by this PR.
