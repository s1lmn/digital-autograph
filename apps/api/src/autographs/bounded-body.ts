import type { Readable } from 'node:stream';
import {
  AutographError,
  maxOriginalBytes,
} from '@digital-autograph/autographs';

// Pause on rejection: the route closes the connection after delivering the error.
// Never spool to disk, forward chunks to S3, or trust Content-Length.
export function readOriginalBody(
  stream: Readable,
  expected: number,
  signal: AbortSignal,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const cleanup = () => {
      stream.off('data', data);
      stream.off('end', end);
      stream.off('error', fail);
      stream.off('close', closed);
      signal.removeEventListener('abort', aborted);
    };
    const fail = (error: unknown) => {
      stream.pause();
      cleanup();
      reject(error);
    };
    const aborted = () => fail(new AutographError('UPLOAD_TIMEOUT'));
    const closed = () => fail(new AutographError('INVALID_UPLOAD'));
    const data = (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxOriginalBytes)
        return fail(new AutographError('UPLOAD_TOO_LARGE'));
      // Allow mismatched bodies up to the hard ceiling so the error is stable.
      chunks.push(chunk);
    };
    const end = () => {
      cleanup();
      if (size !== expected)
        return reject(new AutographError('UPLOAD_METADATA_MISMATCH'));
      resolve(Buffer.concat(chunks, size));
    };
    stream.on('data', data);
    stream.once('end', end);
    stream.once('error', fail);
    stream.once('close', closed);
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) aborted();
  });
}
