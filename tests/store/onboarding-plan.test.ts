import { describe, it, expect } from "vitest";
import {
  buildOnboardingRows,
  canSend,
  defaultKeep,
  duplicateReason,
  pairKey,
  paychexMatches,
  splitForPaychex,
  windowRange,
  type Activity,
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
  ];
  const act: Activity[] = [
    { employeeKey: "a", date: "2026-10-10", kind: "time", jobName: "LBFT", hours: 8 },
    { employeeKey: "a", date: "2026-10-12", kind: "time", jobName: "LOUIS", hours: 4.5 },
    { employeeKey: "a", date: "2026-10-25", kind: "crew", jobName: "WARE", hours: 0 },
    { employeeKey: "b", date: "2026-10-12", kind: "time", jobName: "LBFT", hours: 8 },
    { employeeKey: "c", date: "2026-11-02", kind: "crew", jobName: "WARE", hours: 0 },
    { employeeKey: "d", date: "2026-08-01", kind: "time", jobName: "OLD", hours: 8 },
  ];
  const rows = buildOnboardingRows(TODAY, all, act, new Set());

  it("lists only no-ID people active in the window", () => {
    expect(rows.map((r) => r.employeeKey)).toEqual(["a", "c"]);
  });
  it("sums timesheet hours and finds last worked / next booked", () => {
    const a = rows[0];
    expect(a.hours).toBe(12.5);
    expect(a.lastWorked).toEqual({ date: "2026-10-12", jobName: "LOUIS" });
    expect(a.nextBooked).toEqual({ date: "2026-10-25", jobName: "WARE" });
  });
  it("booked-only people have no hours and sort after people with hours", () => {
    expect(rows[1].hours).toBe(0);
    expect(rows[1].lastWorked).toBeNull();
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
