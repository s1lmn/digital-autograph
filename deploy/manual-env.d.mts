export function renderEnvironment(
  app: string,
  old: string,
  manifest: { database: string; domains: { web: string; api: string } },
): string;
export function prepareEnvironments(
  manifest: unknown,
  options?: { source?: string; incoming?: string; uid?: number },
): void;
