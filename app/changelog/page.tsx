import fs from "node:fs";
import path from "node:path";
import { AppShell } from "@/components/layout/app-shell";

// Renders CHANGELOG.md (repo root). The file is read at build time, so the
// page always matches the deployed build — no fetch, no DB. Markdown support
// is deliberately minimal: ## month, ### date, - bullet, **bold**.

function inline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) =>
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={i}>{part.slice(2, -2)}</strong>
      : part
  );
}

export default function ChangelogPage() {
  const md = fs.readFileSync(path.join(process.cwd(), "CHANGELOG.md"), "utf8");
  const blocks: React.ReactNode[] = [];
  let bullets: string[] = [];
  let key = 0;

  const flushBullets = () => {
    if (!bullets.length) return;
    blocks.push(
      <ul key={key++} style={{ margin: "6px 0 14px", paddingLeft: 22, lineHeight: 1.55 }}>
        {bullets.map((b, i) => <li key={i} style={{ marginBottom: 4 }}>{inline(b)}</li>)}
      </ul>
    );
    bullets = [];
  };

  for (const raw of md.split("\n")) {
    const line = raw.trimEnd();
    if (line.startsWith("- ")) { bullets.push(line.slice(2)); continue; }
    flushBullets();
    if (line.startsWith("### ")) {
      blocks.push(<h3 key={key++} style={{ margin: "18px 0 2px", fontSize: 15 }}>{inline(line.slice(4))}</h3>);
    } else if (line.startsWith("## ")) {
      blocks.push(
        <h2 key={key++} style={{ margin: "28px 0 4px", fontSize: 20, borderBottom: "1px solid var(--border, #ddd)", paddingBottom: 4 }}>
          {inline(line.slice(3))}
        </h2>
      );
    } else if (line.startsWith("# ") || line === "") {
      // top title is supplied by AppShell; blank lines are just separators
    } else {
      blocks.push(<p key={key++} style={{ margin: "8px 0", color: "#666" }}>{inline(line)}</p>);
    }
  }
  flushBullets();

  return (
    <AppShell title="Change Log" subtitle="What's changed in the app, newest first.">
      <div className="card" style={{ maxWidth: 820, padding: "8px 24px 20px" }}>
        {blocks}
      </div>
    </AppShell>
  );
}
