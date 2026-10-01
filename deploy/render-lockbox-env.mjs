import { chmod, mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';

const outputPath = process.argv[2];
if (!outputPath) {
  throw new Error('Usage: render-lockbox-env.mjs <output-path>');
}

let input = '';
for await (const chunk of process.stdin) {
  input += chunk;
}

const payload = JSON.parse(input);
if (!Array.isArray(payload.entries) || payload.entries.length === 0) {
  throw new Error('Lockbox payload must contain at least one entry');
}

let postgresEntries;
if (process.argv[3] === 'staging') {
  // Both API and worker must use the private staging service, never an external DB.
  try {
    const database = new URL(
      payload.entries.find((entry) => entry.key === 'DATABASE_URL')?.textValue,
    );
    const user = decodeURIComponent(database.username);
    const password = decodeURIComponent(database.password);
    const name = decodeURIComponent(database.pathname.slice(1));
    if (
      !['postgres:', 'postgresql:'].includes(database.protocol) ||
      database.hostname !== 'postgres' ||
      (database.port && database.port !== '5432') ||
      !user ||
      !password ||
      !name ||
      name.includes('/') ||
      [...database.searchParams.keys()].some((key) => key !== 'sslmode') ||
      (database.searchParams.has('sslmode') &&
        database.searchParams.get('sslmode') !== 'disable') ||
      [user, password, name].some((value) => /[\r\n]/.test(value))
    )
      throw new Error();
    postgresEntries = {
      POSTGRES_USER: user,
      POSTGRES_PASSWORD: password,
      POSTGRES_DB: name,
    };
  } catch {
    throw new Error(
      'Staging DATABASE_URL must use postgres:5432 with credentials and a database name, without external TLS options',
    );
  }
}

const keys = new Set();
const lines = payload.entries.map((entry) => {
  if (
    typeof entry.key !== 'string' ||
    !/^[A-Z][A-Z0-9_]*$/.test(entry.key) ||
    keys.has(entry.key) ||
    typeof entry.textValue !== 'string' ||
    /[\r\n]/.test(entry.textValue)
  ) {
    throw new Error('Lockbox payload contains an invalid environment entry');
  }
  keys.add(entry.key);
  return `${entry.key}='${entry.textValue.replaceAll("'", "\\'")}'`;
});

const directory = path.dirname(outputPath);
await mkdir(directory, { recursive: true, mode: 0o700 });
const temporaryPath = `${outputPath}.${process.pid}.tmp`;
await writeFile(temporaryPath, `${lines.join('\n')}\n`, { mode: 0o600 });
await chmod(temporaryPath, 0o600);
await rename(temporaryPath, outputPath);

if (process.argv[4]) {
  if (!postgresEntries)
    throw new Error('PostgreSQL environment output is staging only');
  const postgresLines = Object.entries(postgresEntries).map(
    ([key, value]) => `${key}='${value.replaceAll("'", "\\'")}'`,
  );
  const postgresPath = process.argv[4];
  const temporaryPostgresPath = `${postgresPath}.${process.pid}.tmp`;
  await writeFile(temporaryPostgresPath, `${postgresLines.join('\n')}\n`, {
    mode: 0o600,
  });
  await chmod(temporaryPostgresPath, 0o600);
  await rename(temporaryPostgresPath, postgresPath);
}
