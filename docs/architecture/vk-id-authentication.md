# VK ID authentication — Stage B2

## Status and boundary

Isolated, disabled-by-default Draft PR from main `6847339244f2a3fde89ef1f6b95965566f109668`. Related planning issues: [EGO-90](https://linear.app/egor-loshkarev/issue/EGO-90), [EGO-74](https://linear.app/egor-loshkarev/issue/EGO-74), [EGO-109](https://linear.app/egor-loshkarev/issue/EGO-109). This implementation is not legal approval or permission to enable authentication. No real provider app, credentials, user login, cloud-secret update or deployment was used.

Read before implementation: the four local Stage A audit/integration-plan/legal-matrix/test-plan documents, existing Google/Telegram/auth/session code and Draft [#55](https://github.com/s1lmn/digital-autograph/pull/55), exact head `bc154662142b56ef0d7ea2dad2b9f5c5dee12974`. EGO-90's completed foundation does not include linking; EGO-74 and EGO-109 remain Backlog. No Linear statuses or other PRs changed.

## Official contract, checked 11 October 2026

Primary sources:

- [OAuth 2.1 realization](https://id.vk.com/about/business/go/docs/ru/vkid/latest/vk-id/connection/realization).
- [API reference](https://id.vk.com/about/business/go/docs/ru/vkid/latest/vk-id/connection/api-description).
- [Scopes](https://id.vk.com/about/business/go/docs/ru/vkid/latest/vk-id/connection/work-with-user-info/scopes).
- [Application registration](https://id.vk.com/about/business/go/docs/ru/vkid/latest/vk-id/connection/create-application).
- Supporting official [SDK source](https://github.com/VKCOM/vkid-web-sdk/tree/8ff76cfe59ea72e370c4c6c3b40712ecfd43aadd), pinned snapshot; SDK is not installed or loaded by Destka.

The docs portal was unavailable to the search reader but its official HTML/embedded documentation was successfully retrieved over HTTPS and inspected. The current API reference defines:

| Operation             | Contract used                                                                                                                                                                      |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authorization         | `https://id.vk.ru/authorize`, code flow, exact callback, random state, PKCE `S256`                                                                                                 |
| Callback              | GET query `code`, `state`, `device_id`; code lifetime ten minutes                                                                                                                  |
| Exchange              | POST `https://id.vk.ru/oauth2/auth`, form body containing code, verifier, state, device ID, registered redirect URI, client ID and **service_token** for confidential applications |
| Identity confirmation | POST `https://id.vk.ru/oauth2/user_info`, client ID and ephemeral access token in form body                                                                                        |
| Minimal scope         | `vkid.personal_info`; no optional email/phone or other scopes                                                                                                                      |

Use the API reference's uppercase `S256`; the inspected SDK spells its wire value lowercase `s256`. Real app acceptance must verify the documented flow; no undocumented compatibility workaround or legacy `oauth.vk.com` flow is included. `service_token` is a server credential from a confidential application's settings, not a legacy client secret. No assumed OIDC discovery/nonce or decoded ID token is used to authenticate.

The minimal provider scope can return name/avatar/birthday and other basic profile data. Those fields are discarded, not copied to users, identities, client responses or logs. The provider's baseline claim exposure still requires EGO-74 review; this is not a claim that only an ID crosses the network.

## Server gates and configuration

`VK_AUTH_ENABLED` and `VK_AUTH_APPROVED` both default to `false`. Both must be `true` and configuration complete. Credentials alone cannot enable routes. Missing approval, disabled configuration and availability errors fail closed. An approved but malformed configuration fails startup with a fixed redacted message.

Server-only names: `VK_CLIENT_ID`, `VK_SERVICE_TOKEN`, `VK_REDIRECT_URI`. Service credential must be stored only as a secret-manager value under a nonsensitive entry name. No frontend secret or `NEXT_PUBLIC` flag. No changes to Google/Telegram configuration.

Callback must be canonical `/auth/vk-id/callback` with no userinfo/query/fragment, on the configured API origin (same origin as the existing registered Google callback). Staging/production require HTTPS and the current web/API hostname relationship; HTTP is limited to loopback development/test. Start and callback validate exact Host including port. Callback scheme is trusted through the existing TLS ingress boundary; ingress must enforce HTTPS and must not forward an arbitrary public Host. Registration and proxy settings require independent review.

`/auth/providers` publishes only `vk_id: boolean`, with `no-store`. Disabled mode registers neither `/auth/vk-id/start` nor `/auth/vk-id/callback`. Static gates require a controlled restart/config reload. An outstanding callback reaching a disabled server is 404, not an alternate login. Existing sessions continue to use normal session policy; disable never deletes accounts or records.

## Attempts, cookies and identity

- Independent cryptographic state, browser binding and verifier; TTL 600 seconds. PostgreSQL stores hashes, never raw code/verifier/token/device ID.
- `claimOAuthPkce` verifies provider `vk_id`, state, browser binding, PKCE verifier and DB expiry, then atomically consumes before network exchange. The schema's existing nonce hash remains inert for this non-OIDC flow. Google's and Telegram's existing nonce checks remain intact.
- Verifier and binding are short-lived HttpOnly, SameSite=Lax, Path=/, host-only cookies; Secure staging/production; `__Host-` names in production. Callback clears both on every outcome, uses `no-store`/`no-referrer` and renders no scripts or content.
- Device ID is an untrusted auxiliary exchange parameter, bounded to 1024 visible ASCII characters and never treated as identity/proof or persisted. Duplicate code/state/error/device parameters, missing/oversized values and code+error ambiguity fail closed.
- Token response state must match the original random attempt state. Valid positive token expiry and Bearer token shape are required. Token user ID must equal authenticated user-info user ID. Missing/mismatched/error replies cannot create a user/session.
- Stable provider identity is canonical positive decimal text. Safe JSON integers may be converted; unsafe/fractional/negative numbers and malformed strings are rejected without rounding. No legacy ID mapping, callback ID trust, ID-token decoding, profile matching or implicit merge.
- `IdentityService` and the DB's unique identity/advisory-lock transaction preserve one owner. First login creates a user; repeat returns that user. Session creation rechecks active status. Existing authenticated callers cannot start or switch accounts through callback. No linking/unlinking, creator verification or privileged roles.
- Network calls use fixed HTTPS endpoints, rejected redirects, ten-second timeouts, bounded 64 KiB JSON and no automatic code retry. Access/refresh/ID tokens remain temporary in memory and are discarded; no token vault or refresh flow. Raw provider exceptions/bodies cannot escape the adapter.
- Wall return path uses existing local-path validation. Logout, CORS, exact Origin CSRF and PostgreSQL session behavior remain unchanged.

There is no schema migration or auth write to payments, ownership or legal evidence. OAuth does not accept Terms, declare age or grant creator rights. First-use gate in Draft #53 is not in current main: its future integration must retain user IDs and enforce its backend gate/evidence, with combined-base regression before activation. This PR does not import or modify that legal chain.

## Intersection with #55 and integration order

Both isolated PRs add `/auth/providers`, optional `buildApi` arguments, nonce-free OAuth PKCE claim, main startup wiring, anonymous auth buttons, error messages and config exports. Integrating both requires resolving those explicit overlaps: one availability endpoint with separate booleans, both optional providers without positional-argument collision, both button components and both error/config contracts. The shared claim addition must exist only once; never weaken Telegram nonce checks. No new umbrella refactor was made in either PR.

Keep legal PR order #46 → #52 → #53 → #54 unchanged. Review #55 and this Draft separately, then normal main synchronization/explicit conflict resolution in an independently approved integration step, and rerun both provider suites plus legal/payment regressions on the accepted combined head. Old-head approvals are not sufficient. Neither provider is enabled by the other provider's approval.

## Validation and Stage A limits

Automated contract tests use **only fake credentials/responses**, actual PostgreSQL attempts/identities/sessions and local browser redirect interception. No genuine VK user login or provider app acceptance is claimed. Browser tests block external requests except the fulfilled fake authorization redirect.

Covered: first/repeat/concurrent first login; duplicate/replayed callback (one exchange); wrong/missing state/binding/verifier; provider-side PKCE rejection; expiry; cancellation/code-error ambiguity; invalid/duplicate device ID; exchanged state mismatch; unconfirmed or conflicting provider identity; disabled/anonymized user; active-session preservation; cross-provider separation; DB uniqueness; disabled routes/outstanding callback; cookie cleanup; local return-path safety; captured Pino output redaction; default-hidden/prepared button and narrow/desktop layout.

Full existing Google/Telegram, payments, reservation/takeover concurrency, application integration and E2E suites remain required. Legal evidence fixtures from the still-unmerged legal chain cannot be honestly asserted against main; no legal files/writes changed. Explicit linking, unlinking, last-method/recovery, physical mobile OAuth, real provider error responses and ingress log review are deferred. Multi-replica perimeter limits and wider EGO-109 security review remain separate launch gates; no unbounded production per-client map is introduced.

Draft PR Policy **SKIPPED is not PASS and not an independent review gate**. Local metadata validation may check description structure only. Activation needs exact-head green CI, independent security review and separately approved real-provider/legal/operational acceptance.

## Owner actions — no credentials in correspondence

1. Use the [official VK ID application guide](https://id.vk.com/about/business/go/docs/ru/vkid/latest/vk-id/connection/create-application) and the VK ID developer dashboard. Register a Web **confidential** application belonging to the actual Destka operator; complete required verification/moderation and truthful domain/service details.
2. Proposed future staging trusted callback: `https://api.staging.destka.online/auth/vk-id/callback`. Register the exact URL and approved domains. Production API/callback host remains PENDING owner approval; do not infer it from the marketing domain.
3. Request only baseline `vkid.personal_info`; disable optional email/phone permissions and other unneeded access. Confirm resulting scopes/data with a test app.
4. Put the application ID and **service token** in approved secret-manager values with nonsensitive names. Share only references/configuration names, never values or screenshots containing credentials. No new cloud values are created by this PR.
5. Obtain independent legal assessment of applicable 149-FZ authorization, current provider ownership/control, PD purposes/recipients/localization/retention and operator terms. Russian branding and mock PASS are not compliance approval. Privacy/data inventory/Consent UX amendments are proposals for separate approval, not automatic edits.
6. After independent technical review and approved test-environment provisioning, run genuine first/repeat/denial/wrong-verifier/cookie/physical-mobile checks, ingress log audit and combined legal gates. Until all gates pass, leave both flags false; no automatic production activation.

## Integration-cycle readback — 15 October 2026

Both original OAuth branches were synchronized with main `0d791f5eebe22552fcd2a5994e945d1d22f79425` by ordinary merges. PR #56 then incorporates #55 in its existing branch to resolve the shared API/configuration/UI conflicts and validate both providers together. No force push or new PR is used. `buildApi` keeps Yandex and VK as separate optional arguments before its logger stream; all affected test harnesses use the combined signature. Exactly one `/auth/providers` endpoint returns independent `yandex` and `vk_id` booleans. Both provider login links and error contracts remain present. The nonce-free OAuth PKCE method exists once; Telegram's nonce-required method is unchanged.

New PostgreSQL regressions cover all four provider availability combinations, cross-provider callback rejection when both providers coexist, and distinct provider identities for the same external ID. Configuration regression proves approval for either provider cannot enable the other. Existing per-provider adapter, session, replay, concurrency and browser tests remain mandatory.

Contrary to the earlier planned legal integration, none of #46/#52/#53/#54 has been accepted into main. #53/#54 are closed without merge because the real unready registry would block existing new actions. OAuth must not record or infer age/consent, and does not import that unpublished stack. Its future accepted legal base still needs combined validation. All production activation limitations above remain in force; no real provider smoke or legal approval is claimed.
