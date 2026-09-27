# Human autograph moderation

## Purpose and authority

A User first approves one exact private cleaned Asset. A platform moderator or admin then reviews that derivative for content suitability. Persistent `user_roles` is the only source for moderator authorization; authenticated ordinary Users, finance staff, and Creator owners have no moderation privilege from those facts alone. The moderation page is an operational tool. All three APIs enforce roles server-side.

`ready` means owner-approved exact cleaned Asset plus an approved human moderation decision. It means the Autograph can be considered for a future Placement workflow. It does not mean public, placed, identity verified, a genuine handwriting sample, legally signed, or resellable. `moderation_rejected` is final in this MVP; a User who wants another review creates a new Autograph. No appeal or re-review is implemented.

## Evidence and transaction

```text
Autograph → AutographUserApproval → approved cleaned Asset → AutographModerationDecision
```

The decision row stores the Autograph, moderator User, User approval, cleaned Asset, decision, optional stable rejection reason, and timestamp. Restrictive foreign keys, one decision per Autograph, non-null timestamp, decision/reason check, and an UPDATE/DELETE rejection trigger preserve audit evidence. The User approval and its cleaned Asset remain immutable under PR #10's triggers.

The decision operation checks the actor's persistent role and locks the Autograph. It requires `awaiting_moderation`, a matching owner approval, and the same uploaded cleaned Asset. It inserts evidence and updates the Autograph to `ready` or `moderation_rejected` in one transaction. An identical authorized retry returns the existing final result; an opposite decision gets `MODERATION_ALREADY_DECIDED`. Competing moderators serialize on the Autograph row. Owner reads verify final status, approval ID, and cleaned Asset ID against the decision and fail closed with `MODERATION_STATE_INCONSISTENT` when they disagree.

## Queue and private preview

`GET /moderation/autographs` lists pending submissions only, oldest owner approval first, then Autograph ID. `limit` is 1–50 (default 20); `cursor` is the last Autograph UUID. Each item contains only ID, source, approved time, and creation time. Social identities, email, original image, storage key, and signed URL are absent.

`GET /moderation/autographs/:id/preview` resolves the Asset through the immutable User approval, verifies its Autograph, role, and uploaded status, then returns a short-lived private read URL. The URL is a temporary credential, is returned with `Cache-Control: no-store`, is not logged or persisted in the browser, and is displayed with `referrerPolicy="no-referrer"`. The original remains private. Owner-only cleaned preview remains available after either final decision. No public Wall/Creator response exposes the image, including for `ready`.

## Initial content policy

Reject clearly disallowed content using one stable code: `SEXUAL_CONTENT`, `HATE_OR_EXTREMISM`, `THREATS_OR_VIOLENCE`, `PERSONAL_DATA`, `IMPERSONATION_OR_DECEPTIVE`, `ILLEGAL_OR_PROHIBITED`, `NOT_AN_AUTOGRAPH`, or `OTHER_POLICY_VIOLATION`. Approval has no reason code; rejection requires one. Moderators review content suitability only. Ambiguous legal classification, identity authentication, and handwriting authenticity are outside this workflow; escalate operationally rather than claiming verification. There are no freeform notes or automated moderation decisions.

## Deferred

Future Placement/public delivery must use `isAutographPlacementEligible(status)` together with ownership, live Wall, time, and eligibility checks. It must separately decide how a placed derivative is served publicly; the private bucket remains private here. Free Claim, pricing, payments, appeals, reassignment, and automated assistance are outside this PR.
