# Contributing

This repository uses **Linear as the source of work** and **GitHub pull requests as the source of code review**.

The default workflow is:

```text
Linear issue → fresh main → feature branch → implementation → self-review → PR → CI → peer review → merge → main CI → Linear Done
```

## 1. Pick a Linear issue

Start only from an issue that is `Todo` or explicitly assigned for work.

Before coding:

- read the issue, parent issue and Definition of Done;
- confirm its blockers are merged/closed;
- move it to `In Progress`;
- assign yourself;
- split the issue first if it cannot reasonably be reviewed as one PR.

Do not start dependent work from another unmerged feature branch unless the issue explicitly calls for a stacked PR.

## 2. Create the branch from fresh `main`

```bash
git checkout main
git pull --ff-only
git checkout -b ego-<NUMBER>-<short-slug>
```

Example:

```text
ego-130-photo-upload-ui
```

One Linear issue should normally map to one primary branch and one PR.

## 3. Read the invariants before changing code

Always review:

- `AGENTS.md`;
- the relevant files in `docs/architecture/`;
- adjacent domain/repository code;
- existing integration/concurrency tests.

Permanent rules include:

- PostgreSQL/backend is authoritative for ownership, eligibility, money and state;
- HTTP handlers must not become the business-logic or raw-SQL layer;
- one Slot has at most one active Placement;
- payment/webhook operations must be idempotent when that domain is introduced;
- ledger rows will be immutable;
- original autograph uploads are never public;
- security/privacy invariants are not weakened to simplify frontend work.

## 4. Keep scope narrow

Do not add unrelated refactors or features "while you are here".

If implementation reveals another substantial requirement, create/link another Linear issue rather than silently expanding the PR.

Concurrency-sensitive mutations require real PostgreSQL integration/race tests. Schema changes require migrations and clean-database verification.

## 5. Required local validation

Before opening a PR run:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
pnpm test:build-smoke
```

On Windows, `pnpm test` runs portable unit tests; Linux runs the full unit suite.
Use `pnpm test:portable` on either platform and `pnpm test:posix` on Linux to run
the scopes explicitly. POSIX-only tests must use `*.posix.test.ts`; preserve
portable assertions in ordinary test files when splitting a mixed fixture.
Do not classify a failing portable test as POSIX-only to hide a regression.
Windows unit success does not replace Linux deployment, integration or E2E
evidence. The `macos-integration-runner` job also verifies the launcher with the
default macOS TMPDIR and directory aliases; it does not certify the full macOS
application or deployment suite. CI must pass `checks`, `windows-unit`,
`windows-integration-runner`, `macos-integration-runner`, `e2e` and PR Policy
at the final head before merge.

If schema changed, also run:

```bash
pnpm db:generate
pnpm db:migrate
```

and verify migrations on a clean test database.

Before pushing, inspect:

```bash
git diff main...HEAD
```

Check for secrets, `.env`, debug logging, generated junk, scope creep, missing failure paths and missing authorization/concurrency coverage.

## 6. Open the PR

Use the repository PR template.

Every code PR must contain a Linear identifier such as `EGO-130` and must document:

- Summary;
- Scope / Non-goals;
- Invariants / Risks;
- Validation;
- DB/migration impact;
- reviewer checklist.

After the PR is open, move the Linear issue to `In Review`.

A message such as "done, tests pass" is not an acceptable PR description.

## 7. Review policy

The author does not count as the only reviewer of their own PR.

Merge only when:

- automated CI is green;
- PR Policy is green;
- at least one other developer approved the PR;
- blocking review threads are resolved;
- known blockers are resolved;
- branch is updated with `main` when required by repository rules.

Review order for risky PRs:

1. migrations/schema;
2. domain invariants;
3. repository/transactions/locking;
4. API authorization/contracts;
5. frontend behavior;
6. tests and failure/concurrency coverage.

For a mutation, reviewers should always ask:

- who may perform it?
- what happens on retry?
- what happens when two requests race?
- what happens on partial failure?
- what immutable evidence/history must remain?

For public/privacy code verify that User IDs, storage keys, private signed URLs, original uploads and secrets are not leaked.

Auth, migrations, concurrency, pricing, reservations, payments, takeover, ledger and security PRs should receive an additional independent review when practical.

## 8. After review changes

Push fixes to the same branch. Re-run affected checks.

Avoid force-pushing after review has started unless there is a strong reason, because it makes reviewed history harder to follow.

## 9. After merge

1. confirm CI on `main` is green;
2. delete the feature branch;
3. move the Linear issue to `Done`;
4. create dependent work only from refreshed `main`.

`Done` means merged/accepted and verified — not merely working locally.

## Linear statuses

- `Backlog` — not ready to pick now;
- `Todo` — dependencies closed and ready for development;
- `In Progress` — implementation is underway;
- `In Review` — PR is open, not yet finished;
- `Done` — merged/accepted and `main` remains green.

## Parallel work

Good parallel work touches independent boundaries, for example Pricing Engine and photo-upload UI.

Avoid two simultaneous PRs that both change the same payment state machine, Placement writer/locking protocol, migration chain, or other critical invariant.

If two tasks need the same unfinished API contract, make the dependency explicit rather than letting both branches invent it independently.
