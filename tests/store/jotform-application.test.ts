import { describe, it, expect } from "vitest";
import {
  appliedDifferences,
  applyToList,
  csvDate,
  decide,
  emailTypo,
  isNewer,
  junkReason,
  matchApplicant,
  newestFirst,
  parseCsv,
  parseCsvRow,
  parseWebhook,
  submissionIdFromResume,
  tidyName,
  type AppEmployee,
  type Application,
} from "@/lib/jotform/application";

const app = (extra: Partial<Application> = {}): Application => ({
  submissionId: "6683169101111861118", submittedOn: "2026-10-20",
  firstName: "Pat", lastName: "Rivera", email: "pat.rivera@example.com", phone: "(719) 555-0101",
  address: { line1: "12 Main St", line2: "", city: "Dayton", state: "OH", zip: "45402", country: "", text: "12 Main St, Dayton, OH, 45402" },
  addressStructured: true, position: "Stagehand", sms: true, ...extra,
});

const emp = (k: string, name: string, extra: Partial<AppEmployee> = {}): AppEmployee => ({
  employeeKey: k, name, email: "", phone: "", address: "", city: "", stateCode: "", zip: "",
  appliedAt: null, submissionId: null, ...extra,
});

describe("parseWebhook", () => {
  // Shape of a real submission's answers (form 260385023196052, 10/20), made up values.
  const raw = {
    q2_fullname0: { first: "pat", last: "rivera" },
    q3_email1: " Pat.Rivera@Example.com ",
    q4_phone2: { full: "(719) 555-0101" },
    q5_address3: { addr_line1: "12 Main St", addr_line2: "Apt 2", city: "dayton", state: "oh", postal: "45402", country: "" },
    q6_textbox4: "Stagehand",
    q13_textOptin: "Yes",
  };
  it("reads the confirmed question IDs", () => {
    const a = parseWebhook(raw, "123", "2026-10-21");
    expect(a).toMatchObject({
      submissionId: "123", submittedOn: "2026-10-21", firstName: "Pat", lastName: "Rivera",
      email: "pat.rivera@example.com", phone: "(719) 555-0101", position: "Stagehand", sms: true, addressStructured: true,
    });
    expect(a.address).toMatchObject({ line1: "12 Main St", line2: "Apt 2", city: "Dayton", state: "OH", zip: "45402" });
    expect(a.address.text).toBe("12 Main St Apt 2, Dayton, OH, 45402");
  });
  it("leaves SMS blank when unanswered", () => {
    expect(parseWebhook({ ...raw, q13_textOptin: "" }, "1", "2026-10-21").sms).toBeNull();
    expect(parseWebhook({ ...raw, q13_textOptin: "No" }, "1", "2026-10-21").sms).toBe(false);
  });
});

describe("CSV export", () => {
  it("dates and submission IDs", () => {
    expect(csvDate("Oct 20, 2026")).toBe("2026-10-20");
    expect(csvDate("Mar 3, 2026")).toBe("2026-03-03");
    expect(csvDate("")).toBe("");
    expect(submissionIdFromResume("https://www.jotform.com/uploads/Amplified_Event/260385023196052/6683169101111861118/cv.pdf")).toBe("6683169101111861118");
    expect(submissionIdFromResume("https://example.com/other/1/cv.pdf")).toBe("");
  });
  it("parses quoted fields", () => {
    const rows = parseCsv('﻿A,B\r\n"x, y","say ""hi"""\r\n\r\n1,2\r\n');
    expect(rows).toEqual([{ A: "x, y", B: 'say "hi"' }, { A: "1", B: "2" }]);
  });
  it("row: last word is the last name; only state + zip trusted from the address", () => {
    const a = parseCsvRow({
      "Submission Date": "Oct 19, 2026", "Full Name": "mary ann smith", "Email Address": "M@x.com", "Phone Number": "(903) 555-0102",
      Address: "45 Elm Rd Apt 3 Columbus, oh, 43004", "Position Applied For": "Rigger",
      "Upload Your Resume (PDF, DOC, or DOCX)": "https://www.jotform.com/uploads/A/260385023196052/42/r.pdf",
      "By choosing Yes you agree to receive text messages from Amplified Event Solutions LLC.": "",
    });
    expect(a).toMatchObject({ submissionId: "42", submittedOn: "2026-10-19", firstName: "Mary Ann", lastName: "Smith", email: "m@x.com", sms: null, addressStructured: false });
    expect(a.address).toMatchObject({ line1: "", city: "", state: "OH", zip: "43004" });
  });
});

