import { describe, it, expect } from "vitest";
import {
  buildApplicantRows,
  buildOnboardingRows,
  canSend,
  clearMatch,
  defaultKeep,
  duplicateReason,
  mergeConflicts,
  mergeOverrides,
  pairKey,
  paychexMatches,
  splitForPaychex,
  windowRange,
  type Activity,
  type MergeSide,
  type OnbEmployee,
} from "@/lib/onboarding/plan";
import type { PaychexWorker } from "@/lib/paychex/sync-plan";

const emp = (k: string, name: string, extra: Partial<OnbEmployee> = {}): OnbEmployee => ({
  employeeKey: k, name, email: "", phone: "", employmentType: "Contractor", payrollId: null,
  status: "Active", paychexWorkerId: null, paychexInvitedAt: null, ...extra,
});

const TODAY = "2026-10-20";

describe("windowRange", () => {
  it("is 30 days back to 30 days ahead", () => {
    expect(windowRange(TODAY)).toEqual({ from: "2026-09-20", to: "2026-11-19" });
  });
});

describe("buildOnboardingRows", () => {
  const all = [
    emp("a", "Ann New"),
    emp("b", "Bob Paid", { payrollId: 12 }),
    emp("c", "Cal Ahead"),
    emp("d", "Dee Old"),
    emp("e", "Eve Early"),
  ];
  const act: Activity[] = [
    { employeeKey: "a", date: "2026-10-10", kind: "time", jobName: "LBFT", hours: 8 },
    { employeeKey: "a", date: "2026-10-12", kind: "time", jobName: "LOUIS", hours: 4.5 },
    { employeeKey: "a", date: "2026-10-25", kind: "crew", jobName: "WARE", hours: 0 },
    { employeeKey: "b", date: "2026-10-12", kind: "time", jobName: "LBFT", hours: 8 },
    { employeeKey: "c", date: "2026-11-02", kind: "crew", jobName: "WARE", hours: 0 },
    { employeeKey: "e", date: "2026-09-28", kind: "time", jobName: "EARLY", hours: 6 },
    { employeeKey: "d", date: "2026-08-01", kind: "time", jobName: "OLD", hours: 8 },
  ];
  const rows = buildOnboardingRows(TODAY, all, act, new Set());

  it("lists only no-ID people active in the window", () => {
    expect(rows.map((r) => r.employeeKey)).toEqual(["e", "a", "c"]);
  });
  it("sums timesheet hours and finds last worked / next booked", () => {
    const a = rows[1];
    expect(a.hours).toBe(12.5);
    expect(a.firstWorked).toEqual({ date: "2026-10-10", jobName: "LBFT" });
    expect(a.lastWorked).toEqual({ date: "2026-10-12", jobName: "LOUIS" });
    expect(a.nextBooked).toEqual({ date: "2026-10-25", jobName: "WARE" });
  });
  it("oldest job date first; booked-only people at the bottom", () => {
    expect(rows[0].firstWorked?.date).toBe("2026-09-28");
    expect(rows[2].hours).toBe(0);
    expect(rows[2].lastWorked).toBeNull();
  });
});

describe("duplicateReason", () => {
  it("same email is strong", () => {
    expect(duplicateReason(emp("1", "Jon Smith", { email: "J@x.com" }), emp("2", "Totally Else", { email: "j@x.com " })))
      .toEqual({ reason: "Same email", strong: true });
  });
  it("same phone with compatible first name is strong", () => {
    expect(duplicateReason(emp("1", "Mike Lynch", { phone: "(502) 555-1212" }), emp("2", "Michael Lynch", { phone: "5025551212" }))?.strong)
      .toBe(true);
  });
  it("same phone, different first name is only possible", () => {
    expect(duplicateReason(emp("1", "Mary Lynch", { phone: "5025551212" }), emp("2", "Tom Lynch", { phone: "502-555-1212" })))
      .toEqual({ reason: "Same phone, different name", strong: false });
  });
  it("Chris / Christopher is the same name", () => {
    expect(duplicateReason(emp("1", "Chris Travis"), emp("2", "Christopher Travis"))?.reason).toBe("Same name");
  });
  it("a typo is possible", () => {
    expect(duplicateReason(emp("1", "Justin Alllen"), emp("2", "Justin Allen"))).toEqual({ reason: "Similar name", strong: false });
  });
  it("Jr/Sr differences are never strong", () => {
    expect(duplicateReason(emp("1", "David Strang"), emp("2", "David Strang Jr"))).toEqual({ reason: "Same name (Jr/Sr differs)", strong: false });
  });
  it("different people don't match", () => {
    expect(duplicateReason(emp("1", "Ann New"), emp("2", "Bob Paid"))).toBeNull();
  });
});

describe("not-the-same-person pairs", () => {
  it("are skipped", () => {
    const all = [emp("a", "Chris Travis"), emp("b", "Christopher Travis", { payrollId: 13 })];
    const act: Activity[] = [{ employeeKey: "a", date: TODAY, kind: "time", jobName: "X", hours: 1 }];
    expect(buildOnboardingRows(TODAY, all, act, new Set())[0].duplicates).toHaveLength(1);
    expect(buildOnboardingRows(TODAY, all, act, new Set([pairKey("b", "a")]))[0].duplicates).toHaveLength(0);
  });
});

