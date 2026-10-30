export function sha256(value: string | Uint8Array): string;
export function fileHash(file: string): string;
export function canonical(value: unknown): unknown;
export function fingerprint(value: unknown): string;
export function scram(password: string): string;
export const targets: string[];
export function validateManifest(value: unknown): unknown;
export function validateMetadataProof(
  value: unknown,
  instanceId: string,
  runtimeServiceAccountId: string,
  runtimeSecretIds: string[],
): void;
export function validateRuntime(model: unknown, manifest: unknown): string[];
export function privateFile(file: string, uid?: number): Buffer;
export function deploy(
  manifest: unknown,
  phase: string,
  options?: {
    root?: string;
    state?: string;
    ownerUid?: number;
    run?: (
      program: string,
      args: string[],
      options?: { input?: string; stdoutFile?: string; timeout?: number },
    ) => string;
    read?: (file: string) => Buffer;
    save?: (file: string, value: unknown) => void;
    wait?: (milliseconds: number) => unknown;
  },
): { stage: string };
