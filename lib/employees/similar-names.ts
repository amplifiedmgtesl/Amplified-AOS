// Close matches for a typed name (2026-10-20).
//
// The employee search only finds what's typed, so a typo ("Shelby Bowmen"),
// a nickname ("Mike" for Michael) or first/last swapped finds nothing and
// "+ Create employee" makes a duplicate. When the search comes up empty, the
// picker shows these instead, using the same name rules as the Onboarding
// duplicate check (nicknames folded, a letter or two apart).

import { nameKey } from "@/lib/paychex/sync-plan";
import { similarName } from "@/lib/onboarding/plan";

const words = (s: string) => (s ?? "").trim().split(/\s+/).filter(Boolean);

/** Does this typed name look like this person? Needs first and last name. */
export function looksLike(typed: string, fullName: string): boolean {
  const w = words(typed);
  if (w.length < 2) return false;
  const swapped = `${w[w.length - 1]} ${w.slice(0, -1).join(" ")}`;
  return [typed, swapped].some((t) => {
    const k = nameKey(t);
    return (k.includes(" ") && k === nameKey(fullName)) || similarName(t, fullName);
  });
}

/** People whose name looks like what was typed, best first, at most `cap`. */
export function similarNames<T extends { fullName: string }>(typed: string, people: T[], cap = 5): T[] {
  if (words(typed).length < 2) return [];
  return people.filter((p) => looksLike(typed, p.fullName)).slice(0, cap);
}
