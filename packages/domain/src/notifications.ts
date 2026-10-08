export const notificationKinds = [
  'slot_claimed',
  'user_displaced',
  'cooldown_ended',
  'drop_starting',
  'drop_ending',
  'payment_status',
  'refund_status',
] as const;
export type NotificationKind = (typeof notificationKinds)[number];

export function wallDeepLink(wallId: string, slotId?: string | null): string {
  return `/walls/${wallId}${slotId ? `#slot-${slotId}` : ''}`;
}

export const notificationTitles: Record<NotificationKind, string> = {
  slot_claimed: 'Your autograph has a slot',
  user_displaced: 'Your autograph moved to history',
  cooldown_ended: 'Guaranteed visibility has ended',
  drop_starting: 'This Wall opens soon',
  drop_ending: 'This Wall ends soon',
  payment_status: 'Your payment status changed',
  refund_status: 'Your refund status changed',
};
