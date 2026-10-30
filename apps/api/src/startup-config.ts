import type { LegalHttp } from './legal-http';
import { assertFirstUseActivation } from './first-use';
import {
  loadApiConfig,
  loadPaymentConfig,
  loadYandexAuthConfig,
  loadVkIdAuthConfig,
  loadNotificationTelegramApiConfig,
  loadLegalDocuments,
} from '@digital-autograph/config';

// The exact startup validation path, without DB/storage/network I/O.
export function loadApiStartupConfig(
  documents: LegalHttp['documents'] = loadLegalDocuments(),
  environment = process.env,
) {
  const config = loadApiConfig(environment);
  assertFirstUseActivation(config.FIRST_USE_ENFORCEMENT_ENABLED, documents);
  const paymentConfig = loadPaymentConfig(environment);
  const yandexConfig = loadYandexAuthConfig(environment);
  const vkIdConfig = loadVkIdAuthConfig(environment);
  const notificationTelegram = loadNotificationTelegramApiConfig(environment);
  const enableTestAuthSeam = environment.ENABLE_TEST_AUTH_SEAM === 'true';
  if (
    enableTestAuthSeam &&
    (config.APP_ENV !== 'test' || environment.NODE_ENV === 'production')
  )
    throw Error(
      'ENABLE_TEST_AUTH_SEAM is only permitted in a non-production test environment',
    );
  return {
    config,
    paymentConfig,
    yandexConfig,
    vkIdConfig,
    notificationTelegram,
    enableTestAuthSeam,
  };
}
