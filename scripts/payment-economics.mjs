import { readFileSync } from 'node:fs';
import process from 'node:process';

// Offline planning only. Never use floating-point estimates to authorize money.
function object(value, keys) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  ) {
    throw new Error('Invalid or missing input fields');
  }
}

function integer(value, maximum, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(
      'Inputs must be bounded integers; unknown terms cannot be zero-defaulted',
    );
  }
}

function vatPolicy(policy) {
  object(policy, ['mode', 'rateBps', 'recoverableBps']);
  if (!['none', 'included', 'added'].includes(policy.mode)) {
    throw new Error('VAT mode must be explicit');
  }
  integer(policy.rateBps, 10000);
  integer(policy.recoverableBps, 10000);
  if (
    (policy.mode === 'none' &&
      (policy.rateBps !== 0 || policy.recoverableBps !== 0)) ||
    (policy.mode !== 'none' && policy.rateBps === 0)
  ) {
    throw new Error('VAT policy is inconsistent');
  }
}

function validateFee(value) {
  object(value, ['amountMinor', 'vat']);
  integer(value.amountMinor, 1000000000);
  vatPolicy(value.vat);
}

function fee(quotedMinor, policy) {
  const rate = policy.rateBps / 10000;
  const vatMinor =
    policy.mode === 'added'
      ? quotedMinor * rate
      : policy.mode === 'included'
        ? (quotedMinor * rate) / (1 + rate)
        : 0;
  const cashMinor = quotedMinor + (policy.mode === 'added' ? vatMinor : 0);
  const recoverableVatMinor = (vatMinor * policy.recoverableBps) / 10000;
  return {
    cashMinor,
    economicMinor: cashMinor - recoverableVatMinor,
    recoverableVatMinor,
  };
}

function rounded(value) {
  return Number(value.toFixed(6));
}

