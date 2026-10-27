import { describe, it, expect } from "vitest";
import {
  matchesFilters, missingLabel, NO_FILTERS, onboardingCsv, onJob, paychexState, type OnbFilters,
} from "@/lib/onboarding/filters";
import type { OnboardingRow, PaychexMatch } from "@/lib/onboarding/plan";

const TODAY = "2026-10-27";

const row = (k: string, extra: Partial<OnboardingRow> = {}): OnboardingRow => ({
  employeeKey: k, name: k, email: `${k}@x.com`, phone: "5551234567", employmentType: "Contractor",
  payrollId: null, status: "Active", paychexWorkerId: null, paychexInvitedAt: null,
  firstWorked: null, lastWorked: null, nextBooked: null, hours: 0, duplicates: [], ...extra,
});

const worked = (date: string) => ({ firstWorked: { date, jobName: "KIOSK" }, lastWorked: { date, jobName: "KIOSK" } });
const f = (x: Partial<OnbFilters>): OnbFilters => ({ ...NO_FILTERS, ...x });
const match: PaychexMatch = { workerId: "w1", payrollId: 9, name: "A", status: "ACTIVE", workerType: "x", reason: "Same name" };

describe("matchesFilters", () => {
  const onjob = row("onjob", worked("2026-10-25"));
  const old = row("old", worked("2026-10-01"));
  const ahead = row("ahead", { nextBooked: { date: "2026-11-02", jobName: "LIV" } });
  const app = row("app", { appliedAt: "2026-10-24" });

  it("no filters shows everyone", () => {
    for (const r of [onjob, old, ahead, app]) expect(matchesFilters(r, NO_FILTERS, undefined, TODAY)).toBe(true);
  });

  it("job filter splits on a job / applied", () => {
    expect([onjob, ahead, app].map(onJob)).toEqual([true, true, false]);
    expect(matchesFilters(app, f({ job: "on" }), undefined, TODAY)).toBe(false);
    expect(matchesFilters(app, f({ job: "off" }), undefined, TODAY)).toBe(true);
    expect(matchesFilters(ahead, f({ job: "off" }), undefined, TODAY)).toBe(false);
  });

  it("when: last worked, or applied date for applicants; booked ahead", () => {
    expect(matchesFilters(onjob, f({ when: "past7" }), undefined, TODAY)).toBe(true);
    expect(matchesFilters(old, f({ when: "past7" }), undefined, TODAY)).toBe(false);
    expect(matchesFilters(old, f({ when: "past30" }), undefined, TODAY)).toBe(true);
    expect(matchesFilters(app, f({ when: "past7" }), undefined, TODAY)).toBe(true);
    expect(matchesFilters(ahead, f({ when: "past30" }), undefined, TODAY)).toBe(false);
    expect(matchesFilters(ahead, f({ when: "ahead" }), undefined, TODAY)).toBe(true);
    expect(matchesFilters(onjob, f({ when: "ahead" }), undefined, TODAY)).toBe(false);
  });

  it("date filter is skipped until today is known", () => {
    expect(matchesFilters(old, f({ when: "past7" }), undefined, "")).toBe(true);
  });

  it("missing info", () => {
    const noEmail = row("ne", { email: " " });
    const noPhone = row("np", { phone: "" });
    expect(missingLabel(row("n", { email: "", phone: "" }))).toBe("email, phone");
    expect(matchesFilters(noEmail, f({ missing: "email" }), undefined, TODAY)).toBe(true);
    expect(matchesFilters(noPhone, f({ missing: "email" }), undefined, TODAY)).toBe(false);
    expect(matchesFilters(noPhone, f({ missing: "either" }), undefined, TODAY)).toBe(true);
    expect(matchesFilters(onjob, f({ missing: "either" }), undefined, TODAY)).toBe(false);
    expect(matchesFilters(onjob, f({ missing: "none" }), undefined, TODAY)).toBe(true);
    expect(matchesFilters(noEmail, f({ missing: "none" }), undefined, TODAY)).toBe(false);
  });

  it("paychex: sent / not sent / found / not found", () => {
    const sent = row("s", { paychexInvitedAt: "2026-10-26T12:00:00Z", paychexWorkerId: "w9" });
    expect(matchesFilters(sent, f({ paychex: "waiting" }), [], TODAY)).toBe(true);
    expect(matchesFilters(onjob, f({ paychex: "waiting" }), [], TODAY)).toBe(false);
    expect(matchesFilters(onjob, f({ paychex: "notSent" }), [], TODAY)).toBe(true);
    expect(matchesFilters(onjob, f({ paychex: "found" }), [match], TODAY)).toBe(true);
    expect(matchesFilters(onjob, f({ paychex: "found" }), [], TODAY)).toBe(false);
    expect(matchesFilters(onjob, f({ paychex: "notFound" }), [], TODAY)).toBe(true);
    // Not looked up yet: neither found nor not found.
    expect(matchesFilters(onjob, f({ paychex: "notFound" }), undefined, TODAY)).toBe(false);
    expect(matchesFilters(sent, f({ paychex: "found" }), [match], TODAY)).toBe(false);
  });

  it("search covers name, email, phone and job", () => {
    expect(matchesFilters(onjob, f({ search: "kiosk" }), undefined, TODAY)).toBe(true);
    expect(matchesFilters(onjob, f({ search: "ONJOB@" }), undefined, TODAY)).toBe(true);
    expect(matchesFilters(onjob, f({ search: "liv" }), undefined, TODAY)).toBe(false);
  });
});

describe("paychexState", () => {
  it("labels each case", () => {
    expect(paychexState(row("a", { paychexWorkerId: "w" }), undefined)).toBe("Sent, waiting");
    expect(paychexState(row("a"), undefined)).toBe("Not checked");
    expect(paychexState(row("a"), [])).toBe("Not sent");
    expect(paychexState(row("a"), [match])).toBe("Possible match in Paychex");
  });
});

describe("onboardingCsv", () => {
  it("has a header, quotes commas, and lists what's missing", () => {
    const csv = onboardingCsv([
      row("a", { name: "Smith, Ann", email: "", ...worked("2026-10-25"), hours: 8,
        duplicates: [{ employeeKey: "b", name: "Ann Smith", payrollId: null, email: "", phone: "", reason: "Same name", strong: true }] }),
    ], { a: [] });
    const lines = csv.replace(/^﻿/, "").trim().split("\r\n");
    expect(lines[0].startsWith("Name,Type,Email,Phone,Missing,On a job")).toBe(true);
    expect(lines[1]).toBe('"Smith, Ann",Contractor (1099),,5551234567,email,Yes,2026-10-25,2026-10-25,KIOSK,8,,,,,Not sent,Ann Smith');
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });
});
