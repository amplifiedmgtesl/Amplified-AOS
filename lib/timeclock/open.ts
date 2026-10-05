// How the rest of AOS reaches the Time Clock kiosk. The kiosk is its own
// full-screen page (no AOS sidebar) running under the signed-in user's
// session, so nobody needs to know its URL — Timekeeping and the crew-leader
// menu open it in a separate tab.

/** Roles allowed to run the kiosk. Everyone else never sees the button. */
export function canUseTimeclock(role: string | null | undefined): boolean {
  return role === "crew_leader" || role === "admin";
}

/** Kiosk URL, optionally opening straight onto one job. */
export function timeclockUrl(jobId?: string | null): string {
  return jobId ? `/timeclock?job=${encodeURIComponent(jobId)}` : "/timeclock";
}

/** Where "Exit" lands when the kiosk tab can't simply be closed. */
export function timeclockHome(role: string | null | undefined): string {
  return role === "crew_leader" ? "/lead/timekeeping" : "/timekeeping";
}

// Named target: a second click focuses/reuses the same kiosk tab instead of
// stacking new ones. Opened by script, so the kiosk's Exit can close it.
const TAB_NAME = "aos-timeclock";

export function openTimeclock(jobId?: string | null): void {
  window.open(timeclockUrl(jobId), TAB_NAME);
}
