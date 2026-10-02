// Destructive fixtures are permitted only on dedicated loopback services.
export function isolatedE2EEnvironment() {
  const databaseUrl = process.env.DATABASE_URL;
  const endpoint = process.env.S3_ENDPOINT;
  const bucket = process.env.S3_BUCKET;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  if (process.env.APP_ENV !== 'test' || process.env.NODE_ENV === 'production') {
    throw new Error('E2E fixtures require a non-production test environment');
  }
  if (
    !databaseUrl ||
    !endpoint ||
    !bucket ||
    !accessKeyId ||
    !secretAccessKey
  ) {
    throw new Error('E2E database/storage configuration is incomplete');
  }
  const db = new URL(databaseUrl);
  const s3 = new URL(endpoint);
  const loopback = ['localhost', '127.0.0.1'];
  if (
    !['postgres:', 'postgresql:'].includes(db.protocol) ||
    db.pathname !== '/autograph_e2e' ||
    !loopback.includes(db.hostname) ||
    db.port !== '5434' ||
    bucket !== 'autographse2e' ||
    s3.protocol !== 'http:' ||
    !loopback.includes(s3.hostname) ||
    !['9000', '9002'].includes(s3.port)
  ) {
    throw new Error(
      'E2E fixtures may only reset local autograph_e2e / autographse2e',
    );
  }
  for (const key of ['E2E_WEB_URL', 'API_PUBLIC_ORIGIN', 'WEB_ORIGIN']) {
    const value = process.env[key];
    if (value) {
      const url = new URL(value);
      if (url.protocol !== 'http:' || !loopback.includes(url.hostname)) {
        throw new Error('E2E requests must remain on local test servers');
      }
    }
  }
  return {
    databaseUrl,
    storage: {
      endpoint,
      bucket,
      accessKeyId,
      secretAccessKey,
      region: process.env.S3_REGION ?? 'us-east-1',
    },
  };
}
