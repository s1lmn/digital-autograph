import type { FastifyInstance } from 'fastify';
import type { Database } from '@digital-autograph/db';
import { z } from 'zod';
import { authenticatedSession, requireAuthenticatedUser } from './auth/http';

const profileBody = z.strictObject({
  displayName: z.string().trim().min(1).max(80),
  slug: z
    .string()
    .min(3)
    .max(64)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
});

export function registerAccountWorkspace(
  app: FastifyInstance,
  database: Database,
) {
  app.get(
    '/me/workspace',
    { preHandler: requireAuthenticatedUser },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const id = authenticatedSession(request).user.id;
      const profile = await database.pool.query(
        `SELECT c.id, p.slug, p.display_name AS "displayName" FROM creators c JOIN creator_profiles p ON p.creator_id=c.id WHERE c.owner_user_id=$1 ORDER BY c.created_at,c.id LIMIT 1`,
        [id],
      );
      const autographs = await database.pool.query(
        `SELECT id,source,status,created_at AS "createdAt" FROM autographs WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 50`,
        [id],
      );
      const walls = await database.pool.query(
        `SELECT w.id,w.status,w.slot_count AS "slotCount",w.created_at AS "createdAt" FROM walls w JOIN creators c ON c.id=w.creator_id WHERE c.owner_user_id=$1 ORDER BY w.created_at DESC,w.id DESC LIMIT 50`,
        [id],
      );
      const roles = await database.pool.query(
        `SELECT role FROM user_roles WHERE user_id=$1 AND role IN ('moderator','admin')`,
        [id],
      );
      return {
        profile: profile.rows[0] ?? null,
        autographs: autographs.rows,
        walls: walls.rows,
        canModerate: roles.rowCount! > 0,
      };
    },
  );
  app.put(
    '/me/profile',
    { preHandler: requireAuthenticatedUser },
    async (request, reply) => {
      const body = profileBody.safeParse(request.body);
      if (!body.success)
        return reply.code(400).send({ error: { code: 'INVALID_PROFILE' } });
      const id = authenticatedSession(request).user.id;
      const client = await database.pool.connect();
      try {
        await client.query('BEGIN');
        // Serialize first profile creation for this user, without claiming another creator.
        const active = await client.query(
          "SELECT id FROM users WHERE id=$1 AND status='active' FOR UPDATE",
          [id],
        );
        if (active.rowCount !== 1) {
          await client.query('ROLLBACK');
          return reply.code(403).send({ error: { code: 'FORBIDDEN' } });
        }
        const found = await client.query(
          'SELECT id FROM creators WHERE owner_user_id=$1 ORDER BY created_at,id LIMIT 1',
          [id],
        );
        const creator =
          found.rows[0] ??
          (
            await client.query(
              'INSERT INTO creators(owner_user_id) VALUES ($1) RETURNING id',
              [id],
            )
          ).rows[0];
        await client.query(
          `INSERT INTO creator_profiles(creator_id,slug,display_name) VALUES ($1,$2,$3) ON CONFLICT(creator_id) DO UPDATE SET slug=excluded.slug,display_name=excluded.display_name,updated_at=clock_timestamp()`,
          [creator.id, body.data.slug, body.data.displayName],
        );
        await client.query('COMMIT');
        return { id: creator.id, ...body.data };
      } catch (error) {
        await client.query('ROLLBACK');
        if (
          error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === '23505'
        )
          return reply.code(409).send({ error: { code: 'SLUG_TAKEN' } });
        throw error;
      } finally {
        client.release();
      }
    },
  );
}
