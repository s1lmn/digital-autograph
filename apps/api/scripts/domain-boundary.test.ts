import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint();
async function violations(
  source: string,
  filePath = 'packages/domain/src/boundary-fixture.ts',
) {
  const [result] = await eslint.lintText(source, { filePath });
  return result!.messages.filter(
    (message) => message.ruleId === 'architecture/domain-boundary',
  );
}

describe('domain architecture enforced by the actual lint configuration', () => {
  it.each([
    'import Next from "next";',
    'import type { NextRequest } from "next/server";',
    'export { fastify } from "fastify";',
    'export type { FastifyRequest } from "fastify/types/request";',
    'export * from "drizzle-orm/pg-core";',
    'import "drizzle-kit";',
    'import "@fastify/cors";',
    'import { S3Client } from "@aws-sdk/client-s3";',
    'import "google-auth-library";',
    'import "openid-client";',
    'import "@digital-autograph/db";',
    'import "@digital-autograph/integrations/private-s3";',
    'import "../../db/src/index";',
    'import "../../../apps/api/src/app";',
    'void import("fastify");',
    'void import(`@aws-sdk/client-s3`);',
    'type T = import("drizzle-orm").SQL;',
    'import sdk = require("@aws-sdk/client-s3");',
    'const sdk = require("@digital-autograph/integrations");',
  ])('rejects forbidden dependency: %s', async (source) => {
    expect(await violations(source)).toHaveLength(1);
  });

  it.each([
    'export { transitionWall } from "./wall";',
    'import type { PricingConfiguration } from "./pricing";',
    'import { describe } from "vitest";',
    'const note = "import next from next";',
    'import "next-independent-library";',
    'import "zod";',
  ])('preserves permitted code: %s', async (source) => {
    expect(await violations(source)).toEqual([]);
  });

  it.each(['apps/api/src/fixture.ts', 'packages/integrations/src/fixture.ts'])(
    'allows adapter/framework imports outside domain: %s',
    async (filePath) => {
      expect(
        await violations(
          'import "fastify"; import "@aws-sdk/client-s3";',
          filePath,
        ),
      ).toEqual([]);
    },
  );
});
