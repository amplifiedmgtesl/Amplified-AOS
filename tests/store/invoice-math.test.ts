import { describe, it, expect } from "vitest";
import {
  sumLineTotals,
  computeAmountDue,
  computeDepositAmount,
  computeDepositCredit,
  computeBalanceDue,
  roundCents,
  DEFAULT_DEPOSIT_PCT,
} from "@/lib/store/invoice-math";

describe("roundCents", () => {
  it("rounds to two decimals", () => {
    expect(roundCents(10.005)).toBe(10.01);
    expect(roundCents(10.004)).toBe(10);
    expect(roundCents(0.1 + 0.2)).toBe(0.3);
  });
});

describe("sumLineTotals", () => {
  it("sums and rounds to cents", () => {
    expect(sumLineTotals([{ total: 100.005 }, { total: 50.001 }])).toBe(150.01);
  });

  it("treats null/undefined/NaN totals as zero", () => {
    expect(sumLineTotals([
      { total: 100 }, { total: null }, { total: undefined }, {} as any,
    ])).toBe(100);
  });

  it("is zero for an empty invoice", () => {
    expect(sumLineTotals([])).toBe(0);
  });

  it("does not accumulate float drift across many lines", () => {
    const lines = Array.from({ length: 10 }, () => ({ total: 0.1 }));
    expect(sumLineTotals(lines)).toBe(1);
  });
});

describe("computeDepositAmount", () => {
  it("defaults to 50% of the quote total", () => {
    expect(DEFAULT_DEPOSIT_PCT).toBe(50);
    expect(computeDepositAmount({ quoteTotal: 1000 })).toBe(500);
  });

  it("uses the quote's deposit_pct when set", () => {
    expect(computeDepositAmount({ quoteTotal: 1000, quoteDepositPct: 30 })).toBe(300);
  });

  it("lets an explicit amount win over the percentage", () => {
    expect(computeDepositAmount({
      quoteTotal: 1000, quoteDepositPct: 30, explicitAmount: 250,
    })).toBe(250);
  });

  it("honors an explicit zero rather than falling through to the default", () => {
    // The caller enforces "> 0" and throws; this must not silently become 500.
    expect(computeDepositAmount({ quoteTotal: 1000, explicitAmount: 0 })).toBe(0);
  });

  it("falls back to the default when deposit_pct is zero or null", () => {
    expect(computeDepositAmount({ quoteTotal: 1000, quoteDepositPct: 0 })).toBe(500);
    expect(computeDepositAmount({ quoteTotal: 1000, quoteDepositPct: null })).toBe(500);
  });

  it("rounds odd percentages to cents", () => {
    // 3333.33 * 0.335 = 1116.66555 -> 1116.67
    expect(computeDepositAmount({ quoteTotal: 3333.33, quoteDepositPct: 33.5 }))
      .toBe(1116.67);
  });

  it("is zero for a zero-total quote", () => {
    expect(computeDepositAmount({ quoteTotal: 0 })).toBe(0);
  });
});

