// S15: deleting the user in Logto removes their Hub connections and consents (VA-08, webhook).
import postgres from 'postgres';
import { api } from '../../scripts/lib/logto.js';
import { test, expect } from './fixtures.js';
import { URLS, expectAudit } from './lib/stack.js';
import { allowConsent, appSignIn, connectOAuth, hubOpen } from './pages/hub.js';

test('S15: Logto user deletion purges Hub connections and consents', async ({ page, user }) => {
  await appSignIn(page, user);
  await hubOpen(page, user);
  const connectionId = await connectOAuth(page, user.id, { label: 'Doomed portal' });
  await page.goto(`${URLS.rp}/record?connectionId=${connectionId}`);
  await allowConsent(page, 'Sample RP');
  await page.waitForURL(`${URLS.rp}/connections`);

  const sql = postgres(process.env.HUB_DATABASE_URL, { max: 1 });
  try {
    const counts = async () => (await sql`
      select (select count(*) from connections where sub = ${user.id})::int as connections,
             (select count(*) from consent_grants where sub = ${user.id})::int as grants`)[0];
    expect(await counts()).toEqual({ connections: 1, grants: 1 });
    await api('DELETE', `/api/users/${user.id}`);
    await expect.poll(counts, { timeout: 15_000 }).toEqual({ connections: 0, grants: 0 });
    expectAudit({ event: 'user.deleted', sub: user.id });
  } finally {
    await sql.end();
  }
});
