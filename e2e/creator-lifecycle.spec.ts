import { e2eCreatorId, e2eUserId, expect, test } from './fixtures';

const apiUrl = process.env.API_PUBLIC_ORIGIN ?? 'http://127.0.0.1:4000';
const origin = process.env.E2E_WEB_URL ?? 'http://127.0.0.1:3000';

test('creator creates a draft, schedules, launches when due and ends their Wall', async ({
  page,
  scenario,
}) => {
  const owner = await scenario.actorContext(scenario.ownerId);
  const future = '2100-01-01T00:00:00.000Z';
  const created = await owner.request.post(
    `${apiUrl}/creators/${e2eCreatorId}/walls`,
    { headers: { Origin: origin }, data: { slotCount: 2, startAt: future } },
  );
  expect(created.status()).toBe(201);
  const wall = await created.json();
  expect(wall.status).toBe('draft');
  expect(wall.slots.map((slot: { position: number }) => slot.position)).toEqual(
    [0, 1],
  );
  expect((await page.request.get(`${apiUrl}/walls/${wall.id}`)).status()).toBe(
    404,
  );
  const other = await scenario.actorContext(e2eUserId);
  const transition = (action: string) =>
    owner.request.post(`${apiUrl}/walls/${wall.id}/transitions`, {
      headers: { Origin: origin },
      data: { action },
    });
  expect(
    (
      await other.request.post(`${apiUrl}/walls/${wall.id}/transitions`, {
        headers: { Origin: origin },
        data: { action: 'schedule' },
      })
    ).status(),
  ).toBe(403);
  const scheduled = await transition('schedule');
  expect(scheduled.status()).toBe(200);
  expect((await scheduled.json()).status).toBe('scheduled');
  await page.goto(`/walls/${wall.id}`);
  await expect(
    page.getByText('Wall status: scheduled', { exact: true }),
  ).toBeVisible();
  expect((await transition('publish')).status()).toBe(400);
  // Advance the isolated fixture's due boundary; never wait for wall-clock time.
  await scenario.database.pool.query(
    "UPDATE walls SET start_at = TIMESTAMPTZ '2000-01-01T00:00:00Z' WHERE id = $1 AND status = 'scheduled'",
    [wall.id],
  );
  const launched = await transition('publish');
  expect(launched.status()).toBe(200);
  expect((await launched.json()).status).toBe('live');
  await page.reload();
  await expect(
    page.getByText('Wall status: live', { exact: true }),
  ).toBeVisible();
  const ended = await transition('end');
  expect(ended.status()).toBe(200);
  expect((await ended.json()).status).toBe('ended');
  expect((await transition('publish')).status()).toBe(409);
  await page.reload();
  await expect(
    page.getByText('Wall status: ended', { exact: true }),
  ).toBeVisible();
  expect((await page.request.get(`${apiUrl}/walls/${wall.id}`)).status()).toBe(
    200,
  );
  const stored = await scenario.database.pool.query(
    'SELECT status, slot_count FROM walls WHERE id = $1',
    [wall.id],
  );
  expect(stored.rows[0]).toEqual({ status: 'ended', slot_count: 2 });
});
