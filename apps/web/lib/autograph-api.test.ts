import { afterEach, describe, expect, it, vi } from 'vitest';
import { autographApi } from './autograph-api';

afterEach(() => vi.unstubAllGlobals());

describe('browser autograph API', () => {
  it('uses session cookies for API calls and omits them from signed object uploads', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'a', status: 'draft' }),
      })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'awaiting_moderation',
          approvedAt: 'now',
        }),
      });
    vi.stubGlobal('fetch', fetchMock);
    const api = autographApi('http://127.0.0.1:4000');
    const signal = new AbortController().signal;
    await api.create(signal);
    await api.upload(
      {
        method: 'PUT',
        url: 'http://127.0.0.1:9000/signed',
        headers: { 'Content-Type': 'image/png', 'If-None-Match': '*' },
      },
      new Blob(['png']),
      signal,
    );
    await api.approve('autograph-id', 'reviewed-asset-id', signal);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://127.0.0.1:4000/autographs',
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      credentials: 'include',
      method: 'POST',
      cache: 'no-store',
    });
    expect(fetchMock.mock.calls[1]?.[0]).toBe('http://127.0.0.1:9000/signed');
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      credentials: 'omit',
      method: 'PUT',
      headers: { 'Content-Type': 'image/png', 'If-None-Match': '*' },
    });
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      'http://127.0.0.1:4000/autographs/autograph-id/approve',
    );
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({
      credentials: 'include',
      method: 'POST',
      body: JSON.stringify({ reviewedAssetId: 'reviewed-asset-id' }),
    });
  });
});
