export { createPrivateS3Storage, type PrivateS3Config } from './private-s3';

export {
  createGoogleOidcClient,
  type GoogleOidcClient,
  type GoogleOidcConfig,
} from './google';
export {
  createTelegramOidcClient,
  type TelegramOidcClient,
  type TelegramOidcConfig,
} from './telegram';
export { createYookassaProvider } from './yookassa';
export { createTelegramNotificationSender } from './telegram-notifications';
