"use client";

import { useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { UserManagement } from "@/components/shared/user-management";
import PositionMaintenance from "@/components/shared/position-maintenance";

type Tab = "users" | "positions";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "users",     label: "Users",     icon: "🔐" },
  { id: "positions", label: "Positions", icon: "🏷️" },
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

      {tab === "users"     && <UserManagement />}
      {tab === "positions" && <PositionMaintenance />}
    </AppShell>
  );
}
