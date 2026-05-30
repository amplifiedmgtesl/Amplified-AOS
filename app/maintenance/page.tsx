"use client";

import { useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { UserManagement } from "@/components/shared/user-management";
import PositionMaintenance from "@/components/shared/position-maintenance";
import MasterRateCardEditor from "@/components/shared/master-rate-card-editor";
import CompanySettingsEditor from "@/components/shared/company-settings-editor";

type Tab = "users" | "positions" | "master_rate_card" | "company_settings";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "users",             label: "Users",             icon: "🔐" },
  { id: "positions",         label: "Positions",         icon: "🏷️" },
  { id: "master_rate_card",  label: "Master Rate Card",  icon: "🔧" },
  { id: "company_settings",  label: "Company Info",      icon: "🏢" },
];

export default function MaintenancePage() {
  const [tab, setTab] = useState<Tab>("users");

  return (
    <AppShell title="Maintenance" subtitle="Manage users and reference data">
      <div className="card hide-print" style={{ marginBottom: 16 }}>
        <div className="action-row" style={{ gap: 8 }}>
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={tab === t.id ? "" : "secondary"}
              style={{ minWidth: 130 }}
            >
              <span style={{ marginRight: 6 }}>{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "users"             && <UserManagement />}
      {tab === "positions"         && <PositionMaintenance />}
      {tab === "master_rate_card"  && <MasterRateCardEditor />}
      {tab === "company_settings"  && <CompanySettingsEditor />}
    </AppShell>
  );
}
