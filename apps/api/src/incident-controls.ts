import type { FastifyReply, FastifyRequest } from 'fastify';

export type IncidentControls = {
  disableNewPayments: boolean;
  disableFreeClaims: boolean;
};

// Capture the operator's startup setting; request data cannot override it.
// Existing payment recovery routes must never use this admission guard.
export function rejectDisabledOperation(
  disabled: boolean,
  code: 'NEW_PAYMENTS_DISABLED' | 'FREE_CLAIMS_DISABLED',
) {
  return async (_request: FastifyRequest, reply: FastifyReply) => {
    if (disabled) {
      return reply
        .header('Cache-Control', 'no-store')
        .code(503)
        .send({ error: { code } });
    }
  };
}
