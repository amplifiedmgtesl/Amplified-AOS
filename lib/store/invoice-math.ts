/**
 * lib/store/invoice-math.ts
 *
 * Pure invoice arithmetic, extracted from lib/store/invoices.ts so it can be
 * unit-tested without a database. Every function here takes plain data and
 * returns numbers — no Supabase, no I/O, no clock.
 *
 * The callers in invoices.ts do the querying and pass the rows in. Behavior is
 * unchanged from the inline versions these replaced; the rounding is
 * deliberately identical (round-half-up to cents at each documented step).
 */

/** Round to cents. Note this is JS `Math.round`, i.e. half-up on positives —
 *  matching what the inline invoice math has always done.
 *
 *  The `=== 0` guard normalizes negative zero to positive zero. A settled
 *  invoice whose subtraction lands a hair below zero otherwise yields -0.
 *  That's invisible under the app's current `.toFixed(2)` formatting (which
 *  renders "0.00"), but Intl.NumberFormat renders it "-$0.00". Normalizing
 *  here means no caller ever has to know that. */
export function roundCents(n: number): number {
  const r = Math.round(n * 100) / 100;
  return r === 0 ? 0 : r;
}

// ─── Subtotals ──────────────────────────────────────────────────────────────

/** Sum a set of line totals into a cents-rounded subtotal.
 *  Missing/null totals count as 0 — a line that failed to price must not
 *  poison the whole invoice with NaN. */
export function sumLineTotals(lines: Array<{ total?: number | null }>): number {
  return roundCents(lines.reduce((s, l) => s + (Number(l.total) || 0), 0));
}

/** Amount due on an invoice = subtotal − deposit applied − credits applied.
 *
 *  Not clamped at zero: a negative amount due is a real state (over-credited)
 *  and the caller decides how to surface it.
 *
 *  The two inline call sites this replaces rounded differently — the deposit
 *  path didn't round at all, the overwrite path used +toFixed(2). Both feed
 *  cent-valued operands, so half-up rounding here matches what each produced;
 *  it only normalizes float dust that was never user-visible. */
export function computeAmountDue(
  subtotal: number,
  depositApplied: number,
  creditsApplied: number,
): number {
  return roundCents(subtotal - (depositApplied || 0) - (creditsApplied || 0));
}

// ─── Deposit amount (deposit invoice creation) ───────────────────────────────

/** Default deposit fraction when neither the caller nor the quote specifies. */
export const DEFAULT_DEPOSIT_PCT = 50;

/** Deposit amount precedence:
 *    1. Explicit override from the caller (operator typed a value).
 *    2. The quote's stored deposit_pct, if > 0.
 *    3. DEFAULT_DEPOSIT_PCT of the quote total.
 *  All paths round to cents. Returns the amount; the caller enforces the
 *  "must be > 0" rule so it can throw with its own message. */
export function computeDepositAmount(input: {
  quoteTotal: number;
  explicitAmount?: number | null;
  quoteDepositPct?: number | null;
}): number {
  const quoteTotal = Number(input.quoteTotal) || 0;
  if (input.explicitAmount != null) {
    return roundCents(Number(input.explicitAmount));
  }
  const pct = input.quoteDepositPct == null ? null : Number(input.quoteDepositPct);
  if (pct != null && pct > 0) {
    return roundCents(quoteTotal * (pct / 100));
  }
  return roundCents(quoteTotal * (DEFAULT_DEPOSIT_PCT / 100));
}

// ─── Deposit credit (final invoice creation) ─────────────────────────────────

export type DepositCreditResult = {
  /** Total BILLED on active deposit invoices for the job. */
  depositBilled: number;
  /** Deposit credit already consumed by other active finals. */
  alreadyApplied: number;
  /** Credit still available to draw against. */
  depositCreditAvailable: number;
  /** Credit actually applied to THIS final — capped at its subtotal. */
  depositApplied: number;
};

/**
 * Compute how much deposit credit a new final invoice may draw.
 *
 * Credit is the deposit invoice's SUBTOTAL (the billed amount), not its
 * paid_amount. The deposit and the final are separate invoices for one
 * engagement; the customer owes (deposit) + (final − applied) = (job total)
 * regardless of when either is paid. Tying credit to paid_amount would
 * overstate the final's balance whenever the deposit is still outstanding,
 * double-counting the deposit invoice.
 *
 * Callers pass only ACTIVE rows (status not superseded/void) — the filtering
 * is a query concern and stays in invoices.ts.
 *
 * Both aggregates are clamped so that a partially-consumed or over-consumed
 * credit pool can never produce a negative application.
 */
export function computeDepositCredit(input: {
  /** Active deposit invoices for the job. */
  depositRows: Array<{ subtotal?: number | null }>;
  /** Active final invoices for the job, for credit already drawn. */
  finalRows: Array<{ deposit_applied?: number | null }>;
  /** Subtotal of the final being created. */
  subtotal: number;
}): DepositCreditResult {
  // NOTE: these sums are deliberately NOT rounded, matching the inline
  // version this replaced. Both operands come from stored cent-valued
  // columns, so rounding here would be a no-op in practice — but making it
  // an explicit no-op is a behavior change, and this extraction is meant to
  // be exactly equivalent. Revisit as a deliberate change if float dust ever
  // shows up in deposit_applied.
  const depositBilled = input.depositRows.reduce((s, r) => s + (Number(r.subtotal) || 0), 0);
  const alreadyApplied = input.finalRows.reduce((s, r) => s + (Number(r.deposit_applied) || 0), 0);
  const depositCreditAvailable = Math.max(0, depositBilled - alreadyApplied);
  const subtotal = Number(input.subtotal) || 0;
  const depositApplied = Math.min(depositCreditAvailable, subtotal);

  return { depositBilled, alreadyApplied, depositCreditAvailable, depositApplied };
}

// ─── Balance due ─────────────────────────────────────────────────────────────

/** Balance due = subtotal − deposit applied − credits applied − amount paid. */
export function computeBalanceDue(inv: {
  subtotal?: number | null;
  depositApplied?: number | null;
  creditsApplied?: number | null;
  paidAmount?: number | null;
}): number {
  return roundCents(
    (Number(inv.subtotal) || 0)
    - (Number(inv.depositApplied) || 0)
    - (Number(inv.creditsApplied) || 0)
    - (Number(inv.paidAmount) || 0),
  );
}
