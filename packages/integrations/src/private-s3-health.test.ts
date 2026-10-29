import { afterEach, describe, expect, it, vi } from 'vitest';
import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { createPrivateS3Storage } from './private-s3';

const instances: ReturnType<typeof createPrivateS3Storage>[] = [];
function storage() {
  const result = createPrivateS3Storage({
    endpoint: 'http://127.0.0.1:1',
    bucket: 'private-health-test',
    region: 'us-east-1',
    accessKeyId: 'local_test_only',
    secretAccessKey: 'local_test_only',
  });
  instances.push(result);
  return result;
}
afterEach(() => {
  for (const instance of instances.splice(0)) instance.close();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('bounded read-only bucket health probe', () => {
  it('settles on caller cancellation even when SDK credentials or middleware ignore the signal', async () => {
    vi.useFakeTimers();
    vi.spyOn(S3Client.prototype, 'send').mockImplementation(
      () => new Promise(() => {}),
    );
    const caller = new AbortController();
    const reason = new DOMException('Synthetic cancellation', 'AbortError');
    let failure: unknown;
    void storage()
      .checkConnection(caller.signal)
      .catch((error: unknown) => {
        failure = error;
      });
    await vi.advanceTimersByTimeAsync(0);
    caller.abort(reason);
    await vi.advanceTimersByTimeAsync(0);
    expect(failure).toBe(reason);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('enforces the existing total storage-operation ceiling if the caller supplies no deadline', async () => {
    vi.useFakeTimers();
    const send = vi
      .spyOn(S3Client.prototype, 'send')
      .mockImplementation(() => new Promise(() => {}));
    let failure: unknown;
    void storage()
      .checkConnection(new AbortController().signal)
      .catch((error: unknown) => {
        failure = error;
      });
    await vi.advanceTimersByTimeAsync(9999);
    expect(failure).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(failure).toMatchObject({ name: 'TimeoutError' });
    expect(send.mock.calls[0]?.[1]).toMatchObject({
      abortSignal: { aborted: true },
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not start a probe when the caller has already cancelled', async () => {
    const send = vi
      .spyOn(S3Client.prototype, 'send')
      .mockResolvedValue(undefined);
    const caller = new AbortController();
    caller.abort();
    await expect(storage().checkConnection(caller.signal)).rejects.toBe(
      caller.signal.reason,
    );
    expect(send).not.toHaveBeenCalled();
  });

  it('sends only HeadBucket on success, without bucket creation or policy changes', async () => {
    const send = vi
      .spyOn(S3Client.prototype, 'send')
      .mockResolvedValue(undefined);
    await storage().checkConnection(new AbortController().signal);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(HeadBucketCommand);
    expect(send.mock.calls[0]?.[0].input).toEqual({
      Bucket: 'private-health-test',
    });
  });

  it('preserves an ordinary provider rejection for the collector to mark unavailable', async () => {
    const error = new Error('Synthetic provider failure');
    vi.spyOn(S3Client.prototype, 'send').mockRejectedValue(error);
    await expect(
      storage().checkConnection(new AbortController().signal),
    ).rejects.toBe(error);
  });
});
