// Time Clock helpers.
//
// Round a captured instant to the nearest 5-minute "HH:MM" (24h) wall-clock
// string, in a given IANA timezone (or the device's local zone when omitted).
// This mirrors the 5-minute grid the timekeeping screen uses (timeOptions() in
// lib/store/timekeeping.ts steps m += 5), so kiosk-written times land on the
// same slots a crew leader would pick.
//
// Phase 1 renders in the device's local zone: the kiosk device is physically
// on-site, so its clock IS the job's local time. job_requests.timezone exists
// as the eventual source of truth (pass it as `timeZone`), but the device zone
// is correct and dependency-free for the common case.

export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}

/** Wall-clock hour/minute for `date` in `timeZone` (device local when falsy). */
function wallClockParts(date: Date, timeZone?: string): { hour: number; minute: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    ...(timeZone ? { timeZone } : {}),
  });
  let hour = 0;
  let minute = 0;
  for (const p of fmt.formatToParts(date)) {
    if (p.type === "hour") hour = Number(p.value);
    if (p.type === "minute") minute = Number(p.value);
  }
  // hour12:false can emit "24" for midnight in some engines — normalize.
  if (hour === 24) hour = 0;
  return { hour, minute };
}

/** Round a captured instant to the nearest 5 minutes; return "HH:MM" (24h). */
export function roundInstantToTimeString(date: Date, timeZone?: string): string {
  const { hour, minute } = wallClockParts(date, timeZone);
  let total = Math.round((hour * 60 + minute) / 5) * 5; // nearest 5-min
  total = ((total % 1440) + 1440) % 1440;               // wrap within the day
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Today's date as YYYY-MM-DD in the device's local zone. */
export function deviceLocalDate(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
