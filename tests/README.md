# Unit tests

```bash
npm test
```

`npm run test:watch` for watch mode. Runs in Node via Vitest — no jsdom, no
browser, no database.

## Scope

These tests cover the **pure calculation layer**: functions that take data in
and return numbers. That's deliberate. The money math is where a silent wrong
answer reaches a customer invoice, and it's the part that can be tested without
fixtures or mocks.

Currently covered:

| File | Covers |
|---|---|
| `rates/line-calc.test.ts` | `computeLineTotal`, `isDayModeLine` — the dollar amount on every quote and invoice line |
| `rates/ot-trigger.test.ts` | `computeDayHourSplit` and the trigger parsers |
| `rates/timesheet-group-pricing.test.ts` | `buildBillRateMap`, `priceTimesheetGroup` — timesheet group → invoice line, day-rate floor and overflow |
| `store/invoice-math.test.ts` | subtotals, deposit amount, deposit credit, amount due, balance due |

## What is deliberately NOT covered

- **React components.** Would need jsdom and would mostly assert on markup.
- **Supabase store functions.** Anything `async` in `lib/store/` talks to the
  database. Testing those means either mocking PostgREST (brittle, proves
  little) or a live test database (a bigger piece of work — not ruled out,
  just not this).
- **Data quality.** Missing specialties, unbilled approved days, $0 lines: the
  job-health checks in `lib/job-health/checks/` already guard those at runtime.
  Unit tests cover the arithmetic; those checks cover the inputs.

## Conventions

Tests pin **current behavior**, including behavior that is questionable. Where a
test documents something that may be wrong, the comment says so explicitly
rather than implying endorsement — see the hardcoded 15-hour DT boundary in
`ot-trigger.test.ts` and the derived day-rate floor in
`timesheet-group-pricing.test.ts`. If a rule genuinely changes, update the
expected numbers deliberately; a failing test here means the money moved.
