import {
  notificationTitles,
  wallDeepLink,
  type NotificationKind,
} from '@digital-autograph/domain';
export * from './sharing';

export type Preferences = {
  web: boolean;
  telegram: boolean;
  mutedKinds: NotificationKind[];
  telegramLinked: boolean;
};
export type InboxItem = {
  id: string;
  kind: NotificationKind;
  wallId: string;
  slotId: string | null;
  detail: string | null;
  createdAt: Date;
  readAt: Date | null;
  contextId?: string;
};
export type SendResult = {
  state: 'sent' | 'retry' | 'uncertain' | 'failed';
  retryAfterSeconds?: number;
};
export interface TelegramSender {
  send(chatId: string, text: string): Promise<SendResult>;
}
export type Delivery = {
  id: string;
  token: string;
  chatId: string;
  kind: NotificationKind;
  wallId: string;
  slotId: string | null;
  detail: string | null;
  contextId?: string;
};
export class NotificationError extends Error {
  constructor(
    readonly code:
      'NOT_FOUND' | 'INVALID_REQUEST' | 'CHANNEL_NOT_LINKED' | 'RATE_LIMITED',
  ) {
    super(code);
  }
}
export interface NotificationRepository {
  preferences(userId: string): Promise<Preferences>;
  updatePreferences(
    userId: string,
    input: Omit<Preferences, 'telegramLinked'>,
  ): Promise<Preferences>;
  inbox(userId: string): Promise<InboxItem[]>;
  read(userId: string, id: string): Promise<void>;
  follow(userId: string, wallId: string, enabled: boolean): Promise<void>;
  issueLink(userId: string, hash: string): Promise<void>;
  acceptLink(hash: string, chatId: string): Promise<void>;
  disconnect(userId: string): Promise<void>;
  stopChat(chatId: string): Promise<void>;
  collect(): Promise<void>;
  claimDelivery(): Promise<Delivery | null>;
  finishDelivery(delivery: Delivery, result: SendResult): Promise<void>;
}
export class NotificationService {
  constructor(readonly repository: NotificationRepository) {}
  async inbox(userId: string) {
    return (await this.repository.inbox(userId)).map((item) => ({
      id: item.id,
      kind: item.kind,
      title: notificationTitles[item.kind],
      detail: item.detail,
      deepLink: item.contextId
        ? `/payments/return?orderId=${item.contextId}`
        : wallDeepLink(item.wallId, item.slotId),
      createdAt: item.createdAt,
      readAt: item.readAt,
    }));
  }
}
export async function notificationCycle(
  repository: NotificationRepository,
  sender?: TelegramSender,
  webOrigin?: string,
): Promise<void> {
  await repository.collect();
  if (!sender || !webOrigin) return;
  const delivery = await repository.claimDelivery();
  if (!delivery) return;
  // No SQL business lock is held during the external request. Unknown outcomes
  // are quarantined rather than resent: Bot API has no send idempotency key.
  let result: SendResult;
  try {
    result = await sender.send(
      delivery.chatId,
      `${notificationTitles[delivery.kind]}${delivery.detail ? `: ${delivery.detail}` : ''}\n${webOrigin}${delivery.contextId ? `/payments/return?orderId=${delivery.contextId}` : wallDeepLink(delivery.wallId, delivery.slotId)}\nManage notifications: ${webOrigin}/me/notifications`,
    );
  } catch {
    result = { state: 'uncertain' };
  }
  await repository.finishDelivery(delivery, result);
}
