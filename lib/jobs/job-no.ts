// Job-number naming convention helpers. The format is the user-facing
// identifier across job_requests, quotes, and invoices — see
// project_todo.md ("Display-code naming convention") for the full design.
//
// Format: AES_YYMMDDDD_CLI_EVENT[_SUFFIX][_REVN]
//   YYMMDD     = job start date
//   second DD  = end-date day, only when the job spans multiple calendar
//                days (overnight cross-midnight shifts are NOT multi-day)
//   CLI        = clients.code (3 chars)
//   EVENT      = job_requests.event_abbr (max 8 chars)

const MAX_EVENT_ABBR_LEN = 8;

/**
 * Derive a default event abbreviation from a free-form event name.
 * Strip everything that isn't alphanumeric, uppercase, truncate to 8.
 * The user can override this on the Job Request editor.
 */
export function defaultEventAbbr(eventName: string | undefined | null): string {
  return (eventName || "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase()
    .slice(0, MAX_EVENT_ABBR_LEN);
}

/**
 * Sanitize a user-entered event abbreviation. Same rule as the auto-derive.
 * Used by the editor on every keystroke so the stored value is always clean.
 */
export function sanitizeEventAbbr(input: string): string {
  return defaultEventAbbr(input);
}

/**
 * Build a job_no from the four components, or null if any required piece is
 * missing/invalid. Skips trailing DD when end date is missing or matches start.
 */
export function computeJobNo(opts: {
  startDate?: string;             // YYYY-MM-DD
  endDate?: string;               // YYYY-MM-DD or empty/null
  clientCode?: string | null;     // 3 chars
  eventAbbr?: string | null;      // ≤8 chars
}): string | null {
  const { startDate, endDate, clientCode, eventAbbr } = opts;
  if (!startDate || !clientCode || !eventAbbr) return null;
  const start = parseISODate(startDate);
  if (!start) return null;
  const yymmdd = `${two(start.year % 100)}${two(start.month)}${two(start.day)}`;
  let datePart = yymmdd;
  if (endDate && endDate !== startDate) {
    const end = parseISODate(endDate);
    // Only append the trailing DD when it's a different calendar day.
    if (end && !sameDay(start, end)) {
      datePart += two(end.day);
    }
  }
  return `AES_${datePart}_${clientCode}_${eventAbbr}`;
}

// ─── helpers ────────────────────────────────────────────────────────────────
type ParsedDate = { year: number; month: number; day: number };

function parseISODate(s: string): ParsedDate | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

function sameDay(a: ParsedDate, b: ParsedDate): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

function two(n: number): string {
  return String(n).padStart(2, "0");
}
