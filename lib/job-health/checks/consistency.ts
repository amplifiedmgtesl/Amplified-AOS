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

  // 4. #105: the quote sells a day rate on a date the job day doesn't match.
  //    Payroll lets the quote line win for the roles it prices, then falls
  //    back to the day's Rate for everyone else — so a day-rate quote on an
  //    Hourly day pays the quoted roles a flat block and the rest by the clock
  //    (the Neon Nights split). A quoted date with no day at all makes the
  //    payroll run refuse to build.
  (ctx) => {
    const q = activeQuote(ctx);
    if (!q) return [];
    const quotedDayRateDates = new Set<string>();
    for (const ln of q.lines) {
      if (ln.rateMode === "day" && ln.quoteDate) quotedDayRateDates.add(ln.quoteDate.slice(0, 10));
    }
    const findings: Finding[] = [];
    const fixHref = `/job-requests/${encodeURIComponent(ctx.jobRequest.id)}?tab=daily`;
    for (const date of [...quotedDayRateDates].sort()) {
      const day = ctx.days.find((d) => d.eventDate === date);
      if (!day) {
        findings.push({
          id: `consistency.day_rate_quoted_no_day:${date}`,
          severity: "warning",
          category: "consistency",
          title: `Quote has a day rate on ${date} but the job has no day for it`,
          detail: "The quote prices this date as a day rate, and Daily Requirements has no day with that date.",
          downstream: "Payroll can't build a run that includes this date until the day exists with its Rate set to Day Rate.",
          fixHref,
          fixLabel: "Add the day on the Daily Requirements tab",
        });
      } else if (day.rateMode !== "day") {
        findings.push({
          id: `consistency.day_rate_quoted_day_hourly:${date}`,
          severity: "warning",
          category: "consistency",
          title: `Quote has a day rate on ${date} but the day is set to Hourly`,
          detail: "The quote prices this date as a day rate; the job day's Rate is Hourly.",
          downstream: "Roles on the quote get paid the day rate, but anyone working a role the quote doesn't list is paid by the clock.",
          fixHref,
          fixLabel: "Set Rate to Day Rate on the Daily Requirements tab",
        });
      }
    }
    return findings;
  },
];
