import { it, expect } from 'vitest';
import {
  loadNotificationTelegramApiConfig,
  loadNotificationTelegramWorkerConfig,
} from './index';

const shared = { APP_ENV: 'test', WEB_ORIGIN: 'http://127.0.0.1:3000' };
const apiCredentials = {
  NOTIFICATION_TELEGRAM_BOT_USERNAME: 'synthetic_bot',
  NOTIFICATION_TELEGRAM_WEBHOOK_SECRET: 'b'.repeat(32),
};
const workerCredentials = {
  NOTIFICATION_TELEGRAM_BOT_TOKEN: `123:${'a'.repeat(32)}`,
};
const redacted =
  'Invalid notification Telegram configuration (values redacted)';

it('API enables linking/webhook without the worker bot token', () => {
  expect(
    loadNotificationTelegramApiConfig({ ...shared, ...apiCredentials }),
  ).toEqual({ ...shared, ...apiCredentials });
  expect(
    loadNotificationTelegramApiConfig({
      ...shared,
      ...apiCredentials,
      ...workerCredentials,
    }),
  ).toEqual({ ...shared, ...apiCredentials });
});
it('worker enables sending without the API webhook credentials', () => {
  expect(
    loadNotificationTelegramWorkerConfig({ ...shared, ...workerCredentials }),
  ).toEqual({ ...shared, ...workerCredentials });
  expect(
    loadNotificationTelegramWorkerConfig({
      ...shared,
      ...apiCredentials,
      ...workerCredentials,
    }),
  ).toEqual({ ...shared, ...workerCredentials });
});
it('unconfigured components remain disabled even with the other component credentials', () => {
  expect(loadNotificationTelegramApiConfig({})).toBeNull();
  expect(loadNotificationTelegramWorkerConfig({})).toBeNull();
  expect(
    loadNotificationTelegramApiConfig({ ...shared, ...workerCredentials }),
  ).toBeNull();
  expect(
    loadNotificationTelegramWorkerConfig({ ...shared, ...apiCredentials }),
  ).toBeNull();
});
it('partial and invalid component configuration fails startup without exposing credentials', () => {
  for (const config of [
    { ...shared, NOTIFICATION_TELEGRAM_BOT_USERNAME: 'synthetic_bot' },
    { ...shared, NOTIFICATION_TELEGRAM_WEBHOOK_SECRET: 'sensitive-invalid' },
    { ...apiCredentials },
  ])
    expect(() => loadNotificationTelegramApiConfig(config)).toThrow(redacted);
  for (const config of [
    { ...shared, NOTIFICATION_TELEGRAM_BOT_TOKEN: 'sensitive-invalid' },
    { ...workerCredentials },
  ])
    expect(() => loadNotificationTelegramWorkerConfig(config)).toThrow(
      redacted,
    );
});
it.each(['staging', 'production'])(
  'both components require an exact HTTPS WEB_ORIGIN in %s',
  (APP_ENV) => {
    for (const WEB_ORIGIN of [
      'http://127.0.0.1:3000',
      'https://example.test/path',
      'https://secret@example.test',
    ]) {
      expect(() =>
        loadNotificationTelegramApiConfig({
          ...shared,
          ...apiCredentials,
          APP_ENV,
          WEB_ORIGIN,
        }),
      ).toThrow(redacted);
      expect(() =>
        loadNotificationTelegramWorkerConfig({
          ...shared,
          ...workerCredentials,
          APP_ENV,
          WEB_ORIGIN,
        }),
      ).toThrow(redacted);
    }
    expect(
      loadNotificationTelegramApiConfig({
        ...shared,
        ...apiCredentials,
        APP_ENV,
        WEB_ORIGIN: 'https://example.test',
      }),
    ).not.toBeNull();
    expect(
      loadNotificationTelegramWorkerConfig({
        ...shared,
        ...workerCredentials,
        APP_ENV,
        WEB_ORIGIN: 'https://example.test',
      }),
    ).not.toBeNull();
  },
);
