import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const script = new URL(
  '../../../scripts/payment-economics.mjs',
  import.meta.url,
);
const noVat = { mode: 'none', rateBps: 0, recoverableBps: 0 };
const charge = (amountMinor: number) => ({ amountMinor, vat: { ...noVat } });
function scenario() {
  // Synthetic arithmetic fixture, not any provider's tariff.
  return {
    currency: 'RUB',
    averagePaymentMinor: 10000,
    monthlyVolumes: [100, 1000],
    methods: [
      {
        name: 'card',
        shareBps: 7000,
        commissionBps: 300,
        fixedFeeMinor: 0,
        acquiringVat: { mode: 'added', rateBps: 2000, recoverableBps: 0 },
        refundRateBps: 1000,
        refundedAmountBps: 10000,
        acquiringFeeReturnedBps: 0,
        refundFee: charge(50),
      },
      {
        name: 'sbp',
        shareBps: 3000,
        commissionBps: 100,
        fixedFeeMinor: 0,
        acquiringVat: { ...noVat },
        refundRateBps: 0,
        refundedAmountBps: 10000,
        acquiringFeeReturnedBps: 0,
        refundFee: charge(0),
      },
    ],
    paymentReceiptFee: charge(20),
    refundReceiptFee: charge(10),
    monthlyCashRegisterFee: charge(1000),
  };
}

