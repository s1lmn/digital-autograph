import { z } from 'zod';

export const liveHealthResponse = z.object({ status: z.literal('ok') });
export const readyHealthResponse = z.object({ status: z.literal('ready') });

export * from './wall';
export * from './autograph';
export * from './moderation';
export * from './pricing';
export * from './reservation';
export * from './notifications';
