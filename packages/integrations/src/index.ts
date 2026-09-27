// The future S3-compatible adapter must keep originals private. This is only a
// boundary contract; bootstrap does not perform object-storage operations.
export interface PrivateObjectStorage {
  putPrivate(input: {
    key: string;
    body: Uint8Array;
    contentType: string;
  }): Promise<void>;
  readPrivate(key: string): Promise<Uint8Array | null>;
  removePrivate(key: string): Promise<void>;
}

export {
  createGoogleOidcClient,
  type GoogleOidcClient,
  type GoogleOidcConfig,
} from './google';
