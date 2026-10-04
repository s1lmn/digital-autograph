import { it, expect } from 'vitest';
import { loadNotificationTelegramConfig } from './index';
it('optional Telegram config fails closed and redacts invalid/partial credentials', () => {
  expect(loadNotificationTelegramConfig({})).toBeNull();
  expect(() =>
    loadNotificationTelegramConfig({
      NOTIFICATION_TELEGRAM_BOT_TOKEN: 'sensitive-invalid',
    }),
  ).toThrow('Invalid notification Telegram configuration (values redacted)');
  const config = {
    APP_ENV: 'test',
    WEB_ORIGIN: 'http://127.0.0.1:3000',
    NOTIFICATION_TELEGRAM_BOT_TOKEN: `123:${'a'.repeat(32)}`,
    NOTIFICATION_TELEGRAM_BOT_USERNAME: 'synthetic_bot',
    NOTIFICATION_TELEGRAM_WEBHOOK_SECRET: 'b'.repeat(32),
  };
  expect(loadNotificationTelegramConfig(config)).toEqual(config);
  expect(() =>
    loadNotificationTelegramConfig({ ...config, APP_ENV: 'staging' }),
  ).toThrow('Invalid notification Telegram configuration (values redacted)');
});