describe("tidyName", () => {
  it("fixes all-lower and all-upper, leaves mixed case", () => {
    expect(tidyName("chandler o'neil-smith")).toBe("Chandler O'Neil-Smith");
    expect(tidyName("JOHN DOE")).toBe("John Doe");
    expect(tidyName("DeShawn McCoy")).toBe("DeShawn McCoy");
  });
});

describe("junk", () => {
  it("skips the plan's junk cases", () => {
    expect(junkReason(app())).toBeNull();
    expect(junkReason(app({ email: "nope" }))).toBe("No valid email");
    expect(junkReason(app({ phone: "555-0101" }))).toBe("Phone isn't 10 digits");
    expect(junkReason(app({ firstName: "www.spam.com" }))).toBe("Link or digits in the name");
    expect(junkReason(app({ lastName: "R2" }))).toBe("Link or digits in the name");
    expect(junkReason(app({ lastName: "" }))).toBe("One-word name");
    expect(junkReason(app({ submissionId: "" }))).toBe("No submission ID");
  });
  it("flags misspelled domains without skipping", () => {
    expect(emailTypo("a@gamil.com")).toMatch(/gamil\.com/);
    expect(emailTypo("a@gmail.com")).toBeNull();
    expect(junkReason(app({ email: "a@gamil.com" }))).toBeNull();
  });
});

describe("matchApplicant", () => {
  it("email first", () => {
    const m = matchApplicant(app(), [emp("a", "Someone Else", { email: "PAT.RIVERA@example.com" }), emp("b", "Pat Rivera")]);
    expect(m).toMatchObject({ kind: "one", reason: "email", employee: { employeeKey: "a" } });
  });
  it("phone when the first name fits", () => {
    expect(matchApplicant(app(), [emp("a", "Patrick Rivera", { phone: "719-555-0101" })])).toMatchObject({ kind: "one", reason: "phone" });
  });
  it("a family's shared phone isn't a match", () => {
    expect(matchApplicant(app(), [emp("a", "Maria Rivera", { phone: "7195550101" })])).toEqual({ kind: "none" });
  });
  it("same name only when the record has no email or phone to disagree", () => {
    expect(matchApplicant(app(), [emp("a", "Pat Rivera")])).toMatchObject({ kind: "one", reason: "name" });
    expect(matchApplicant(app(), [emp("a", "Pat Rivera", { email: "other@x.com" })])).toEqual({ kind: "none" });
    expect(matchApplicant(app(), [emp("a", "Pat Rivera", { phone: "(111) 222-3333" })])).toEqual({ kind: "none" });
  });
  it("nicknames count, Jr/Sr doesn't", () => {
    expect(matchApplicant(app({ firstName: "Bob", lastName: "Burke" }), [emp("a", "Robert Burke")])).toMatchObject({ kind: "one", reason: "name" });
    expect(matchApplicant(app({ firstName: "Bob", lastName: "Burke Jr" }), [emp("a", "Robert Burke")])).toEqual({ kind: "none" });
  });
  it("several records → several", () => {
    expect(matchApplicant(app(), [emp("a", "Pat Rivera"), emp("b", "Pat Rivera")])).toMatchObject({ kind: "several", reason: "name", keys: ["a", "b"] });
    expect(matchApplicant(app(), [emp("a", "X", { email: "pat.rivera@example.com" }), emp("b", "Y", { email: "pat.rivera@example.com" })])).toMatchObject({ kind: "several", reason: "email" });
  });
});

