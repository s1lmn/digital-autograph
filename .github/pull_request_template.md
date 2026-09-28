## Linear issue

EGO-XXX

## Summary

What changed and why?

## Scope

- 

## Non-goals

- 

## Invariants / risks

Describe the important correctness, authorization, privacy, concurrency, idempotency, financial or data-integrity invariants touched by this PR.

- 

## Database / migrations

- [ ] No schema change
- [ ] Schema changed and migration added
- [ ] Migration verified on an existing database
- [ ] Migration verified on a clean database

Notes:

## Validation

- [ ] `pnpm format:check`
- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm test:integration`
- [ ] `pnpm build`
- [ ] `pnpm test:build-smoke`
- [ ] Relevant concurrency/race tests added or not applicable
- [ ] Relevant privacy/security regression checked

Additional checks:

## Reviewer checklist

- [ ] Scope matches the Linear issue
- [ ] No unrelated refactor/scope creep
- [ ] Authorization/ownership is server-authoritative
- [ ] Retry/idempotency behavior is defined where relevant
- [ ] Concurrent requests are considered where relevant
- [ ] Partial-failure behavior is safe
- [ ] No secrets, private storage keys, original autograph assets or signed private URLs leak
- [ ] Tests cover failure paths, not only happy path
- [ ] Documentation updated when an invariant/architecture changed

## Follow-ups / deferred

- 
