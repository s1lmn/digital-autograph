# Post-publication moderation plan — EGO-162 / EGO-134

Status 2026-10-16: **proposed contracts and implementation plan only**. There is
no report endpoint/button, case persistence, visibility change, sanction, appeal
processor or moderation dashboard in this change. EGO-134 remains incomplete.
The current [pre-publication moderation gate](autograph-moderation.md) stays
authoritative. Neither this document nor a valid request approves UGC policy.

## Preconditions and phases

EGO-105 must resolve moderation actions, urgent/normal SLA, escalation, appeals,
creator conflicts and evidence retention in coordination with EGO-110 privacy.
Existing pre-publication reason codes can be reused as initial report categories;
they do not automatically imply removal, user sanction or a legal finding.
No report count/category may automatically authorize a visibility or money change.

PR #65 already owns the unmerged privacy migration chain 0017–0019. CONTRIBUTING
forbids competing work on the same migration chain. Before new case migrations,
accept/synchronize that work through normal review/merge/main-CI or explicitly
resolve its sequencing with the owner. Do not branch from its unmerged feature
tree, skip numbering/journal conflicts or weaken immutable finance/privacy guards.
This first phase is deliberately independent of those migrations and adds only
strict request shapes and negative-boundary tests.

Subsequent small PRs should cover: (1) persistent cases/report intake and dedup,
(2) audited visibility/actions and private appeals, (3) public report/owner/moderator
UI plus bounded moderation metrics. Split further if a coherent review becomes
too large. Each must start from fresh main after its contracts/blockers are
accepted, with real PostgreSQL authorization/race/integrity coverage and full CI.

## Proposed input contracts

`publicPlacementReportParams`: one UUID placementId already visible through a
public media reference. It is not an Autograph ID, owner identity or storage key.
`publicPlacementReportBody`: UUID operationKey, existing stable reasonCode and
optional private comment. `moderationCaseAppealParams`: UUID caseId.
`moderationCaseAppealBody`: UUID operationKey, exact decisionId and required private
statement. These are future shapes, not route registrations.

Strict objects reject extra fields, including reporter/owner IDs, urgency, case
state, visibility, action, timestamps and policy assertions. Actor identity comes
from the verified active session; permission comes from PostgreSQL. Target IDs
and operation keys never confer permission.

Proposed transport ceilings: report comment 1000 UTF-16 code units /2000 UTF-8
bytes; appeal statement 2000 code units /4000 bytes, checked before trimming.
Blank text, unpaired surrogates, non-whitespace control characters and explicit
bidi formatting/isolate controls are rejected. Ordinary Unicode, emoji, tab and
line breaks are allowed. HTML-like text is literal evidence, never executable
markup: every later renderer must escape it as text and must not use raw HTML.
These limits are technical proposals, not an approved evidence-retention policy.
Do not collect these statements until the privacy/process gates are implemented.

Canonical parsed input must define the retry fingerprint. Trimming is explicit;
do not hash one representation and persist another. HTTP body byte/rate limits
are still required separately; a Zod string budget is not a network admission limit.
Handlers must return fixed validation codes and avoid logging raw Zod errors or
private statements. Unicode/byte checks short-circuit oversized strings before
allocating an encoded copy.

## Server target resolution and public privacy

The future authenticated report path resolves the observed Placement to its
current public Wall and exact owner-approved/moderator-approved cleaned Asset,
using the same evidence rules as public delivery. A stale page must never report
the wrong object. An ended Wall is not automatically ineligible: if the exact
Placement/derivative is still publicly served, reporting must remain available.
In particular, do not report
the new occupant merely because a Slot number was reused. Lock/recheck target
and visibility inside the transaction. Return a non-enumerating unavailable
result for nonpublic/archived/ineligible/missing targets; do not expose whether
another User's private Autograph exists.

Resolve accepted exact idempotent retries through an actor-bound receipt before
new-admission checks, so later displacement/hiding does not turn a valid retry
into a new report or lose its receipt. A new report about an unavailable target
must not gain private access through that retry path. Return only an accepted
receipt scoped to this reporter; no case counts, other reporters, urgency,
moderator identity, private User/Autograph/Asset IDs or evidence URLs.

Do not copy original/cleaned image bytes into reports or accept an image/URL/key
from the reporter. Case evidence references immutable approved rows internally.
Private moderator preview uses the existing short-lived cleaned-only capability;
it must never expose the original or a storage key publicly.

## Persistence, deduplication and concurrent intake

Design separate append-only report evidence, case membership and actor-bound
operation receipts. Proposed aggregation unit: the exact Autograph/approved
derivative evidence, retaining each reported Placement context. Resolve with the
owner whether one incident spans multiple Walls; do not let SQL dedup silently
erase contexts or substitute one approved derivative for another.

