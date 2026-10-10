import { z } from 'zod';
const document = z.object({
  type: z.enum(['terms_of_use', 'community_guidelines']),
  version: z.string().regex(/^[a-zA-Z0-9._-]{1,64}$/),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  path: z.string(),
  accepted: z.boolean(),
});
export const firstUseStateSchema = z
  .object({
    available: z.boolean(),
    complete: z.boolean(),
    adultDeclared: z.boolean(),
    documents: z.array(document).max(2),
  })
  .superRefine((s, ctx) => {
    if (
      s.available &&
      (s.documents.length !== 2 ||
        new Set(s.documents.map((d) => d.type)).size !== 2 ||
        s.documents.some(
          (d) => d.path !== `/legal/documents/${d.type}/${d.version}`,
        ) ||
        s.complete !==
          (s.adultDeclared && s.documents.every((d) => d.accepted)))
    )
      ctx.addIssue({ code: 'custom', message: 'Invalid first-use state' });
    if (!s.available && (s.complete || s.documents.length))
      ctx.addIssue({ code: 'custom', message: 'Invalid unavailable state' });
  });
export type FirstUseState = z.infer<typeof firstUseStateSchema>;
