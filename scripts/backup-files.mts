import {
  S3Client,
  backupPrivateFiles,
  verifyPrivateFileBackup,
} from '../packages/integrations/src/file-backup';

try {
  const [mode, directory, bound] = process.argv.slice(2);
  if (!directory) throw Error('Directory required');
  if (mode === 'verify') {
    const proof = await verifyPrivateFileBackup(directory);
    console.log(
      JSON.stringify({
        manifestSha256: proof.manifestSha256,
        objects: proof.objects,
      }),
    );
  } else if (mode === 'snapshot') {
    const {
      S3_ENDPOINT,
      S3_REGION,
      S3_BUCKET,
      S3_ACCESS_KEY_ID,
      S3_SECRET_ACCESS_KEY,
    } = process.env;
    if (
      !S3_ENDPOINT ||
      !S3_BUCKET ||
      !S3_ACCESS_KEY_ID ||
      !S3_SECRET_ACCESS_KEY
    )
      throw Error('Explicit source configuration required');
    const client = new S3Client({
      endpoint: S3_ENDPOINT,
      region: S3_REGION ?? 'us-east-1',
      forcePathStyle: true,
      maxAttempts: 1,
      credentials: {
        accessKeyId: S3_ACCESS_KEY_ID,
        secretAccessKey: S3_SECRET_ACCESS_KEY,
      },
    });
    try {
      console.log(
        JSON.stringify(
          await backupPrivateFiles(
            client,
            S3_BUCKET,
            directory,
            Number(bound),
            S3_ENDPOINT,
          ),
        ),
      );
    } finally {
      client.destroy();
    }
  } else throw Error('Use snapshot or verify');
} catch {
  console.error(
    'Private file backup failed. Source was not changed; private diagnostics/partial backup retained.',
  );
  process.exitCode = 1;
}
