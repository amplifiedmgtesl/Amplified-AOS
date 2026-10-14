import { describe, it, expect } from "vitest";
import {
  planPaychexSync,
  splitPaychexName,
  nameKey,
  formatPhone,
  contactChanges,
  type PaychexWorker,
  type AosEmployee,
} from "@/lib/paychex/sync-plan";

function px(p: Partial<PaychexWorker>): PaychexWorker {
  return {
    workerId: "w-" + (p.employeeId ?? "1"), employeeId: "1", workerType: "INDEPENDENT_CONTRACTOR",
    firstName: "", middleName: "", lastName: "", status: "ACTIVE", hireDate: null,
    phone: "", email: "", street: "", city: "", stateCode: "", zip: "", ...p,
  };
}
function aos(p: Partial<AosEmployee>): AosEmployee {
  return {
    employeeKey: "emp-1", fullName: "", firstName: "", lastName: "", payrollId: null, employmentType: "Contractor",
    phone: "", email: "", address: "", city: "", stateCode: "", zip: "", ...p,
  };
}

describe("splitPaychexName", () => {
  it("keeps a normal first/last", () => {
    expect(splitPaychexName("Sean", "", "Brown")).toEqual({ first: "Sean", last: "Brown" });
  });
  it("splits a whole name stored in the first-name field", () => {
    expect(splitPaychexName("Adam Kaiser", "", "")).toEqual({ first: "Adam", last: "Kaiser" });
    expect(splitPaychexName("Mary Ann Smith", "", "")).toEqual({ first: "Mary Ann", last: "Smith" });
  });
  it("leaves a single word alone", () => {
    expect(splitPaychexName("Cher", "", "")).toEqual({ first: "Cher", last: "" });
  });
});

describe("nameKey", () => {
  it("matches Chris/Christopher and ignores case, middle names and suffixes", () => {
    expect(nameKey("Chris Travis")).toBe(nameKey("christopher A Travis"));
    expect(nameKey("Jeffrey Williamson Jr")).toBe("jef williamson");
    expect(nameKey("Bob Burke")).toBe(nameKey("Robert Leroy Burke"));
    expect(nameKey("Hank Hawkins")).toBe(nameKey("Henry Hawkins"));
  });
});

describe("formatPhone", () => {
  it("formats 10 digits and drops a leading 1", () => {
    expect(formatPhone("19378230433")).toBe("(937) 823-0433");
    expect(formatPhone("937.823.0433")).toBe("(937) 823-0433");
    expect(formatPhone("12345")).toBe("");
  });
});

describe("contactChanges", () => {
  it("never blanks an AOS value when Paychex has none", () => {
    const ch = contactChanges(px({ email: "" }), aos({ email: "keep@x.com" }));
    expect(ch).toEqual([]);
  });
  it("ignores formatting-only differences", () => {
    const ch = contactChanges(
      px({ phone: "9378230433", email: "A@X.COM", street: "1052 Lipton Ln", zip: "45430-1234", stateCode: "oh" }),
      aos({ phone: "(937) 823-0433", email: "a@x.com", address: "1052 lipton ln.", zip: "45430", stateCode: "OH" }),
    );
    expect(ch).toEqual([]);
  });
  it("reports a real change with the Paychex value", () => {
    const ch = contactChanges(px({ city: "Dayton" }), aos({ city: "Beavercreek" }));
    expect(ch).toEqual([{ field: "city", from: "Beavercreek", to: "Dayton" }]);
  });
});

