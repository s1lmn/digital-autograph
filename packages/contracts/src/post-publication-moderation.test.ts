import { describe, expect, it } from 'vitest';
import {
  publicPlacementReportParams,
  publicPlacementReportBody,
  moderationCaseAppealParams,
  moderationCaseAppealBody,
} from './post-publication-moderation';

const key = '11111111-1111-4111-8111-111111111111';
const decision = '22222222-2222-4222-8222-222222222222';
const report = { operationKey: key, reasonCode: 'PERSONAL_DATA' };
const appeal = {
  operationKey: key,
  decisionId: decision,
  statement: 'Прошу пересмотреть решение.',
};

describe('future post-publication request boundaries', () => {
  it('accepts a minimal report and private literal text without interpreting markup', () => {
    expect(publicPlacementReportBody.parse(report)).toEqual(report);
    expect(
      publicPlacementReportBody.parse({
        ...report,
        comment: '  Здесь написано <script>\nПроверьте, пожалуйста.  ',
      }).comment,
    ).toBe('Здесь написано <script>\nПроверьте, пожалуйста.');
    expect(moderationCaseAppealBody.parse(appeal)).toEqual(appeal);
  });

  it.each([
    'reporterUserId',
    'userId',
    'autographId',
    'cleanedAssetId',
    'storageKey',
    'urgency',
    'severity',
    'hide',
    'action',
    'status',
    'policyVersion',
    'createdAt',
  ])('rejects client authority injection: %s', (field) => {
    expect(
      publicPlacementReportBody.safeParse({ ...report, [field]: 'spoofed' })
        .success,
    ).toBe(false);
    expect(
      moderationCaseAppealBody.safeParse({ ...appeal, [field]: 'spoofed' })
        .success,
    ).toBe(false);
  });

  it('requires explicit valid operation keys, known categories and decision references', () => {
    for (const operationKey of [undefined, '', 'not-a-uuid', 1]) {
      expect(
        publicPlacementReportBody.safeParse({ ...report, operationKey })
          .success,
      ).toBe(false);
      expect(
        moderationCaseAppealBody.safeParse({ ...appeal, operationKey }).success,
      ).toBe(false);
    }
    expect(
      publicPlacementReportBody.safeParse({
        ...report,
        reasonCode: 'AUTO_HIDE',
      }).success,
    ).toBe(false);
    expect(
      moderationCaseAppealBody.safeParse({ ...appeal, decisionId: undefined })
        .success,
    ).toBe(false);
    expect(
      moderationCaseAppealBody.safeParse({ ...appeal, decisionId: 'bad' })
        .success,
    ).toBe(false);
  });

  it.each([
    '',
    ' \n\t ',
    '\u0000',
    'a\u000bb',
    'a\u007fb',
    'a\u0085b',
    'a\u202eb',
    'a\u2066b',
    '\ud800',
    '\udfff',
  ])('rejects blank/control/malformed private statements', (statement) => {
    expect(
      publicPlacementReportBody.safeParse({ ...report, comment: statement })
        .success,
    ).toBe(false);
    expect(
      moderationCaseAppealBody.safeParse({ ...appeal, statement }).success,
    ).toBe(false);
  });

  it('allows multilingual plain text and emoji while enforcing both pre-trim and byte budgets', () => {
    for (const comment of [
      'Ж'.repeat(1000),
      'Я здесь 🙂\nSecond line\tاختبار',
      '字'.repeat(666),
    ])
      expect(
        publicPlacementReportBody.safeParse({ ...report, comment }).success,
      ).toBe(true);
    for (const comment of [
      'x'.repeat(1001),
      '字'.repeat(667),
      ' '.repeat(1001) + 'ok',
    ])
      expect(
        publicPlacementReportBody.safeParse({ ...report, comment }).success,
      ).toBe(false);
    expect(
      moderationCaseAppealBody.safeParse({
        ...appeal,
        statement: 'Ж'.repeat(2000),
      }).success,
    ).toBe(true);
    expect(
      moderationCaseAppealBody.safeParse({
        ...appeal,
        statement: '字'.repeat(1334),
      }).success,
    ).toBe(false);
    expect(
      moderationCaseAppealBody.safeParse({
        ...appeal,
        statement: 'x'.repeat(2001),
      }).success,
    ).toBe(false);
  });

  it('binds params to one explicit reference and rejects alternate target/identity fields', () => {
    expect(publicPlacementReportParams.parse({ placementId: key })).toEqual({
      placementId: key,
    });
    expect(moderationCaseAppealParams.parse({ caseId: key })).toEqual({
      caseId: key,
    });
    for (const params of [
      {},
      { placementId: 'not-a-uuid' },
      { placementId: key, userId: decision },
      { placementId: key, autographId: decision },
    ])
      expect(publicPlacementReportParams.safeParse(params).success).toBe(false);
    expect(
      moderationCaseAppealParams.safeParse({ caseId: key, owner: key }).success,
    ).toBe(false);
  });
});
