// Cross-document consistency checks: does the quote use the same rate card
// as the job? Does the invoice match the quote? Do day counts line up?

import type { CheckFn, Finding } from "../types";

function activeQuote(ctx: Parameters<CheckFn>[0]) {
  // Prefer issued/signed over drafts; ignore superseded (loadQuotes hides them).
  const nonDraft = ctx.quotes.filter((q) => !q.isDraft);
  if (nonDraft.length > 0) return nonDraft.sort((a, b) =>
    (b.issuedAt ?? "").localeCompare(a.issuedAt ?? "")
  )[0];
  return ctx.quotes[0] ?? null;
}

function activeInvoice(ctx: Parameters<CheckFn>[0]) {
  const nonDraft = ctx.invoices.filter((i) => !i.isDraft);
  if (nonDraft.length > 0) return nonDraft.sort((a, b) =>
    (b.issuedAt ?? "").localeCompare(a.issuedAt ?? "")
  )[0];
  return ctx.invoices[0] ?? null;
}

export const consistencyChecks: CheckFn[] = [
  // 1. Quote's rate card matches the job's effective rate card
  (ctx) => {
    const q = activeQuote(ctx);
    if (!q || !ctx.rateCard) return [];
    if (!q.rateCardProfileId) return [];
    if (q.rateCardProfileId === ctx.rateCard.id) return [];
    return [{
      id: "consistency.job_quote_rate_card_mismatch",
      severity: "warning",
      category: "consistency",
      title: "Job and quote reference different rate cards",
      detail: `Job's effective rate card is ${ctx.rateCard.name || ctx.rateCard.id}; quote was issued against ${q.rateCardProfileId}.`,
      downstream: "Quote was priced from a different sheet than the one currently effective. If you reseed it, totals will move.",
      fixHref: q.id ? `/quotes/${encodeURIComponent(q.id)}` : undefined,
      fixLabel: "Open quote",
    }];
  },

  // 2. Invoice's rate card matches its source quote's
  (ctx) => {
    const q = activeQuote(ctx);
    const inv = activeInvoice(ctx);
    if (!q || !inv) return [];
    if (!q.rateCardProfileId || !inv.rateCardProfileId) return [];
    if (q.rateCardProfileId === inv.rateCardProfileId) return [];
    return [{
      id: "consistency.quote_invoice_rate_card_mismatch",
      severity: "warning",
      category: "consistency",
      title: "Quote and invoice reference different rate cards",
      detail: `Quote uses ${q.rateCardProfileId}; invoice uses ${inv.rateCardProfileId}.`,
      downstream: "The invoice may bill at rates the customer never saw on the quote.",
      fixHref: inv.id ? `/invoices/${encodeURIComponent(inv.id)}` : undefined,
      fixLabel: "Open invoice",
    }];
  },

  // 3. Number of quote-billable days roughly matches the job's day count
  (ctx) => {
    const q = activeQuote(ctx);
    if (!q) return [];
    // Distinct quoteDate values across lines = days quoted
    const quotedDays = new Set<string>();
    for (const ln of q.lines) {
      if (ln.quoteDate) quotedDays.add(ln.quoteDate);
    }
    if (quotedDays.size === 0 || ctx.days.length === 0) return [];
    if (quotedDays.size === ctx.days.length) return [];
    return [{
      id: "consistency.day_count_mismatch",
      severity: "warning",
      category: "consistency",
      title: `Quote covers ${quotedDays.size} day${quotedDays.size === 1 ? "" : "s"} but the job has ${ctx.days.length}`,
      detail: "Quote line dates and job_request_days don't line up.",
      downstream: "Either the quote is missing a day (under-billed) or the job has a day that won't be staffed.",
      fixHref: q.id ? `/quotes/${encodeURIComponent(q.id)}` : undefined,
      fixLabel: "Open quote",
    }];
  },
];
