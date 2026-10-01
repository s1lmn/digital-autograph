import { afterEach, describe, expect, it, vi } from 'vitest';
import { autographApi } from './autograph-api';

afterEach(() => vi.unstubAllGlobals());

describe('browser autograph API', () => {
  it('uses session cookies for API calls and omits them from signed object uploads', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'a', source: 'photo', status: 'draft' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          method: 'PUT',
          url: 'http://127.0.0.1:9000/signed',
          headers: { 'Content-Type': 'image/jpeg', 'If-None-Match': '*' },
          expiresAt: 'later',
        }),
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
    await api.create('photo', signal);
    const signed = await api.initiateUpload('a', 3, 'image/jpeg', signal);
    await api.upload(signed, new Blob(['jpg'], { type: 'image/jpeg' }), signal);
    await api.approve('autograph-id', 'reviewed-asset-id', signal);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://127.0.0.1:4000/autographs',
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      credentials: 'include',
      method: 'POST',
      cache: 'no-store',
      body: JSON.stringify({ source: 'photo' }),
    });
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'http://127.0.0.1:4000/autographs/a/upload',
    );
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      credentials: 'include',
      method: 'POST',
      body: JSON.stringify({ contentType: 'image/jpeg', sizeBytes: 3 }),
    });
    expect(fetchMock.mock.calls[2]?.[0]).toBe('http://127.0.0.1:9000/signed');
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({
      credentials: 'omit',
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg', 'If-None-Match': '*' },
    });
    expect(fetchMock.mock.calls[3]?.[0]).toBe(
      'http://127.0.0.1:4000/autographs/autograph-id/approve',
    );
    expect(fetchMock.mock.calls[3]?.[1]).toMatchObject({
      credentials: 'include',
      method: 'POST',
      body: JSON.stringify({ reviewedAssetId: 'reviewed-asset-id' }),
    });
  });
});
