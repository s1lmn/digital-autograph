import {
  loadDatabaseConfig,
  loadPaymentConfig,
} from '@digital-autograph/config';
import {
  createDatabase,
  createPgPaymentRepository,
} from '@digital-autograph/db';
import { createYookassaProvider } from '@digital-autograph/integrations';
import { PaymentService } from '@digital-autograph/payments';
async function main() {
  const config = loadPaymentConfig();
  if (!config) throw new Error('Payment configuration required');
  const db = createDatabase(loadDatabaseConfig().DATABASE_URL);
  try {
    const service = new PaymentService(
      createPgPaymentRepository(db.pool),
      createYookassaProvider({
        shopId: config.YOOKASSA_SHOP_ID,
        secretKey: config.YOOKASSA_SECRET_KEY,
      }),
      {
        shopId: config.YOOKASSA_SHOP_ID,
        mode: config.PAYMENT_MODE,
        returnUrl: config.PAYMENT_RETURN_URL,
        creatorShareBps: config.PAYMENT_CREATOR_SHARE_BPS,
      },
      (signal) => console.warn(JSON.stringify(signal)),
    );
    console.info(JSON.stringify(await service.reconcile()));
  } finally {
    await db.close();
  }
}
void main().catch(() => {
  console.error('Payment reconciliation failed (details redacted)');
  process.exitCode = 1;
});