describe("defaultKeep", () => {
  it("keeps the record with the Payroll ID", () => {
    expect(defaultKeep({ employeeKey: "a", payrollId: null, entries: 50 }, { employeeKey: "b", payrollId: 7, entries: 1 })).toBe("b");
  });
  it("otherwise keeps the one with more entries", () => {
    expect(defaultKeep({ employeeKey: "a", payrollId: null, entries: 2 }, { employeeKey: "b", payrollId: null, entries: 9 })).toBe("b");
  });
});

describe("canSend", () => {
  it("needs a valid email and no Payroll ID or earlier send", () => {
    expect(canSend({ email: "a@b.co", payrollId: null, paychexWorkerId: null })).toBe(true);
    expect(canSend({ email: "", payrollId: null, paychexWorkerId: null })).toBe(false);
    expect(canSend({ email: "not-an-email", payrollId: null, paychexWorkerId: null })).toBe(false);
    expect(canSend({ email: "a@b.co", payrollId: 5, paychexWorkerId: null })).toBe(false);
    expect(canSend({ email: "a@b.co", payrollId: null, paychexWorkerId: "W1" })).toBe(false);
  });
});

const px = (workerId: string, first: string, last: string, extra: Partial<PaychexWorker> = {}): PaychexWorker => ({
  workerId, employeeId: "", workerType: "INDEPENDENT_CONTRACTOR", firstName: first, middleName: "", lastName: last,
  status: "ACTIVE", hireDate: null, phone: "", email: "", street: "", city: "", stateCode: "", zip: "", ...extra,
});

describe("paychexMatches", () => {
  const e = emp("a", "Hank Hawkins", { email: "hank@x.com", paychexWorkerId: "W9" });
  const workers = [
    px("W1", "Henry", "Hawkins", { employeeId: "301" }),
    px("W2", "Someone", "Else", { email: "HANK@x.com", employeeId: "302" }),
    px("W9", "Hank", "Hawkins"),
    px("W3", "Nobody", "Here"),
  ];
  it("lists every plausible Paychex record, the one AOS sent first", () => {
    const m = paychexMatches(e, workers);
    expect(m.map((x) => [x.workerId, x.reason])).toEqual([["W9", "Sent from AOS"], ["W2", "Same email"], ["W1", "Same name"]]);
  });
  it("Payroll ID is null until Paychex assigns one", () => {
    const m = paychexMatches(e, workers);
    expect(m[0].payrollId).toBeNull();
    expect(m[1].payrollId).toBe(302);
  });
  it("reads a whole name stuffed in Paychex's first-name field", () => {
    expect(paychexMatches(emp("b", "Jason Phelps"), [px("W5", "Jason Phelps", "")])[0]?.reason).toBe("Same name");
  });
});

describe("splitForPaychex", () => {
  it("uses AOS first/last when both exist", () => {
    expect(splitForPaychex("Mary Ann", "Smith", "whatever")).toEqual({ given: "Mary Ann", family: "Smith" });
  });
  it("splits the full name on the last space otherwise", () => {
    expect(splitForPaychex("", "", "Mary Ann Smith")).toEqual({ given: "Mary Ann", family: "Smith" });
  });
});

describe("similarName (2026-10-20 false positives)", () => {
  it("Aaron Smith is not Falon or Javon Smith", () => {
    expect(duplicateReason(emp("1", "Aaron J Smith"), emp("2", "Falon Smith"))).toBeNull();
    expect(duplicateReason(emp("1", "Aaron J Smith"), emp("2", "Javon Smith"))).toBeNull();
  });
  it("still catches a one-letter typo and DLauren/Lauren", () => {
    expect(duplicateReason(emp("1", "Justin Alen"), emp("2", "Justin Allen"))?.reason).toBe("Similar name");
    expect(duplicateReason(emp("1", "Jeffery Eckel"), emp("2", "Jeffrey Eckel"))?.reason).toBe("Same name");
    expect(duplicateReason(emp("1", "DLauren Honore"), emp("2", "Lauren Honore"))?.reason).toBe("Similar name");
    expect(duplicateReason(emp("1", "Cameron Pasley"), emp("2", "Camran Paisley"))).not.toBeNull();
  });
});

const side = (k: string, full: string, extra: Partial<MergeSide> = {}): MergeSide => {
  const [first, ...rest] = full.split(" ");
  return { employeeKey: k, fullName: full, firstName: first, lastName: rest.join(" "), email: "", phone: "", ...extra };
};

describe("mergeConflicts", () => {
  it("lists name, email and phone only when both have different values", () => {
    const a = side("a", "Mike Lynch", { email: "m@x.com", phone: "(502) 555-1212" });
    const b = side("b", "Michael Lynch", { email: "M@X.com", phone: "502-555-1212" });
    expect(mergeConflicts(a, b)).toEqual(["name"]);
    expect(mergeConflicts(a, side("c", "Mike  lynch", { email: "other@x.com", phone: "5025559999" }))).toEqual(["email", "phone"]);
  });
  it("ignores blanks (the merge fills those already)", () => {
    expect(mergeConflicts(side("a", "Ann Lee"), side("b", "Ann Lee", { email: "a@x.com" }))).toEqual([]);
  });
});

