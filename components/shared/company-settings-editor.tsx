/**
 * Maintenance editor for the company_settings singleton row.
 *
 * Used by the quote/invoice PDFs for the letterhead and remit-to info.
 * Single row keyed 'singleton' (CHECK constraint enforced), so save = upsert
 * via the loader's existing pattern.
 */

"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { loadCompanySettings, type CompanySettings } from "@/lib/store/company-settings";

const EMPTY: CompanySettings = {
  companyName: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  state: "",
  zip: "",
  phone: "",
  email: "",
  website: "",
  taxId: "",
  bankName: "",
  bankAccountName: "",
  bankAccountNumber: "",
  bankAccountType: "",
  bankRoutingNumber: "",
  bankWireRoutingNumber: "",
  bankAddress: "",
};

export default function CompanySettingsEditor() {
  const [form, setForm] = useState<CompanySettings>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadCompanySettings().then((s) => {
      if (cancelled) return;
      setForm(s);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  function patch(p: Partial<CompanySettings>) {
    setForm((cur) => ({ ...cur, ...p }));
  }

  async function save() {
    setSaving(true);
    setStatusMsg(null);
    try {
      const { error } = await supabase
        .from("company_settings")
        .upsert({
          id: "singleton",
          company_name:  form.companyName  || null,
          address_line1: form.addressLine1 || null,
          address_line2: form.addressLine2 || null,
          city:          form.city         || null,
          state:         form.state        || null,
          zip:           form.zip          || null,
          phone:         form.phone        || null,
          email:         form.email        || null,
          website:       form.website      || null,
          tax_id:        form.taxId        || null,
          bank_name:                form.bankName              || null,
          bank_account_name:        form.bankAccountName       || null,
          bank_account_number:      form.bankAccountNumber     || null,
          bank_account_type:        form.bankAccountType       || null,
          bank_routing_number:      form.bankRoutingNumber     || null,
          bank_wire_routing_number: form.bankWireRoutingNumber || null,
          bank_address:             form.bankAddress           || null,
        }, { onConflict: "id" });
      if (error) throw error;
      setStatusMsg({ text: "Company settings saved.", ok: true });
      setTimeout(() => setStatusMsg(null), 3000);
    } catch (err: any) {
      setStatusMsg({ text: `Save failed: ${err?.message ?? err}`, ok: false });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="card"><div className="muted">Loading…</div></div>;

  return (
    <div className="grid">
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
          <div>
            <h2 className="section-title" style={{ margin: 0 }}>🏢 Company Settings</h2>
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              Used in the letterhead and remit-to info on quote and invoice PDFs.
              Edit and click <strong>Save</strong> below.
            </div>
          </div>
          <div className="action-row">
            <button onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
        {statusMsg && (
          <div style={{
            marginTop: 8,
            background: statusMsg.ok ? "#eef9ee" : "#fff3f3",
            border: `1px solid ${statusMsg.ok ? "#b6e0b6" : "#e0a0a0"}`,
            color: statusMsg.ok ? "#2e6b2e" : "#a00",
            borderRadius: 6, padding: "6px 12px", fontSize: 12,
          }}>{statusMsg.text}</div>
        )}
      </div>

      <div className="card">
        <div className="grid2">
          <div>
            <label>
              <div className="muted">Company name</div>
              <input
                type="text"
                value={form.companyName}
                onChange={(e) => patch({ companyName: e.target.value })}
                placeholder="Amplified Event Solutions"
              />
            </label>
            <label style={{ marginTop: 8, display: "block" }}>
              <div className="muted">Address line 1</div>
              <input
                type="text"
                value={form.addressLine1}
                onChange={(e) => patch({ addressLine1: e.target.value })}
                placeholder="Street address"
              />
            </label>
            <label style={{ marginTop: 8, display: "block" }}>
              <div className="muted">Address line 2</div>
              <input
                type="text"
                value={form.addressLine2}
                onChange={(e) => patch({ addressLine2: e.target.value })}
                placeholder="Suite / unit (optional)"
              />
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 8, marginTop: 8 }}>
              <label>
                <div className="muted">City</div>
                <input
                  type="text"
                  value={form.city}
                  onChange={(e) => patch({ city: e.target.value })}
                />
              </label>
              <label>
                <div className="muted">State</div>
                <input
                  type="text"
                  value={form.state}
                  onChange={(e) => patch({ state: e.target.value.toUpperCase().slice(0, 2) })}
                  maxLength={2}
                  placeholder="OH"
                />
              </label>
              <label>
                <div className="muted">ZIP</div>
                <input
                  type="text"
                  value={form.zip}
                  onChange={(e) => patch({ zip: e.target.value })}
                />
              </label>
            </div>
          </div>
          <div>
            <label>
              <div className="muted">Phone</div>
              <input
                type="text"
                value={form.phone}
                onChange={(e) => patch({ phone: e.target.value })}
                placeholder="(555) 555-5555"
              />
            </label>
            <label style={{ marginTop: 8, display: "block" }}>
              <div className="muted">Email</div>
              <input
                type="email"
                value={form.email}
                onChange={(e) => patch({ email: e.target.value })}
                placeholder="info@example.com"
              />
            </label>
            <label style={{ marginTop: 8, display: "block" }}>
              <div className="muted">Website</div>
              <input
                type="text"
                value={form.website}
                onChange={(e) => patch({ website: e.target.value })}
                placeholder="example.com"
              />
            </label>
            <label style={{ marginTop: 8, display: "block" }}>
              <div className="muted">Tax ID / EIN <span style={{ fontSize: 11 }}>(optional, prints on invoices)</span></div>
              <input
                type="text"
                value={form.taxId}
                onChange={(e) => patch({ taxId: e.target.value })}
                placeholder="XX-XXXXXXX"
              />
            </label>
          </div>
        </div>

        <div className="muted" style={{ fontSize: 11, marginTop: 12 }}>
          A logo image is also part of the letterhead. Replace <code>public/branding/client-logo.png</code> in the repo to change it.
        </div>
      </div>

      <div className="card">
        <h2 className="section-title" style={{ margin: "0 0 4px" }}>🏦 Payment / Banking</h2>
        <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
          Prints in the <strong>Remit Payment To</strong> block on invoices so clients can pay by
          ACH or wire. Bank name, account holder, and account number are shared by both methods.
          Leave a field blank to omit it from the invoice.
        </div>

        <div className="grid2">
          <div>
            <label>
              <div className="muted">Bank name</div>
              <input
                type="text"
                value={form.bankName}
                onChange={(e) => patch({ bankName: e.target.value })}
                placeholder="First National Bank"
              />
            </label>
            <label style={{ marginTop: 8, display: "block" }}>
              <div className="muted">Account holder name <span style={{ fontSize: 11 }}>(beneficiary)</span></div>
              <input
                type="text"
                value={form.bankAccountName}
                onChange={(e) => patch({ bankAccountName: e.target.value })}
                placeholder="Amplified Event Solutions"
              />
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 8, marginTop: 8 }}>
              <label>
                <div className="muted">Account number</div>
                <input
                  type="text"
                  value={form.bankAccountNumber}
                  onChange={(e) => patch({ bankAccountNumber: e.target.value })}
                  placeholder="000123456789"
                />
              </label>
              <label>
                <div className="muted">Account type</div>
                <select
                  value={form.bankAccountType}
                  onChange={(e) => patch({ bankAccountType: e.target.value })}
                >
                  <option value="">—</option>
                  <option value="Checking">Checking</option>
                  <option value="Savings">Savings</option>
                </select>
              </label>
            </div>
          </div>

          <div>
            <label>
              <div className="muted">Routing number (ABA) <span style={{ fontSize: 11 }}>— for ACH</span></div>
              <input
                type="text"
                value={form.bankRoutingNumber}
                onChange={(e) => patch({ bankRoutingNumber: e.target.value })}
                placeholder="123456789"
              />
            </label>
            <label style={{ marginTop: 8, display: "block" }}>
              <div className="muted">Wire routing number <span style={{ fontSize: 11 }}>(only if different from ACH)</span></div>
              <input
                type="text"
                value={form.bankWireRoutingNumber}
                onChange={(e) => patch({ bankWireRoutingNumber: e.target.value })}
                placeholder="Leave blank if same as ACH routing"
              />
            </label>
            <label style={{ marginTop: 8, display: "block" }}>
              <div className="muted">Bank address <span style={{ fontSize: 11 }}>(for wire instructions)</span></div>
              <input
                type="text"
                value={form.bankAddress}
                onChange={(e) => patch({ bankAddress: e.target.value })}
                placeholder="123 Main St, City, ST 00000"
              />
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