describe("computeDepositCredit", () => {
  it("credits the deposit's billed subtotal, not what was paid", () => {
    // The deposit is unpaid (paid_amount irrelevant) but still credits in full:
    // customer owes 500 (deposit) + 500 (final) = 1000 total, not 1500.
    const r = computeDepositCredit({
      depositRows: [{ subtotal: 500 }],
      finalRows: [],
      subtotal: 1000,
    });
    expect(r.depositBilled).toBe(500);
    expect(r.depositApplied).toBe(500);
  });

  it("caps the credit at this invoice's subtotal", () => {
    // A 500 deposit against a 300 final applies only 300 — never negative due.
    const r = computeDepositCredit({
      depositRows: [{ subtotal: 500 }],
      finalRows: [],
      subtotal: 300,
    });
    expect(r.depositApplied).toBe(300);
  });

  it("subtracts credit already drawn by other active finals", () => {
    // Per-day finals: 500 deposit, 200 already applied -> 300 left.
    const r = computeDepositCredit({
      depositRows: [{ subtotal: 500 }],
      finalRows: [{ deposit_applied: 200 }],
      subtotal: 1000,
    });
    expect(r.alreadyApplied).toBe(200);
    expect(r.depositCreditAvailable).toBe(300);
    expect(r.depositApplied).toBe(300);
  });

  it("applies nothing once the credit pool is exhausted", () => {
    const r = computeDepositCredit({
      depositRows: [{ subtotal: 500 }],
      finalRows: [{ deposit_applied: 500 }],
      subtotal: 1000,
    });
    expect(r.depositCreditAvailable).toBe(0);
    expect(r.depositApplied).toBe(0);
  });

  it("never returns negative credit when finals over-applied", () => {
    const r = computeDepositCredit({
      depositRows: [{ subtotal: 500 }],
      finalRows: [{ deposit_applied: 700 }],
      subtotal: 1000,
    });
    expect(r.depositCreditAvailable).toBe(0);
    expect(r.depositApplied).toBe(0);
  });

  it("sums multiple deposit invoices for one job", () => {
    const r = computeDepositCredit({
      depositRows: [{ subtotal: 300 }, { subtotal: 200 }],
      finalRows: [],
      subtotal: 1000,
    });
    expect(r.depositBilled).toBe(500);
    expect(r.depositApplied).toBe(500);
  });

  it("applies nothing when there is no deposit", () => {
    const r = computeDepositCredit({
      depositRows: [], finalRows: [], subtotal: 1000,
    });
    expect(r.depositApplied).toBe(0);
  });

  it("treats null subtotals and deposit_applied as zero", () => {
    const r = computeDepositCredit({
      depositRows: [{ subtotal: null }],
      finalRows: [{ deposit_applied: null }],
      subtotal: 1000,
    });
    expect(r.depositApplied).toBe(0);
  });

  it("keeps deposit + final equal to the job total", () => {
    // The invariant the whole design exists to protect.
    const jobTotal = 1000;
    const deposit = 400;
    const { depositApplied } = computeDepositCredit({
      depositRows: [{ subtotal: deposit }],
      finalRows: [],
      subtotal: jobTotal,
    });
    expect(deposit + (jobTotal - depositApplied)).toBe(jobTotal);
  });
});

describe("computeAmountDue", () => {
  it("subtracts deposit and credits from the subtotal", () => {
    expect(computeAmountDue(1000, 400, 50)).toBe(550);
  });

  it("can go negative when over-credited", () => {
    // Not clamped: the caller decides how to surface an over-credit.
    expect(computeAmountDue(100, 400, 0)).toBe(-300);
  });

  it("rounds to cents", () => {
    expect(computeAmountDue(1000.005, 0, 0)).toBe(1000.01);
  });
});

describe("computeBalanceDue", () => {
  it("subtracts deposit, credits and payments", () => {
    expect(computeBalanceDue({
      subtotal: 1000, depositApplied: 400, creditsApplied: 50, paidAmount: 100,
    })).toBe(450);
  });

  it("treats missing fields as zero", () => {
    expect(computeBalanceDue({ subtotal: 1000 })).toBe(1000);
    expect(computeBalanceDue({})).toBe(0);
  });

  it("is zero for a fully paid invoice", () => {
    expect(computeBalanceDue({
      subtotal: 1000, depositApplied: 400, paidAmount: 600,
    })).toBe(0);
  });

  it("goes negative on an overpayment", () => {
    expect(computeBalanceDue({ subtotal: 1000, paidAmount: 1200 })).toBe(-200);
  });

  it("does not leave float dust on a paid-in-full invoice", () => {
    expect(computeBalanceDue({ subtotal: 0.3, paidAmount: 0.1 + 0.2 })).toBe(0);
  });
});