describe("planPaychexSync", () => {
  it("updates contact info on the record holding the Payroll ID", () => {
    const plan = planPaychexSync(
      [px({ employeeId: "79", firstName: "Sean", lastName: "Brown", email: "new@x.com" })],
      [aos({ employeeKey: "AES-00640", fullName: "Sean Brown", payrollId: 79, email: "old@x.com" })],
    );
    expect(plan.changes).toEqual([{ id: "update:AES-00640", kind: "update", employeeKey: "AES-00640", payrollId: 79,
      name: "Sean Brown", fields: [{ field: "email", from: "old@x.com", to: "new@x.com" }] }]);
    expect(plan.reports).toEqual([]);
  });

  it("ignores inactive and terminated Paychex workers", () => {
    const plan = planPaychexSync([px({ employeeId: "5", firstName: "A", lastName: "B", status: "INACTIVE" })], []);
    expect(plan.changes).toEqual([]);
    expect(plan.activeWorkers).toBe(0);
  });

  it("reports a name difference but never changes the name", () => {
    const plan = planPaychexSync(
      [px({ employeeId: "12", firstName: "Cameron", lastName: "Pasley" })],
      [aos({ employeeKey: "AES-49541", fullName: "Camran Paisley", payrollId: 12 })],
    );
    expect(plan.changes).toEqual([]);
    expect(plan.reports.map((r) => r.kind)).toEqual(["name"]);
  });

  it("reports a W-2 / 1099 difference without changing it", () => {
    const plan = planPaychexSync(
      [px({ employeeId: "13", firstName: "Chris", lastName: "Travis", workerType: "EMPLOYEE" })],
      [aos({ employeeKey: "AES-01853", fullName: "Christopher Travis", payrollId: 13, employmentType: "Contractor" })],
    );
    expect(plan.changes).toEqual([]);
    expect(plan.reports.map((r) => r.kind)).toEqual(["type"]);
  });

  it("links a new Paychex ID to the one AOS person with that name and no ID", () => {
    const plan = planPaychexSync(
      [px({ employeeId: "575", firstName: "Adam Kaiser", phone: "5135551234" })],
      [aos({ employeeKey: "emp-1791400273282", fullName: "Adam Kaiser" })],
    );
    expect(plan.changes).toEqual([{ id: "link:emp-1791400273282:575", kind: "link", employeeKey: "emp-1791400273282",
      payrollId: 575, name: "Adam Kaiser", paychexName: "Adam Kaiser", matchedOn: "name",
      fields: [{ field: "phone", from: "", to: "(513) 555-1234" }] }]);
  });

  it("does not link on a shared phone when the last name differs", () => {
    const plan = planPaychexSync(
      [px({ employeeId: "600", firstName: "Jane", lastName: "Doe", phone: "5135551234" })],
      [aos({ employeeKey: "emp-2", fullName: "John Smith", phone: "513-555-1234" })],
    );
    expect(plan.changes.map((c) => c.kind)).toEqual(["create"]);
  });

  it("reports instead of guessing when several AOS records could match", () => {
    const plan = planPaychexSync(
      [px({ employeeId: "601", firstName: "Chris", lastName: "Stewart" })],
      [aos({ employeeKey: "emp-a", fullName: "Chris Stewart" }), aos({ employeeKey: "emp-b", fullName: "Christopher Stewart" })],
    );
    expect(plan.changes).toEqual([]);
    expect(plan.reports.map((r) => r.kind)).toEqual(["ambiguous"]);
  });

  it("reports a second Paychex ID for someone AOS already has under another ID", () => {
    const plan = planPaychexSync(
      [px({ employeeId: "526", firstName: "Chris", lastName: "Travis" })],
      [aos({ employeeKey: "AES-01853", fullName: "Christopher Travis", payrollId: 13 })],
    );
    expect(plan.changes).toEqual([]);
    expect(plan.reports.map((r) => r.kind)).toEqual(["id_mismatch"]);
  });

  it("creates a record for a new Paychex worker with no AOS match", () => {
    const plan = planPaychexSync(
      [px({ employeeId: "577", firstName: "Melissa Mcwilliams", workerType: "INDEPENDENT_CONTRACTOR",
        hireDate: "2026-10-13", email: "M@X.com", city: "Dayton", stateCode: "oh" })],
      [],
    );
    expect(plan.changes).toEqual([{ id: "create:577", kind: "create", payrollId: 577, name: "Melissa Mcwilliams",
      firstName: "Melissa", lastName: "Mcwilliams", employmentType: "Contractor", hireDate: "2026-10-13",
      contact: { phone: "", email: "m@x.com", address: "", city: "Dayton", stateCode: "OH", zip: "" } }]);
  });

  it("links nobody when Paychex has the same person twice (Paychex duplicate)", () => {
    const plan = planPaychexSync(
      [px({ employeeId: "510", firstName: "Paul", lastName: "Brennan" }),
       px({ employeeId: "535", firstName: "Paul", lastName: "Brennan" })],
      [aos({ employeeKey: "emp-p", fullName: "Paul Brennan" })],
    );
    expect(plan.changes).toEqual([]);
    expect(plan.reports.map((r) => r.kind)).toEqual(["ambiguous", "ambiguous"]);
  });

  it("creates nobody when Paychex has the same new person twice", () => {
    const plan = planPaychexSync(
      [px({ employeeId: "511", firstName: "Precious", lastName: "Jewett" }),
       px({ employeeId: "549", firstName: "Precious", lastName: "Jewett" })],
      [],
    );
    expect(plan.changes).toEqual([]);
    expect(plan.reports.map((r) => r.kind)).toEqual(["ambiguous", "ambiguous"]);
  });

  it("reports an ID still held by a deleted AOS record instead of reusing it", () => {
    const plan = planPaychexSync([px({ employeeId: "215", firstName: "Nick", lastName: "Huth" })], [], new Set([215]));
    expect(plan.changes).toEqual([]);
    expect(plan.reports.map((r) => r.kind)).toEqual(["id_mismatch"]);
  });

  it("does not link when AOS already has the same name under another Payroll ID", () => {
    const plan = planPaychexSync(
      [px({ employeeId: "525", firstName: "Ryan", lastName: "Andrews" })],
      [aos({ employeeKey: "AES-00738", fullName: "Ryan Andrews", payrollId: 129 }),
       aos({ employeeKey: "emp-r", fullName: "Ryan Ray Andrews" })],
    );
    expect(plan.changes).toEqual([]);
    expect(plan.reports.map((r) => r.kind)).toEqual(["id_mismatch"]);
  });

  it("holds back a new record whose name is a near-typo of an existing one", () => {
    const plan = planPaychexSync(
      [px({ employeeId: "541", firstName: "Justin Alllen" }), px({ employeeId: "532", firstName: "DLauren", lastName: "Honore" })],
      [aos({ employeeKey: "emp-j", fullName: "Justin Allen" }), aos({ employeeKey: "emp-l", fullName: "Lauren Honore", payrollId: 443 })],
    );
    expect(plan.changes).toEqual([]);
    expect(plan.reports.map((r) => r.kind)).toEqual(["ambiguous", "ambiguous"]);
  });

  it("treats curly and straight apostrophes as the same name", () => {
    expect(nameKey("Le’Andray Thompson")).toBe(nameKey("Le'Andray Thompson"));
  });

  it("swaps an AOS Payroll ID Paychex doesn't have for Paychex's number for that person", () => {
    const all = [px({ employeeId: "499", firstName: "Joel", lastName: "Archey", status: "INACTIVE" })];
    const plan = planPaychexSync([], [aos({ employeeKey: "emp-j", fullName: "Joel Archey", payrollId: 348 })], new Set(), all);
    expect(plan.changes).toEqual([{ id: "reid:emp-j:499", kind: "reid", employeeKey: "emp-j", payrollId: 499,
      fromPayrollId: 348, name: "Joel Archey", paychexName: "Joel Archey", paychexStatus: "INACTIVE" }]);
  });

  it("blanks an AOS Payroll ID when Paychex has no such number and no such person", () => {
    const plan = planPaychexSync([], [aos({ employeeKey: "emp-m", fullName: "Morgan McCabe", payrollId: 450 })], new Set(), []);
    expect(plan.changes).toEqual([{ id: "clear:emp-m:450", kind: "clear", employeeKey: "emp-m", payrollId: 450, name: "Morgan McCabe" }]);
  });

  it("blanks and reports when Paychex has the name under two numbers", () => {
    const all = [px({ employeeId: "511", firstName: "Precious", lastName: "Jewett" }), px({ employeeId: "549", firstName: "Precious", lastName: "Jewett" })];
    const plan = planPaychexSync([], [aos({ employeeKey: "emp-p", fullName: "Precious Jewett", payrollId: 432 })], new Set(), all);
    expect(plan.changes.map((c) => c.kind)).toEqual(["clear"]);
    expect(plan.reports.map((r) => r.kind)).toEqual(["ambiguous"]);
  });

  it("leaves an AOS Payroll ID alone when Paychex has it", () => {
    const all = [px({ employeeId: "79", firstName: "Sean", lastName: "Brown" })];
    const plan = planPaychexSync([], [aos({ employeeKey: "AES-00640", fullName: "Sean Brown", payrollId: 79 })], new Set(), all);
    expect(plan.changes).toEqual([]);
  });

  it("reports instead of linking when Paychex has the same person more than once", () => {
    const plan = planPaychexSync(
      [px({ employeeId: "247", firstName: "Lauren", lastName: "Honore" }),
       px({ employeeId: "532", firstName: "DLauren", lastName: "Honore", workerType: "EMPLOYEE" })],
      [aos({ employeeKey: "rip-443", fullName: "Lauren Honore" })],
    );
    expect(plan.changes).toEqual([]);
    expect(plan.reports.map((r) => r.kind)).toEqual(["ambiguous", "ambiguous"]);
  });
});

