# Domain dependency guard (EGO-157)

`pnpm lint` applies `architecture/domain-boundary` to source files under
`packages/domain/src`, including type imports and test files. This checks the
existing AGENTS.md rule; it introduces no new domain or product behavior.

The rule rejects direct imports/re-exports of Next.js, Fastify and its plugins,
Drizzle, the current AWS/Google/OIDC provider adapters, and the workspace DB and
integration packages. Literal dynamic imports, TypeScript import types/import
equals, CommonJS require, and relative paths into apps/DB/integrations are checked
as well. The same imports remain available to the API, worker and adapters.
Pure libraries and ordinary relative domain imports are allowed.

This is a source-level guard, not a dependency graph, module resolver or sandbox.
Computed module names, custom aliases, symlinks and transitive dependencies still
require review. Add new provider SDK namespaces when introducing their adapters;
do not broadly allow an SDK in domain to make lint pass. It does not inspect
package manifests or certify framework independence of arbitrary external code.

Regressions invoke the real ESLint config on allowed and forbidden source forms.
The existing lint CI step enforces the guard; no new dependency or workflow job
is required. EGO-109's broader security review remains separate.
