import { z } from 'zod';

export const createTakeoverReservationBody = z.strictObject({
  quoteId: z.uuid(),
});

export const takeoverReservationParams = z.strictObject({ id: z.uuid() });
export const emptyReservationBody = z.strictObject({});
