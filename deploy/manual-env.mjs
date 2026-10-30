import console from 'node:console';
import { writeFileSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { privateFile, validateManifest } from './manual-deploy.mjs';
export function renderEnvironment(app, old, m) {
  let lines = [];
  if (app !== 'migration') {
    if (
      old
        .split('\n')
        .filter(Boolean)
        .some((line) => !/^\w+='[^\r\n]*'$/.test(line))
    )
      throw Error('Unsupported source env format');
    lines = old
      .split('\n')
      .filter(
        (line) =>
          line &&
          !/^(DATABASE_URL|DISABLE_NEW_PAYMENTS|PG[A-Z_]+|POSTGRES_[A-Z_]+|YC_[A-Z_]+|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN|WEB_ORIGIN|TRUSTED_WEB_ORIGINS|GOOGLE_REDIRECT_URI|TELEGRAM_REDIRECT_URI|PAYMENT_[A-Z0-9_]+|YOOKASSA_[A-Z0-9_]+)=/.test(
            line,
          ),
      );
  }
  if (app !== 'migration') lines.push(`WEB_ORIGIN='https://${m.domains.web}'`);
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
  return lines.join('\n') + '\n';
}
export function prepareEnvironments(
  m,
  {
    source = '/etc/digital-autograph/env',
    incoming = '/opt/digital-autograph/incoming',
    uid = 0,
  } = {},
) {
  validateManifest(m);
  const dir = path.join(incoming, m.operation, 'env');
  mkdirSync(dir, { mode: 0o700 });
  const evidence = path.join(dir, 'evidence');
  mkdirSync(evidence, { mode: 0o700 });
  for (const app of ['api', 'worker', 'migration']) {
    const old =
      app === 'migration'
        ? ''
        : privateFile(path.join(source, app + '.env'), uid).toString();
    if (app !== 'migration')
      writeFileSync(path.join(evidence, app + '.env'), old, {
        flag: 'wx',
        mode: 0o600,
      });
    writeFileSync(
      path.join(dir, app + '.env'),
      renderEnvironment(app, old, m),
      { flag: 'wx', mode: 0o600 },
    );
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    if (process.getuid?.() !== 0 || process.argv.length !== 3) throw Error();
    prepareEnvironments(JSON.parse(privateFile(process.argv[2])));
    console.log(
      'Separate private runtime/migration credentials prepared; original env retained as private evidence. Nothing applied to PostgreSQL.',
    );
  } catch {
    console.error(
      'Environment preparation refused; private files were not overwritten.',
    );
    process.exitCode = 1;
  }
}
