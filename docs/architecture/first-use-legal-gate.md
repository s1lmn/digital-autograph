# First-use legal gate — EGO-75

Draft implementation stacked on PR #46 (legal evidence) and #52 (public documents).
No real document is approved or published by this change. All real readiness flags
remain false. Do not deploy until legal approval and separate release validation:
new content and admission would otherwise be blocked.

## Requirements and evidence

First-use requires a separate explicit self-declaration of 18+ and acceptance of
the current published Terms and Content Rules. OAuth, document views, legacy
consent booleans, profile/share settings and notification preferences do not
satisfy these requirements. A declaration is not verified identity or passport age.
No date of birth, passport, IP or device information is collected here.

`age_declarations` stores one immutable record per account, DB-assigned time,
minimum age 18, source `web` and context `first_use`. Migration 0018 is forward-only;
0017 is unchanged. Legacy users receive no inferred declaration or acceptance.
Terms and Rules use separate streams of the existing append-only legal journal,
including version, exact content SHA-256 and predecessor. Stream locks serialize
concurrent retries across API replicas; repeated submissions return existing evidence.

`GET /legal/first-use` reads only the authenticated subject. It returns no document
identity or body when either current document is unavailable. `POST
/legal/first-use/age` requires the strict explicit `adultDeclared: true` body.
Existing `/legal/accept` compares displayed identity against server-owned current
identity and rejects stale versions/hashes with `LEGAL_DOCUMENT_CHANGED`. It cannot
record an unapproved or placeholder document. No endpoint grants personal-data consent.

The three writes are individually atomic and idempotent. Partial success is durable
but never sufficient: the composite gate reads all three requirements from PostgreSQL.
The UI re-reads state after a submit/failure and asks only for outstanding evidence.
An aborted connection may have committed evidence; retry safely reads/deduplicates it.

## Enforcement and preserved operations

Explicit `firstUse: true` route metadata adds a reusable pre-handler after existing
authentication, Origin and incident pre-handlers. Missing registry/repository fails
closed. No cookie, localStorage, query parameter or environment flag authorizes the gate.

Protected routes:

| Operation                                  | Route                                              |
| ------------------------------------------ | -------------------------------------------------- |
| Create autograph                           | POST `/autographs`                                 |
| Initiate private upload                    | POST `/autographs/:id/upload`                      |
| Complete upload / queue processing         | POST `/autographs/:id/upload/complete`             |
| Approve cleaned result / submit moderation | POST `/autographs/:id/approve`                     |
| Free Claim                                 | POST `/walls/:wallId/slots/:slotId/free-claim`     |
| New quote                                  | POST `/walls/:wallId/slots/:slotId/takeover-quote` |
| New reservation                            | POST `/takeover-reservations`                      |
| New Order                                  | POST `/payments/orders`                            |

Owner checks, CSRF/Origin rules, private storage and financial transaction invariants
remain in the underlying services. A previously issued private PUT URL retains its
existing short lifetime; uploading bytes alone cannot enqueue or approve content
without the guarded completion/approval operations.

Public Wall/legal reads, OAuth start/callback, account state/logout, legal reads and
acceptance/withdrawal remain available. No new gate is applied to owner-only existing
Order reads/refresh, reservation cancellation, provider webhooks, reconciliation,
background processing, or moderator decisions on existing content. These operations
honour prior obligations and existing authorization. Both EGO-149 incident switches
still independently deny new admission; recovery remains available.

## UI and edition changes

`/legal/first-use` is a Russian Destka screen with three separate, initially unchecked
choices, exact immutable edition links, decorative-signature warning, safe return
destinations and account/logout access. The same screen guards autograph creation
and the Free Claim confirmation without blocking public viewing. Unpublished
documents show an unavailable state with no acceptance controls or draft links.
No client authorization is persisted; every mount/reload/new tab reads backend state.
A stale submit clears choices and focuses the refreshed screen/error. A newly blocked
action offers re-consent in a new tab, preserving the original drawing/preview/Wall
selection for retry; the server checks fresh evidence again on that retry.

A newly approved current Terms/Rules edition requires acceptance before new guarded
actions. Older evidence and existing Order snapshots are never rewritten. Operator
and legal counsel decide legal materiality when approving an edition; this code does
not invent a significance heuristic. Declining never automatically deletes an account.

Privacy Policy is informational; optional purpose consents, 152-FZ article 10.1
dissemination, paid Offer checkout and marketing are separate flows. Profile publication
does not become authorized by Terms. Existing legal withdrawal remains accessible;
full export/deletion tooling is still an EGO-110 follow-up, not implemented here.

## Validation and release gates

PostgreSQL tests cover partial evidence, explicit age, concurrent retries, immutability,
stale/re-consent identity, legacy state, direct mutation bypass, subject isolation,
incident switches and real existing-payment recovery. Clean/pre-0017/pre-0018 upgrades
preserve previous records; migration image runs twice without TTY/runtime installation.
Browser tests use a separate test-only API composition with explicitly synthetic
published documents; the production entrypoint always loads the real registry.
The browser covers keyboard, 1440/1024/390/320, 200% text, stale response, retry,
reload/new tab and correct return navigation. No live OAuth/payment is performed.

Draft PR Policy may skip; SKIPPED is not PASS. Parent PRs must be independently
integrated, this branch synchronized/retested, and exact-head independent review
obtained before release. Publication additionally requires approved wording, requisites,
addresses, URLs and effective dates, readiness and separate release acceptance.
No checkout or dissemination work is started automatically.