describe("mergeOverrides", () => {
  const keep = side("k", "Mike Lynch", { email: "keep@x.com", phone: "111" });
  const other = side("o", "Michael Lynch", { email: "other@x.com", phone: "222" });
  it("writes the other record's values only where picked", () => {
    expect(mergeOverrides(keep, other, { name: "o", email: "k" }))
      .toEqual({ fullName: "Michael Lynch", firstName: "Michael", lastName: "Lynch" });
    expect(mergeOverrides(keep, other, { phone: "o" })).toEqual({ phone: "222" });
    expect(mergeOverrides(keep, other, {})).toEqual({});
  });
});

describe("clearMatch", () => {
  const person = emp("a", "Jason Phelps", { email: "jp@x.com" });
  const w = (id: string, extra: Partial<PaychexWorker> = {}) => px(id, "Jason", "Phelps", { employeeId: "458", ...extra });
  const run = (p: OnbEmployee, workers: PaychexWorker[], dups: any[] = [], taken = new Set<number>()) =>
    clearMatch(p, paychexMatches(p, workers), (id) => workers.find((x) => x.workerId === id), dups, taken);

  it("links a single email match", () => {
    expect(run(person, [w("W1", { email: "JP@x.com" })])?.payrollId).toBe(458);
  });
  it("links a single exact-name match when contact info doesn't contradict", () => {
    expect(run(person, [w("W1")])?.payrollId).toBe(458);
  });
  it("not when name-only and the contact info disagrees", () => {
    expect(run(emp("a", "Jason Phelps", { email: "jp@x.com", phone: "5025551212" }),
      [w("W1", { email: "other@y.com", phone: "6145550000" })])).toBeNull();
  });
  it("not when Paychex has two possible matches", () => {
    expect(run(person, [w("W1"), px("W2", "Jason", "Phelps", { employeeId: "999" })])).toBeNull();
  });
  it("not for a similar-name match", () => {
    expect(run(emp("a", "Jason Phelp"), [w("W1")])).toBeNull();
  });
  it("not when AOS duplicates are flagged, or the ID is already taken, or no ID yet", () => {
    expect(run(person, [w("W1")], [{ employeeKey: "b" }])).toBeNull();
    expect(run(person, [w("W1")], [], new Set([458]))).toBeNull();
    expect(run(person, [w("W1", { employeeId: "" })])).toBeNull();
  });
  it("not for a name-only match with an inactive or terminated worker", () => {
    expect(run(person, [w("W1", { status: "INACTIVE" })])).toBeNull();
    expect(run(person, [w("W1", { status: "TERMINATED" })])).toBeNull();
  });
  it("an email match still links an inactive worker", () => {
    expect(run(person, [w("W1", { status: "INACTIVE", email: "jp@x.com" })])?.payrollId).toBe(458);
  });
});

describe("sounds alike (10/21)", () => {
  it("flags a possible duplicate, never strong", () => {
    expect(duplicateReason(emp("1", "Amber Slicht"), emp("2", "Amber Schlicht"))).toEqual({ reason: "Sounds alike", strong: false });
  });
  it("lists a Paychex worker who sounds alike, but never links them automatically", () => {
    const person = emp("a", "Amber Slicht");
    const m = paychexMatches(person, [px("W1", "Amber", "Schlicht", { employeeId: "77", status: "ACTIVE" })]);
    expect(m.map((x) => x.reason)).toEqual(["Sounds alike"]);
    expect(clearMatch(person, m, () => undefined, [], new Set())).toBeNull();
  });
});

describe("buildApplicantRows", () => {
  const all = [
    emp("a", "Ann Applied", { appliedAt: "2026-10-19" }),
    emp("b", "Bob Booked", { appliedAt: "2026-10-18" }),
    emp("c", "Cal Paid", { appliedAt: "2026-10-18", payrollId: 7 }),
    emp("d", "Dee Edge", { appliedAt: "2026-09-20" }),
    emp("e", "Eve Stale", { appliedAt: "2026-09-19" }),
    emp("f", "Fay Never"),
    emp("g", "Gus Sametime", { appliedAt: "2026-10-19" }),
    emp("h", "Ann Applied", { payrollId: 40 }),
  ];
  const rows = buildApplicantRows(TODAY, all, new Set(["b"]), new Set());

  it("applied in the last 30 days, no Payroll ID, not already listed", () => {
    expect(rows.map((r) => r.employeeKey).sort()).toEqual(["a", "d", "g"]);
  });
  it("newest application first, then by name", () => {
    expect(rows.map((r) => r.employeeKey)).toEqual(["a", "g", "d"]);
  });
  it("finds duplicates; no job dates", () => {
    expect(rows[0].duplicates.map((d) => d.employeeKey)).toEqual(["h"]);
    expect(rows[0].firstWorked).toBeNull();
  });
});
