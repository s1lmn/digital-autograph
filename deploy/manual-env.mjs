import console from 'node:console';
import { writeFileSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { privateFile, validateManifest } from './manual-deploy.mjs';
try {
  if (process.getuid?.() !== 0 || process.argv.length !== 3) throw Error();
  const m = JSON.parse(privateFile(process.argv[2]));
  validateManifest(m);
  if (
    !/^[a-z0-9-]{8,64}$/.test(m.operation) ||
    !/^[a-z][a-z0-9_]{2,62}$/.test(m.database)
  )
    throw Error();
  if (
    !m.domains ||
    Object.values(m.domains).some(
      (v) => typeof v !== 'string' || !/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(v),
    )
  )
    throw Error();
  const dir = path.join('/opt/digital-autograph/incoming', m.operation, 'env');
  mkdirSync(dir, { mode: 0o700 }); // Never overwrite an existing credential set.
  for (const app of ['api', 'worker', 'migration']) {
    let lines = [];
    if (app !== 'migration') {
      const old = privateFile(
        `/etc/digital-autograph/env/${app}.env`,
      ).toString();
      // Existing renderer uses exactly one quoted entry per line; no shell sourcing.
      if (
        old
          .split('\n')
          .filter(Boolean)
          .some((line) => !/^\w+='[^\r\n]*'$/.test(line))
      )
        throw Error();
      lines = old
        .split('\n')
        .filter(
          (line) =>
            line &&
            !/^(DATABASE_URL|DISABLE_NEW_PAYMENTS|PG[A-Z_]+|POSTGRES_[A-Z_]+|YC_[A-Z_]+|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN|WEB_ORIGIN|TRUSTED_WEB_ORIGINS|GOOGLE_REDIRECT_URI|TELEGRAM_REDIRECT_URI|YOOKASSA_[A-Z0-9_]+)=/.test(
              line,
            ),
        );
    }
    if (app !== 'migration')
      lines.push(`WEB_ORIGIN='https://${m.domains.web}'`);
    if (app === 'api')
      lines.push(
        `TRUSTED_WEB_ORIGINS='https://${m.domains.web}'`,
        `GOOGLE_REDIRECT_URI='https://${m.domains.api}/auth/google/callback'`,
        `TELEGRAM_REDIRECT_URI='https://${m.domains.api}/auth/telegram/callback'`,
      );
    if (app === 'api') {
      lines.push("DISABLE_NEW_PAYMENTS='true'");
      if (!lines.some((line) => line.startsWith('DISABLE_FREE_CLAIMS=')))
        lines.push("DISABLE_FREE_CLAIMS='false'");
    }
    const role = app === 'migration' ? 'migrator' : app;
    const password = randomBytes(32).toString('hex');
    lines.push(
      `DATABASE_URL='postgresql://da_${role}:${password}@postgres:5432/${m.database}?sslmode=disable'`,
    );
    writeFileSync(path.join(dir, app + '.env'), lines.join('\n') + '\n', {
      flag: 'wx',
      mode: 0o600,
    });
  }
  console.log(
    'Separate private runtime/migration credentials prepared; nothing applied to PostgreSQL.',
  );
} catch {
  console.error(
    'Environment preparation refused; private files were not overwritten.',
  );
  process.exitCode = 1;
}
