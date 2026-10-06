import fs from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { ScrollToHash } from "./scroll-to-hash";

// Renders HELP.md (repo root) — the user guide the topbar Help button opens.
// Read at build time like /changelog, so it always matches the deployed build.
// Deliberately WITHOUT the AppShell: crew leaders are bounced out of the admin
// shell, and help must open for every role. Content is generic by rule — no
// rates, pay or sample amounts — so it needs no per-role filtering.
// Markdown support is minimal: # / ## {#id} / ###, paragraphs, - and 1. lists,
// | tables |, **bold**, *italic*.

export const metadata = { title: "AOS Help" };

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) return <em key={i}>{part.slice(1, -1)}</em>;
    return part;
  });
}

type Section = { id: string; title: string };

function render(md: string): { title: string; sections: Section[]; body: ReactNode[] } {
  const lines = md.split("\n");
  const body: ReactNode[] = [];
  const sections: Section[] = [];
  let title = "Help";
  let key = 0;
  let i = 0;

  const cells = (row: string) => row.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();
    if (!t) { i++; continue; }

    if (t.startsWith("# ")) { title = t.slice(2); i++; continue; }

    const h2 = t.match(/^## (.+?)(?:\s*\{#([a-z-]+)\})?$/);
    if (h2) {
      const id = h2[2] || h2[1].toLowerCase().replace(/[^a-z0-9]+/g, "-");
      sections.push({ id, title: h2[1] });
      body.push(<h2 key={key++} id={id} className="help-h2">{inline(h2[1])}</h2>);
      i++; continue;
    }
    const h3 = t.match(/^### (.+?)(?:\s*\{#([a-z-]+)\})?$/);
    if (h3) { body.push(<h3 key={key++} id={h3[2]} className="help-h3">{inline(h3[1])}</h3>); i++; continue; }

    if (t.startsWith("|")) {
      const rows: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(lines[i++]);
      const [head, , ...rest] = rows;
      body.push(
        <div key={key++} className="help-table-wrap">
          <table className="help-table">
            <thead><tr>{cells(head).map((c, j) => <th key={j}>{inline(c)}</th>)}</tr></thead>
            <tbody>{rest.map((r, ri) => <tr key={ri}>{cells(r).map((c, j) => <td key={j}>{inline(c)}</td>)}</tr>)}</tbody>
          </table>
        </div>
      );
      continue;
    }

    if (/^- /.test(t) || /^\d+\. /.test(t)) {
      const ordered = /^\d+\. /.test(t);
      const items: string[] = [];
      while (i < lines.length && (ordered ? /^\d+\. /.test(lines[i].trim()) : /^- /.test(lines[i].trim()))) {
        items.push(lines[i].trim().replace(ordered ? /^\d+\. / : /^- /, ""));
        i++;
      }
      const lis = items.map((it, j) => <li key={j}>{inline(it)}</li>);
      body.push(ordered ? <ol key={key++} className="help-list">{lis}</ol> : <ul key={key++} className="help-list">{lis}</ul>);
      continue;
    }

    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#|\||- |\d+\. )/.test(lines[i].trim())) para.push(lines[i++].trim());
    body.push(<p key={key++}>{inline(para.join(" "))}</p>);
  }
  return { title, sections, body };
}

export default function HelpPage() {
  const md = fs.readFileSync(path.join(process.cwd(), "HELP.md"), "utf8");
  const { title, sections, body } = render(md);
  return (
    <div className="help-page">
      <nav className="help-toc hide-print">
        <div className="help-toc-title">{title}</div>
        {sections.map((s) => <a key={s.id} href={`#${s.id}`}>{s.title}</a>)}
      </nav>
      <ScrollToHash />
      <main className="help-body">
        <h1 className="help-h1">{title}</h1>
        {body}
      </main>
    </div>
  );
}
