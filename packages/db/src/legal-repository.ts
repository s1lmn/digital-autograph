import { isDeepStrictEqual } from 'node:util';
import type { Pool } from 'pg';
import {
  LegalError,
  validateLegalAction,
  type LegalEvent,
  type LegalRepository,
} from '@digital-autograph/domain';

type Row = {
  id: string;
  user_id: string;
  document_type: LegalEvent['documentType'];
  document_version: string;
  document_hash: string;
  action: LegalEvent['action'];
  source: string;
  context: string;
  scope: LegalEvent['scope'];
  previous_event_id: string | null;
  occurred_at: Date;
};
const present = (r: Row): LegalEvent => ({
  id: r.id,
  userId: r.user_id,
  documentType: r.document_type,
  documentVersion: r.document_version,
  documentHash: r.document_hash,
  action: r.action,
  source: r.source,
  context: r.context,
  scope: r.scope,
  previousEventId: r.previous_event_id,
  occurredAt: r.occurred_at,
});
export function createPgLegalRepository(pool: Pool): LegalRepository {
  return {
    async latest(userId, type, purpose = 'contract') {
      const r = await pool.query<Row>(
        'SELECT * FROM legal_evidence_events WHERE user_id=$1::uuid AND document_type=$2 AND purpose=$3 ORDER BY sequence DESC LIMIT 1',
        [userId, type, purpose],
      );
      return r.rows[0] ? present(r.rows[0]) : null;
    },
    async record(userId, document, action, source, context, scope) {
      validateLegalAction(document.type, action, scope ?? null);
      if (action !== 'withdrawn' && (!document.ready || !document.current))
        throw new LegalError('LEGAL_DOCUMENT_UNAVAILABLE');
      const db = await pool.connect();
      try {
        await db.query('BEGIN');
        const purpose = scope?.purpose ?? 'contract';
        // Serialize the entire subject stream; also safe across API instances.
        await db.query(
          'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
          [`legal:${userId}:${document.type}:${purpose}`],
        );
        const user = await db.query(
          "SELECT id FROM users WHERE id=$1::uuid AND status='active' FOR SHARE",
          [userId],
        );
        if (!user.rowCount) throw new LegalError('LEGAL_USER_UNAVAILABLE');
        const result = await db.query<Row>(
          'SELECT * FROM legal_evidence_events WHERE user_id=$1::uuid AND document_type=$2 AND purpose=$3 ORDER BY sequence DESC LIMIT 1',
          [userId, document.type, purpose],
        );
        const prior = result.rows[0];
        let version = document.version,
          hash = document.hash,
          recordedScope = scope ?? null;
        if (action === 'withdrawn') {
          if (!prior || prior.action === 'withdrawn') {
            await db.query('COMMIT');
            return prior ? present(prior) : null;
          }
          // Revoke the actual grant, even when its document is no longer current/published.
          version = prior.document_version;
          hash = prior.document_hash;
          recordedScope = prior.scope;
        } else if (
          prior?.action === action &&
          prior.document_version === version &&
          prior.document_hash === hash &&
          isDeepStrictEqual(prior.scope, recordedScope)
        ) {
          await db.query('COMMIT');
          return present(prior);
        }
        const inserted = await db.query<Row>(
          `INSERT INTO legal_evidence_events (user_id,document_type,document_version,document_hash,action,source,context,purpose,scope,previous_event_id)
          VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::uuid) RETURNING *`,
          [
            userId,
            document.type,
            version,
            hash,
            action,
            source,
            context,
            purpose,
            recordedScope ? JSON.stringify(recordedScope) : null,
            prior?.id ?? null,
          ],
        );
        await db.query('COMMIT');
        return present(inserted.rows[0]!);
      } catch (e) {
        await db.query('ROLLBACK');
        throw e;
      } finally {
        db.release();
      }
    },
  };
}
