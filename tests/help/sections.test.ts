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

  it("every section the button can open exists in HELP.md", () => {
    const md = fs.readFileSync(path.join(process.cwd(), "HELP.md"), "utf8");
    const anchors = new Set([...md.matchAll(/\{#([a-z-]+)\}\s*$/gm)].map((m) => m[1]));
    const paths = ["/timekeeping", "/timekeeping/review", "/timeclock", "/job-requests/x/print",
      "/job-requests/x/pre-invoice-report", "/job-requests", "/quotes", "/invoices", "/payroll", "/dashboard",
      "/master-calendar", "/clients", "/employee-directory", "/maintenance", "/rate-card"];
    for (const p of paths) expect(anchors.has(helpSectionFor(p))).toBe(true);
    expect(anchors.has("requirements")).toBe(true);
    expect(anchors.has("crew")).toBe(true);
  });

  it("help stays free of money figures", () => {
    const md = fs.readFileSync(path.join(process.cwd(), "HELP.md"), "utf8");
    expect(md).not.toMatch(/\$\s?\d/);
  });
});
