import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { URL } from 'node:url';

const bucketName = 'digital-autograph-staging-e6ic8eh2';
const origin = 'https://staging.destka.online';

function sameSet(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    [...actual].sort().join('\n') === [...expected].sort().join('\n')
  );
}

function repositoryRule() {
  // This is a constrained, staging-only document, not a general XML parser.
  // Reject extra elements, attributes, entities, and duplicate settings.
  const xml = readFileSync(
    new URL('./storage-cors.staging.xml', import.meta.url),
    'utf8',
  )
    .trim()
    .replace(/>\s+</g, '><');
  const inner = xml.match(
    /^<CORSConfiguration><CORSRule>(.*)<\/CORSRule><\/CORSConfiguration>$/,
  )?.[1];
  const tags = [
    ...(inner ?? '').matchAll(
      /<(AllowedOrigin|AllowedMethod|AllowedHeader|MaxAgeSeconds)>([^<]+)<\/\1>/g,
    ),
  ];
  const values = (name) =>
    tags.filter((tag) => tag[1] === name).map((tag) => tag[2]);
  if (
    !inner ||
    tags.map((tag) => tag[0]).join('') !== inner ||
    !sameSet(values('AllowedOrigin'), [origin]) ||
    !sameSet(values('AllowedMethod'), ['PUT', 'GET']) ||
    !sameSet(values('AllowedHeader'), ['Content-Type', 'If-None-Match']) ||
    !sameSet(values('MaxAgeSeconds'), ['300'])
  ) {
    throw new Error('Repository staging CORS configuration is invalid');
  }
  return {
    allowedOrigins: values('AllowedOrigin'),
    allowedMethods: values('AllowedMethod').map((method) => `METHOD_${method}`),
    allowedHeaders: values('AllowedHeader'),
    maxAgeSeconds: '300',
  };
}

function yc(args) {
  const result = spawnSync(process.env.YC_BIN ?? 'yc', args, {
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  // Never forward CLI output/errors: operator diagnostics may contain tokens.
  if (result.error || result.status !== 0) {
    throw new Error(`yc bucket ${args[2]} failed; CLI output suppressed`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error('yc returned invalid json-rest; output suppressed');
  }
}

function getBucket() {
  return yc([
    'storage',
    'bucket',
    'get',
    '--name',
    bucketName,
    '--full',
    '--format',
    'json-rest',
  ]);
}

function assertPrivate(bucket) {
  if (
    bucket.name !== bucketName ||
    ['read', 'list', 'configRead'].some(
      (flag) => bucket.anonymousAccessFlags?.[flag] !== false,
    ) ||
    (bucket.acl?.grants ?? []).some(
      (grant) => grant.grantType !== 'GRANT_TYPE_ACCOUNT',
    )
  ) {
    throw new Error('Staging bucket privacy check failed; no changes made');
  }
  let policy;
  try {
    policy =
      typeof bucket.policy === 'string'
        ? JSON.parse(bucket.policy)
        : bucket.policy;
  } catch {
    throw new Error('Staging bucket policy is invalid; output suppressed');
  }
  const statements = policy?.Statement ?? [];
  for (const statement of Array.isArray(statements)
    ? statements
    : [statements]) {
    if (statement.Effect !== 'Allow') continue;
    // Fail closed for public/group/federated principals. Existing staging
    // policy grants only a specific runtime CanonicalUser.
    const principal = statement.Principal;
    if (
      !principal ||
      Object.keys(principal).length !== 1 ||
      typeof principal.CanonicalUser !== 'string' ||
      !principal.CanonicalUser ||
      principal.CanonicalUser.includes('*')
    ) {
      throw new Error('Staging bucket policy is not private; no changes made');
    }
  }
}

function matches(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === 1 &&
    sameSet(actual[0].allowedOrigins, expected.allowedOrigins) &&
    sameSet(actual[0].allowedMethods, expected.allowedMethods) &&
    sameSet(
      actual[0].allowedHeaders?.map((header) => header.toLowerCase()),
      expected.allowedHeaders.map((header) => header.toLowerCase()),
    ) &&
    String(actual[0].maxAgeSeconds) === expected.maxAgeSeconds &&
    (actual[0].exposeHeaders ?? []).length === 0
  );
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable(value[key])]),
    );
  }
  return value;
}

function withoutCors(bucket) {
  return JSON.stringify(
    stable(
      Object.fromEntries(Object.entries(bucket).filter(([k]) => k !== 'cors')),
    ),
  );
}

function main() {
  const mode = process.argv[2];
  if (
    process.argv.length !== 3 ||
    !['validate', 'check', 'apply'].includes(mode)
  ) {
    throw new Error(
      'Usage: node deploy/staging-storage-cors.mjs validate|check|apply',
    );
  }
  const expected = repositoryRule();
  if (mode === 'validate') {
    process.stdout.write('Repository staging CORS: PASS\n');
    return;
  }
  const before = getBucket();
  assertPrivate(before);
  if (mode === 'apply' && !matches(before.cors, expected)) {
    // Verified against installed yc help and Yandex's bucket CORS guide:
    // https://yandex.cloud/en/docs/storage/operations/buckets/cors
    const flags = [
      `allowed-origins=[${expected.allowedOrigins.join(',')}]`,
      `allowed-methods=[${expected.allowedMethods.map((m) => m.toLowerCase().replaceAll('_', '-')).join(',')}]`,
      `allowed-headers=[${expected.allowedHeaders.join(',')}]`,
      `max-age-seconds=${expected.maxAgeSeconds}`,
    ].join(',');
    yc([
      'storage',
      'bucket',
      'update',
      '--name',
      bucketName,
      '--cors',
      flags,
      '--format',
      'json-rest',
    ]);
    const after = getBucket();
    assertPrivate(after);
    if (withoutCors(before) !== withoutCors(after)) {
      throw new Error(
        'Non-CORS bucket settings changed; operator review required',
      );
    }
    if (!matches(after.cors, expected)) {
      throw new Error(
        'Applied staging CORS does not match repository configuration',
      );
    }
    process.stdout.write(
      'Staging CORS applied and verified; other bucket settings unchanged\n',
    );
    return;
  }
  process.stdout.write(
    JSON.stringify(
      {
        bucket: bucketName,
        anonymousAccessFlags: before.anonymousAccessFlags,
        cors: before.cors ?? [],
        matches: matches(before.cors, expected),
      },
      null,
      2,
    ) + '\n',
  );
  if (!matches(before.cors, expected)) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  // Only deliberate safe diagnostics, never CLI payloads or stack traces.
  const message = error instanceof Error ? error.message : 'CORS check failed';
  process.stderr.write(message + '\n');
  process.exitCode = 1;
}