Use database uniqueness/transactional conflict handling for a single active case
per accepted aggregation unit, one actor/operation key receipt and per-reporter
duplicate policy. Identical retries return the same receipt; reuse with different
canonical input conflicts. Distinct legitimate reports retain independent evidence
while joining the case atomically. A report flood cannot auto-hide an autograph.
Apply bounded, server-enforced admission limits and queue limits; do not trust
frontend eligibility or use in-process maps as global dedup/rate authority.

Define one lock order before implementation: stable case/content identity before
its evidence/visibility rows, followed consistently by any affected user lock.
Review cross-path ordering against Placement and payment writers. Reporting must
not acquire payment mutation locks or create a second Placement writer.

## Visibility overlay and actions

Keep post-publication visibility separate from immutable initial owner approval
and moderator decision. Never rewrite the original approve/reject evidence or
set an arbitrary Autograph to ready to implement restore. A proposed visibility
overlay must be checked by every public media/read/share path and future placement
admission, while preserving authoritative occupancy and financial/history rows.

Moderation hiding/removal must not free a Slot, rewrite a fulfilled Order, delete
earning evidence, change pricing or automatically refund/retry payments. Define
the user-facing unavailable/media state and short existing cache expiry explicitly;
do not claim already cached public bytes are remotely erased.

Only a persistent moderator/admin role may triage or change content visibility.
Creator ownership, ordinary users, finance/support roles, report volume and a
client urgency flag provide no moderation authority. Check roles inside the
transaction on every new action; a revoked role must not mutate through a stale
browser. Exact retries return only actor-authorized evidence.

Every action needs actor, server timestamp, case, operation key, prior/new state,
exact decision/version and a reason/policy reference. Audit evidence is append-only;
state transitions and audit insert commit together. Require expected-version checks
for competing decisions. Dismiss, temporary hide, remove, restore and escalation
must have explicit transition rules. User warning/strike/suspend/ban require the
approved EGO-105 policy and separate user-role/action design; do not introduce
them as undocumented side effects of a content decision.

## Private appeals and safe restoration

Only the affected verified owner can submit an appeal against their exact
decision. Check ownership/eligibility server-side even for UUIDs. Reporter and
creator roles alone cannot appeal another person's case. Keep the appeal linked
to the original immutable decision and preserve subsequent re-review evidence;
do not edit the original decision or erase report context.

Define eligibility, deadlines, reviewer conflict-of-interest and repeat-appeal
rules in EGO-105/110. No duration, auto-approval or unlimited-repeat policy is
invented here. Deduplicate exact owner/operation retries; a concurrent new
decision/version must conflict rather than appeal an unintended decision.

Restoration rechecks current ownership, approved cleaned evidence, pre-publication
eligibility, privacy withdrawal/deletion and other active holds. A successful
appeal cannot override a different safety/privacy hold or restore a deleted
original. Re-review remains auditable and all public read models agree.

## Queue, metrics and downstream effects

Queue items expose only the minimum role-authorized case metadata; private
comments and reporter identity need separately reviewed access. Use stable
cursor ordering and bounded pages. Urgency/SLA are server-owned and require an
accepted clock/threshold policy, not client timestamps or report-count thresholds.
An inaccessible/deleted target retains restricted audit context according to
approved retention, never a public preview fallback.

Metrics are bounded aggregates: new reports/cases, decision/appeal outcomes,
turnaround and oldest pending age. Label only fixed status/category, not raw
comment, User/creator IDs, object keys, URLs or case IDs. Define denominators and
observation windows; restore-after-appeal is a signal, not proof of model accuracy.
Use transactional outbox facts for any later notification. Do not send inside
the decision transaction or automatically retry ambiguous Telegram outcomes.

## Required executable acceptance matrix for later phases

- Ordinary user/creator/support/finance cannot read queue/evidence or decide;
  role revocation and UUID guessing do not bypass authorization.
- Missing, archived, ended/displaced Placements, inconsistent and concurrently changed public
  targets do not leak private state or redirect a report to a new occupant.
- Identical concurrent report retries produce one receipt/evidence row; changed
  payload with reused key conflicts; distinct reporters aggregate without loss.
- Submit while hide/restore/displacement races: transaction leaves one coherent
  target/case/overlay/audit state; rollback on any failed audit insert.
- Public media, Wall, history/share and future admission all enforce the overlay;
  originals stay private, occupied Slot and immutable finance remain unchanged.
- Competing moderator actions require expected version, emit one action/audit and
  preserve prior decisions. Volume alone cannot hide; non-approved actions fail.
- Only owner can appeal; exact retry, changed decision, repeat/late appeal and
  revoked/deleted ownership follow approved rules; no false restore over holds.
- Queue cursor/limits/urgency/SLA, escaped literal comments and all empty/error
  states work at 320px/large text/keyboard; no sensitive data in logs or metrics.
- Existing pre-publication, privacy, payment concurrency/recovery and public-media
  tests remain green on the combined final main. Contract-only unit success does
  not satisfy any backend, UI, operational or policy acceptance above.