function run(input: unknown) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'ego99-economics-'));
  try {
    const file = path.join(directory, 'input.json');
    writeFileSync(file, JSON.stringify(input));
    return spawnSync(process.execPath, [fileURLToPath(script), file], {
      encoding: 'utf8',
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe('offline acquiring economics planning', () => {
  it('calculates hand-checked mixed methods, fee VAT, refunds and monthly fixed costs', () => {
    const result = run(scenario());
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({
      kind: 'offline-planning-estimate-not-profit',
      quotedBlendedCommissionPercent: 2.4,
      perPayment: {
        acquiringCashCostMinor: 282,
        acquiringEconomicCostMinor: 282,
        refundServiceEconomicCostMinor: 3.5,
        receiptEconomicCostMinor: 20.7,
        cashCostMinor: 306.2,
        economicCostMinor: 306.2,
        effectiveCostPercent: 3.062,
        netAfterFeesMinor: 9693.8,
        expectedRefundedPrincipalMinor: 700,
        retainedAfterFeesAndRefundsMinor: 8993.8,
      },
      monthly: [
        {
          volume: 100,
          economicCostMinor: 31620,
          costPerPaymentMinor: 316.2,
          effectiveCostPercent: 3.162,
          retainedAfterFeesAndRefundsMinor: 898380,
        },
        { volume: 1000, economicCostMinor: 307200, costPerPaymentMinor: 307.2 },
      ],
    });
  });

  it('separates recoverable VAT from cash outflow and does not add included VAT twice', () => {
    const input = scenario();
    input.methods[0].acquiringVat = {
      mode: 'included',
      rateBps: 2000,
      recoverableBps: 10000,
    };
    const output = JSON.parse(run(input).stdout);
    expect(output.perPayment.acquiringCashCostMinor).toBe(240);
    expect(output.perPayment.acquiringEconomicCostMinor).toBe(205);
    expect(output.perPayment.recoverableVatMinor).toBe(35);
    input.methods[0].acquiringVat = {
      mode: 'added',
      rateBps: 2000,
      recoverableBps: 5000,
    };
    const added = JSON.parse(run(input).stdout);
    expect(added.perPayment.acquiringCashCostMinor).toBe(282);
    expect(added.perPayment.acquiringEconomicCostMinor).toBe(261);
  });

  it('models partial principal refunds and independently returned acquiring fees', () => {
    const input = scenario();
    input.methods[0].refundedAmountBps = 5000;
    input.methods[0].acquiringFeeReturnedBps = 5000;
    const output = JSON.parse(run(input).stdout);
    expect(output.perPayment.expectedRefundedPrincipalMinor).toBe(350);
    expect(output.perPayment.acquiringCashCostMinor).toBe(269.4);
    expect(output.perPayment.refundServiceEconomicCostMinor).toBe(3.5);
  });

  it('includes fixed per-transaction fees and independent receipt/register VAT', () => {
    const input = scenario();
    input.methods[1].fixedFeeMinor = 50;
    input.paymentReceiptFee.vat = {
      mode: 'added',
      rateBps: 2000,
      recoverableBps: 0,
    };
    input.monthlyCashRegisterFee.vat = {
      mode: 'included',
      rateBps: 2500,
      recoverableBps: 10000,
    };
    const output = JSON.parse(run(input).stdout);
    expect(output.perPayment.acquiringCashCostMinor).toBe(297);
    expect(output.perPayment.receiptEconomicCostMinor).toBe(24.7);
    expect(output.monthly[0].economicCostMinor).toBe(33320);
    expect(output.monthly[0].cashCostMinor).toBe(33520);
  });

  it('accepts explicit verified zero costs; negative net is reported without clipping', () => {
    const input = scenario();
    input.methods = [input.methods[1]];
    input.methods[0].shareBps = 10000;
    input.methods[0].commissionBps = 0;
    input.paymentReceiptFee = charge(0);
    input.monthlyCashRegisterFee = charge(0);
    expect(JSON.parse(run(input).stdout).perPayment.economicCostMinor).toBe(0);
    input.methods[0].fixedFeeMinor = 20000;
    expect(JSON.parse(run(input).stdout).perPayment.netAfterFeesMinor).toBe(
      -10000,
    );
  });

  it.each([
    (input: ReturnType<typeof scenario>) => {
      input.methods[0].shareBps = 6999;
    },
    (input: ReturnType<typeof scenario>) => {
      input.methods[1].name = 'card';
    },
    (input: ReturnType<typeof scenario>) => {
      input.averagePaymentMinor = 0;
    },
    (input: ReturnType<typeof scenario>) => {
      input.averagePaymentMinor = 1.5;
    },
    (input: ReturnType<typeof scenario>) => {
      input.averagePaymentMinor = 1000000001;
    },
    (input: ReturnType<typeof scenario>) => {
      input.methods[0].commissionBps = -1;
    },
    (input: ReturnType<typeof scenario>) => {
      input.methods[0].refundRateBps = 10001;
    },
    (input: ReturnType<typeof scenario>) => {
      input.methods[0].refundedAmountBps = 0;
    },
    (input: ReturnType<typeof scenario>) => {
      input.methods[0].acquiringVat.mode = 'unknown';
    },
    (input: ReturnType<typeof scenario>) => {
      input.methods[1].acquiringVat.rateBps = 2000;
    },
    (input: ReturnType<typeof scenario>) => {
      input.methods[0].acquiringVat.rateBps = 0;
    },
    (input: ReturnType<typeof scenario>) => {
      input.methods[0].acquiringVat.recoverableBps = 10001;
    },
    (input: ReturnType<typeof scenario>) => {
      input.monthlyVolumes = [0];
    },
    (input: ReturnType<typeof scenario>) => {
      input.monthlyVolumes = [100, 100];
    },
    (input: ReturnType<typeof scenario>) => {
      input.monthlyVolumes = [10000001];
    },
    (input: ReturnType<typeof scenario>) => {
      input.currency = 'USD';
    },
  ])(
    'rejects inconsistent/incomplete assumptions without a default tariff %#',
    (mutate) => {
      const input = scenario();
      mutate(input);
      const result = run(input);
      expect(result.status).toBe(1);
      expect(result.stdout).toBe('');
    },
  );

  it('rejects the unfilled template and typo/secret fields without echoing input', () => {
    const template = JSON.parse(
      readFileSync(
        new URL(
          '../../../docs/product/payment-economics.template.json',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    expect(run(template).status).toBe(1);
    const result = run({
      ...scenario(),
      secretKey: 'must-not-appear-in-output',
    });
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).not.toContain(
      'must-not-appear-in-output',
    );
    expect(run({ ...scenario(), averagePaymentMinor: null }).status).toBe(1);
    expect(run({ ...scenario(), methods: [] }).status).toBe(1);
  });
});
