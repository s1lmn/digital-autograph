import { buildApi } from '../../apps/api/src/app';
import {
  createPgAgeDeclarationRepository,
  createPgLegalRepository,
  type Database,
} from '../../packages/db/src/index';
import type { SessionService } from '../../packages/auth/src/index';
import { syntheticLegalDocuments } from './legal-fixtures';
export const syntheticFirstUseDocuments = syntheticLegalDocuments.map((d) => ({
  ...d,
  path: `/legal/documents/${d.type}/${d.version}`,
  content: `synthetic legal fixture ${d.type}`,
}));
// Explicit setup for tests of other features. Production composition never uses this helper.
export async function acceptedSession(
  sessions: SessionService,
  db: Database,
  userId: string,
) {
  const legal = createPgLegalRepository(db.pool);
  await createPgAgeDeclarationRepository(db.pool).declareAdult(userId);
  for (const doc of syntheticFirstUseDocuments.filter((d) =>
    ['terms_of_use', 'community_guidelines'].includes(d.type),
  ))
    await legal.record(userId, doc, 'accepted', 'web', 'legal_gate');
  return sessions.createSession(userId);
}
export function buildAcceptedApi(...args: Parameters<typeof buildApi>) {
  args[2] = { ...args[2], firstUseEnforced: true };
  const db = args[0] as Database;
  const prior = args[17];
  args[17] = {
    ...prior,
    repository: prior?.repository ?? createPgLegalRepository(db.pool),
    ageDeclarations: createPgAgeDeclarationRepository(db.pool),
    documents: prior
      ? prior.documents.map((d) =>
          d.current && ['terms_of_use', 'community_guidelines'].includes(d.type)
            ? syntheticFirstUseDocuments.find((x) => x.type === d.type)!
            : d,
        )
      : syntheticFirstUseDocuments,
  };
  return buildApi(...args);
}