function calculate(input) {
  object(input, [
    'currency',
    'averagePaymentMinor',
    'monthlyVolumes',
    'methods',
    'paymentReceiptFee',
    'refundReceiptFee',
    'monthlyCashRegisterFee',
  ]);
  if (input.currency !== 'RUB')
    throw new Error('Only RUB planning inputs are supported');
  integer(input.averagePaymentMinor, 1000000000, 1);
  if (
    !Array.isArray(input.monthlyVolumes) ||
    input.monthlyVolumes.length < 1 ||
    input.monthlyVolumes.length > 12 ||
    new Set(input.monthlyVolumes).size !== input.monthlyVolumes.length
  ) {
    throw new Error('Provide 1–12 distinct positive monthly volumes');
  }
  input.monthlyVolumes.forEach((volume) => integer(volume, 10000000, 1));
  if (
    !Array.isArray(input.methods) ||
    input.methods.length < 1 ||
    input.methods.length > 12
  ) {
    throw new Error('Provide 1–12 payment methods');
  }
  const names = new Set();
  for (const method of input.methods) {
    object(method, [
      'name',
      'shareBps',
      'commissionBps',
      'fixedFeeMinor',
      'acquiringVat',
      'refundRateBps',
      'refundedAmountBps',
      'acquiringFeeReturnedBps',
      'refundFee',
    ]);
    if (
      typeof method.name !== 'string' ||
      !/^[a-z][a-z0-9_-]{0,31}$/.test(method.name) ||
      names.has(method.name)
    ) {
      throw new Error('Method names must be unique short identifiers');
    }
    names.add(method.name);
    for (const key of [
      'shareBps',
      'commissionBps',
      'refundRateBps',
      'refundedAmountBps',
      'acquiringFeeReturnedBps',
    ]) {
      integer(method[key], 10000);
    }
    integer(method.fixedFeeMinor, 1000000000);
    vatPolicy(method.acquiringVat);
    validateFee(method.refundFee);
    if (method.refundRateBps > 0 && method.refundedAmountBps === 0) {
      throw new Error(
        'A refund scenario must specify a nonzero refunded amount',
      );
    }
  }
  if (
    input.methods.reduce((sum, method) => sum + method.shareBps, 0) !== 10000
  ) {
    throw new Error('Payment method shares must total exactly 10000 bps');
  }
  validateFee(input.paymentReceiptFee);
  validateFee(input.refundReceiptFee);
  validateFee(input.monthlyCashRegisterFee);

  let acquiringCash = 0;
  let acquiringEconomic = 0;
  let refundCash = 0;
  let refundEconomic = 0;
  let refundRate = 0;
  let principal = 0;
  let blendedCommissionBps = 0;
  for (const method of input.methods) {
    const share = method.shareBps / 10000;
    const probability = method.refundRateBps / 10000;
    const retainedFee =
      1 - (probability * method.acquiringFeeReturnedBps) / 10000;
    const acquiring = fee(
      (input.averagePaymentMinor * method.commissionBps) / 10000 +
        method.fixedFeeMinor,
      method.acquiringVat,
    );
    const refund = fee(method.refundFee.amountMinor, method.refundFee.vat);
    acquiringCash += share * retainedFee * acquiring.cashMinor;
    acquiringEconomic += share * retainedFee * acquiring.economicMinor;
    refundCash += share * probability * refund.cashMinor;
    refundEconomic += share * probability * refund.economicMinor;
    refundRate += share * probability;
    principal +=
      share *
      probability *
      input.averagePaymentMinor *
      (method.refundedAmountBps / 10000);
    blendedCommissionBps += share * method.commissionBps;
  }
  const receipt = fee(
    input.paymentReceiptFee.amountMinor,
    input.paymentReceiptFee.vat,
  );
  const refundReceipt = fee(
    input.refundReceiptFee.amountMinor,
    input.refundReceiptFee.vat,
  );
  const monthly = fee(
    input.monthlyCashRegisterFee.amountMinor,
    input.monthlyCashRegisterFee.vat,
  );
  const cash =
    acquiringCash +
    refundCash +
    receipt.cashMinor +
    refundRate * refundReceipt.cashMinor;
  const economic =
    acquiringEconomic +
    refundEconomic +
    receipt.economicMinor +
    refundRate * refundReceipt.economicMinor;
  return {
    kind: 'offline-planning-estimate-not-profit',
    currency: 'RUB',
    quotedBlendedCommissionPercent: rounded(blendedCommissionBps / 100),
    perPayment: {
      acquiringCashCostMinor: rounded(acquiringCash),
      acquiringEconomicCostMinor: rounded(acquiringEconomic),
      refundServiceEconomicCostMinor: rounded(refundEconomic),
      receiptEconomicCostMinor: rounded(
        receipt.economicMinor + refundRate * refundReceipt.economicMinor,
      ),
      cashCostMinor: rounded(cash),
      economicCostMinor: rounded(economic),
      recoverableVatMinor: rounded(cash - economic),
      effectiveCostPercent: rounded(
        (economic / input.averagePaymentMinor) * 100,
      ),
      netAfterFeesMinor: rounded(input.averagePaymentMinor - economic),
      expectedRefundedPrincipalMinor: rounded(principal),
      retainedAfterFeesAndRefundsMinor: rounded(
        input.averagePaymentMinor - principal - economic,
      ),
    },
    monthly: input.monthlyVolumes.map((volume) => ({
      volume,
      cashCostMinor: rounded(volume * cash + monthly.cashMinor),
      economicCostMinor: rounded(volume * economic + monthly.economicMinor),
      costPerPaymentMinor: rounded(economic + monthly.economicMinor / volume),
      effectiveCostPercent: rounded(
        ((economic + monthly.economicMinor / volume) /
          input.averagePaymentMinor) *
          100,
      ),
      netAfterFeesMinor: rounded(
        volume * (input.averagePaymentMinor - economic) - monthly.economicMinor,
      ),
      expectedRefundedPrincipalMinor: rounded(volume * principal),
      retainedAfterFeesAndRefundsMinor: rounded(
        volume * (input.averagePaymentMinor - principal - economic) -
          monthly.economicMinor,
      ),
    })),
  };
}

try {
  if (process.argv.length !== 3)
    throw new Error('Usage: node scripts/payment-economics.mjs INPUT.json');
  const input = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  process.stdout.write(`${JSON.stringify(calculate(input), null, 2)}\n`);
} catch {
  // Do not echo a malformed input document, filesystem contents or raw parser errors.
  process.stderr.write(
    'Invalid economics input: check the documented required fields, integer bounds, VAT policies and method shares. Usage: node scripts/payment-economics.mjs INPUT.json\n',
  );
  process.exitCode = 1;
}
