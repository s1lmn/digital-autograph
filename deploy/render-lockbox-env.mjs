import { chmod, mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

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
