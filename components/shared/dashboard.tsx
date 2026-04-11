
import Link from "next/link";

const cards = [
  { href: "/master-calendar", icon: "🗓️", title: "Master Calendar", text: "Schedule jobs, hover for details, click into job profiles, and move fast with prior-data dropdowns." },
  { href: "/quote-builder", icon: "🧾", title: "Quote Builder", text: "Build detailed quotes from rate-card pricing and optionally include timekeeping detail and e-signature." },
  { href: "/invoices", icon: "💵", title: "Invoices", text: "Generate professional invoice PDFs using quote and timekeeping detail." },
  { href: "/job-sheets", icon: "📑", title: "Job Sheets", text: "Create job sheets from events, add drawings and notes, and manage linked workers." },
  { href: "/timekeeping", icon: "⏱️", title: "Timekeeping", text: "Grid-style labor tracking with payroll math, job-sheet linking, and print-ready output." },
  { href: "/job-costing", icon: "📈", title: "Job Costing", text: "Link jobs, quotes, rate cards, job sheets, and timekeeping to compare quoted revenue against actual cost and margin." },
  { href: "/employee-directory", icon: "👥", title: "Employee Directory", text: "Search the national directory, import crew, manage profiles, notes, files, and add workers with one click." },
  { href: "/rate-card", icon: "📋", title: "Rate Card", text: "Control client-facing rates, OT/DT logic, travel, and terms in one place." },
  { href: "/job-requests", icon: "📨", title: "Job Requests", text: "Capture incoming jobs, location links, packet files, and quick scheduling info." },
];

export default function DashboardCards() {
  return (
    <div className="grid">
      <div className="card" style={{ padding: 24 }}>
        <div className="grid4">
          <div className="metric-card"><div className="metric-label">System</div><div className="metric-value" style={{ fontSize: 24 }}>Clean Rebuild</div></div>
          <div className="metric-card"><div className="metric-label">Calendar</div><div className="metric-value" style={{ fontSize: 24 }}>Google Style</div></div>
          <div className="metric-card"><div className="metric-label">Billing</div><div className="metric-value" style={{ fontSize: 24 }}>Quotes + Invoices</div></div>
          <div className="metric-card"><div className="metric-label">Labor</div><div className="metric-value" style={{ fontSize: 24 }}>Directory + Timekeeping</div></div>
        </div>
      </div>

      <div className="grid4">
        {cards.map((card) => (
          <div key={card.href} className="link-grid">
            <Link href={card.href}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>{card.icon}</div>
              <strong>{card.title}</strong>
              <div className="muted" style={{ marginTop: 8 }}>{card.text}</div>
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
