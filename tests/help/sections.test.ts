import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { helpSectionFor } from "@/lib/help/sections";

describe("Help button section mapping", () => {
  it("sends each screen to its own section", () => {
    expect(helpSectionFor("/timekeeping")).toBe("timekeeping");
    expect(helpSectionFor("/lead/timekeeping")).toBe("timekeeping");
    expect(helpSectionFor("/timekeeping/review")).toBe("review");
    expect(helpSectionFor("/timeclock")).toBe("timeclock");
    expect(helpSectionFor("/job-requests/abc/print")).toBe("printing");
    expect(helpSectionFor("/job-requests/abc/pre-invoice-report")).toBe("reports");
    expect(helpSectionFor("/job-requests/abc")).toBe("jobs");
    expect(helpSectionFor("/lead/jobs/new")).toBe("jobs");
    expect(helpSectionFor("/quotes/q1")).toBe("quotes");
    expect(helpSectionFor("/invoices")).toBe("invoicing");
    expect(helpSectionFor("/payroll/run-1")).toBe("payroll");
    expect(helpSectionFor("/job-requests")).toBe("jobs-list");
    expect(helpSectionFor("/lead/jobs")).toBe("jobs-list");
    expect(helpSectionFor("/dashboard")).toBe("dashboard");
    expect(helpSectionFor("/master-calendar")).toBe("calendar");
    expect(helpSectionFor("/clients/c1")).toBe("clients");
    expect(helpSectionFor("/lead/employees/k1")).toBe("employees");
    expect(helpSectionFor("/maintenance")).toBe("users");
    expect(helpSectionFor("/rate-card")).toBe("overview");
    expect(helpSectionFor(null)).toBe("overview");
  });

  it("on a job, opens the section for the tab that's showing", () => {
    expect(helpSectionFor("/job-requests/abc", "?tab=daily")).toBe("requirements");
    expect(helpSectionFor("/job-requests/abc", "?tab=crew")).toBe("crew");
    expect(helpSectionFor("/lead/jobs/abc", "?tab=shifts")).toBe("shifts");
    expect(helpSectionFor("/job-requests/abc", "?tab=attachments")).toBe("attachments");
    expect(helpSectionFor("/job-requests/abc", "?tab=health")).toBe("health");
    expect(helpSectionFor("/job-requests/abc", "?tab=bogus")).toBe("jobs");
    expect(helpSectionFor("/job-requests/abc", "")).toBe("jobs");
    // ?tab only means something on a job page
    expect(helpSectionFor("/timekeeping", "?tab=crew")).toBe("timekeeping");
  });

  it("every section the button can open exists in HELP.md", () => {
    const md = fs.readFileSync(path.join(process.cwd(), "HELP.md"), "utf8");
    const anchors = new Set([...md.matchAll(/\{#([a-z-]+)\}\s*$/gm)].map((m) => m[1]));
    const paths = ["/timekeeping", "/timekeeping/review", "/timeclock", "/job-requests/x/print",
      "/job-requests/x/pre-invoice-report", "/job-requests", "/quotes", "/invoices", "/payroll", "/dashboard",
      "/master-calendar", "/clients", "/employee-directory", "/maintenance", "/rate-card"];
    for (const p of paths) expect(anchors.has(helpSectionFor(p))).toBe(true);
    expect(anchors.has("requirements")).toBe(true);
    for (const tab of ["daily", "crew", "shifts", "attachments", "health"]) {
      expect(md).toContain(`{#${helpSectionFor("/job-requests/x", `?tab=${tab}`)}}`);
    }
  });

  it("help stays free of money figures", () => {
    const md = fs.readFileSync(path.join(process.cwd(), "HELP.md"), "utf8");
    expect(md).not.toMatch(/\$\s?\d/);
  });
});