describe("decide", () => {
  it("creates a new Contractor when nobody matches", () => {
    const d = decide(app(), []);
    expect(d.outcome).toBe("created");
    expect(d.employeeKey).toBe("app-6683169101111861118");
    expect(d.write).toMatchObject({
      full_name: "Pat Rivera", first_name: "Pat", last_name: "Rivera", email: "pat.rivera@example.com", phone: "(719) 555-0101",
      address: "12 Main St", city: "Dayton", state_code: "OH", state: "OH", zip: "45402",
      employment_type: "Contractor", status: "Active", source: "website-application", is_deleted: false,
      applied_at: "2026-10-20T12:00:00Z", jotform_submission_id: "6683169101111861118", sms_consent: true,
    });
    expect(d.write!.application_contact).toMatchObject({ email: "pat.rivera@example.com", phone: "(719) 555-0101" });
  });
  it("fills blanks only and lists differences", () => {
    const d = decide(app(), [emp("a", "Pat Rivera", { phone: "(719) 555-0101", email: "", city: "Kettering" })]);
    expect(d.outcome).toBe("updated");
    expect(d.matchReason).toBe("phone");
    expect(d.write).toMatchObject({ email: "pat.rivera@example.com", address: "12 Main St", zip: "45402", state_code: "OH", state: "OH" });
    expect(d.write).not.toHaveProperty("city");
    expect(d.write).not.toHaveProperty("phone");
    expect(d.differences).toEqual([]);

    const d2 = decide(app(), [emp("a", "Pat Rivera", { email: "pat.rivera@example.com", phone: "(111) 222-3333", address: "x", city: "y", stateCode: "OH", zip: "45402" })]);
    expect(d2.outcome).toBe("matched");
    expect(d2.differences).toEqual(["phone"]);
    expect(d2.write).not.toHaveProperty("phone");
    expect(d2.write).toHaveProperty("application_contact");
  });
  it("CSV rows never write street or city", () => {
    const d = decide(app({ addressStructured: false, address: { line1: "", line2: "", city: "", state: "OH", zip: "45402", country: "", text: "12 Main St Dayton, OH, 45402" } }), []);
    expect(d.write).not.toHaveProperty("address");
    expect(d.write).not.toHaveProperty("city");
    expect(d.write).toMatchObject({ state_code: "OH", zip: "45402" });
  });
  it("an older application fills blanks but doesn't replace the latest one", () => {
    const d = decide(app({ submittedOn: "2026-09-01" }), [emp("a", "Pat Rivera", { email: "pat.rivera@example.com", appliedAt: "2026-10-01", submissionId: "9" })]);
    expect(d.outcome).toBe("older");
    expect(d.write).not.toHaveProperty("applied_at");
    expect(d.write).toHaveProperty("phone");
  });
  it("skips junk and several without writing", () => {
    expect(decide(app({ email: "" }), [])).toMatchObject({ outcome: "skipped", write: null });
    expect(decide(app(), [emp("a", "Pat Rivera"), emp("b", "Pat Rivera")])).toMatchObject({ outcome: "several", write: null });
  });
});

describe("isNewer / newestFirst", () => {
  it("by day, then submission ID", () => {
    expect(isNewer({ submittedOn: "2026-10-20", submissionId: "5" }, { appliedAt: null, submissionId: null })).toBe(true);
    expect(isNewer({ submittedOn: "2026-10-20", submissionId: "5" }, { appliedAt: "2026-10-19", submissionId: "9" })).toBe(true);
    expect(isNewer({ submittedOn: "2026-10-20", submissionId: "5" }, { appliedAt: "2026-10-20", submissionId: "9" })).toBe(false);
    expect(isNewer({ submittedOn: "2026-10-20", submissionId: "10" }, { appliedAt: "2026-10-20", submissionId: "9" })).toBe(true);
    const order = newestFirst([app({ submissionId: "9", submittedOn: "2026-10-20" }), app({ submissionId: "10", submittedOn: "2026-10-20" }), app({ submissionId: "99", submittedOn: "2026-10-01" })]);
    expect(order.map((a) => a.submissionId)).toEqual(["10", "9", "99"]);
  });
});

describe("one-time load: repeat applicants", () => {
  it("the newest creates, the older one then matches it", () => {
    const newer = app({ submissionId: "20", submittedOn: "2026-10-20" });
    const older = app({ submissionId: "10", submittedOn: "2026-05-01", email: "old@example.com" });
    let list: AppEmployee[] = [];
    const out = [];
    for (const a of newestFirst([older, newer])) {
      const d = decide(a, list);
      list = applyToList(list, a, d);
      out.push(d);
    }
    expect(out.map((d) => d.outcome)).toEqual(["created", "older"]);
    expect(out[1].matchReason).toBe("phone");
    expect(out[1].differences).toEqual(["email"]);
    expect(list).toHaveLength(1);
    expect(list[0].appliedAt).toBe("2026-10-20");
  });
});

describe("appliedDifferences", () => {
  it("only where both sides have a value and they differ", () => {
    const c = { email: "new@x.com", phone: "(719) 555-0101" };
    expect(appliedDifferences({ email: "old@x.com", phone: "7195550101" }, c)).toEqual({ email: "new@x.com" });
    expect(appliedDifferences({ email: "", phone: "(111) 222-3333" }, c)).toEqual({ phone: "(719) 555-0101" });
    expect(appliedDifferences({ email: "NEW@x.com", phone: "" }, c)).toEqual({});
    expect(appliedDifferences({ email: "a", phone: "b" }, null)).toEqual({});
  });
});
