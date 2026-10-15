// Deadline digest + .ics export — Phase 1 of the gap-close plan.
//
// The projection already parses `deadlineISO` (state/schema.js) and already knows terminal
// states (src/lib/machine.js `TERMINAL`). Nothing reads that back out as "what's due soon" —
// this file is that read, plus an optional calendar export. No new dependency: RFC 5545 is a
// flat text format, not worth pulling in a library for one VEVENT-per-deadline.
//
// Usage:
//   bun state/deadlines.ts                 # console digest, next 30 days + overdue
//   bun state/deadlines.ts --days 60        # widen the window
//   bun state/deadlines.ts --ics out.ics    # also write an importable calendar file

import { writeFileSync, readFileSync, existsSync } from "fs";
import { PROJECTION_PATH, type Projection } from "./rebuild";
import { TERMINAL } from "../src/lib/machine.js";

export interface DeadlineEntry {
  id: string;
  name: string;
  amount: number | null;
  deadlineISO: string;
  workflowState: string;
  daysRemaining: number;
  essayPromptCount: number;
  applyUrl: string | null;
}

function loadProjection(): Projection {
  return JSON.parse(readFileSync(PROJECTION_PATH, "utf8"));
}

function daysBetween(fromISO: string, toISO: string): number {
  const MS_PER_DAY = 86_400_000;
  return Math.round((Date.parse(toISO) - Date.parse(fromISO)) / MS_PER_DAY);
}

/** Applications with a parsed deadline, not yet in a terminal state, within [-∞, windowDays]. */
export function upcomingDeadlines(projection: Projection, windowDays: number, todayISO: string): DeadlineEntry[] {
  const entries: DeadlineEntry[] = [];
  for (const app of Object.values<any>(projection.applications)) {
    if (!app.deadlineISO) continue;
    if (TERMINAL.has(app.workflowState)) continue;
    const daysRemaining = daysBetween(todayISO, app.deadlineISO);
    if (daysRemaining > windowDays) continue;
    entries.push({
      id: app.id,
      name: app.name,
      amount: app.amount,
      deadlineISO: app.deadlineISO,
      workflowState: app.workflowState,
      daysRemaining,
      essayPromptCount: (app.requirements?.essayPrompts ?? []).length,
      applyUrl: app.applyUrl ?? app.url ?? null,
    });
  }
  return entries.sort((a, b) => a.daysRemaining - b.daysRemaining);
}

function bucketOf(daysRemaining: number): "overdue" | "this_week" | "this_month" | "later" {
  if (daysRemaining < 0) return "overdue";
  if (daysRemaining <= 7) return "this_week";
  if (daysRemaining <= 30) return "this_month";
  return "later";
}

function printDigest(entries: DeadlineEntry[]) {
  if (!entries.length) {
    console.log("No open applications with a parsed deadline in this window.");
    return;
  }
  const buckets = { overdue: [] as DeadlineEntry[], this_week: [] as DeadlineEntry[], this_month: [] as DeadlineEntry[], later: [] as DeadlineEntry[] };
  for (const e of entries) buckets[bucketOf(e.daysRemaining)].push(e);

  const labels: Record<string, string> = {
    overdue: "⚠ OVERDUE",
    this_week: "DUE THIS WEEK",
    this_month: "DUE THIS MONTH",
    later: "LATER",
  };

  for (const key of ["overdue", "this_week", "this_month", "later"] as const) {
    const list = buckets[key];
    if (!list.length) continue;
    console.log(`\n${labels[key]} (${list.length})`);
    for (const e of list) {
      const amt = e.amount != null ? `$${e.amount}` : "?";
      const essayNote = e.essayPromptCount ? `${e.essayPromptCount} essay${e.essayPromptCount > 1 ? "s" : ""}` : "no essay";
      console.log(
        `  ${String(e.daysRemaining).padStart(4)}d  ${amt.padEnd(8)} ${e.workflowState.padEnd(20)} ${essayNote.padEnd(10)} ${e.name.slice(0, 50)}`,
      );
    }
  }
  console.log(`\n${entries.length} total in window.`);
}

// Minimal RFC 5545 escaping: backslash, comma, semicolon, and literal newlines.
function icsEscape(s: string): string {
  return String(s).replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\n/g, "\\n");
}

function toIcsDate(iso: string): string {
  return iso.replace(/-/g, "");
}

function buildIcs(entries: DeadlineEntry[]): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//colin-s-college-pathway//deadlines//EN", "CALSCALE:GREGORIAN"];
  for (const e of entries) {
    const amt = e.amount != null ? `$${e.amount}` : "amount unknown";
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.id}@colin-s-college-pathway`,
      `DTSTART;VALUE=DATE:${toIcsDate(e.deadlineISO)}`,
      `DTEND;VALUE=DATE:${toIcsDate(e.deadlineISO)}`,
      `SUMMARY:${icsEscape(`Scholarship deadline: ${e.name}`)}`,
      `DESCRIPTION:${icsEscape(`${amt} — status ${e.workflowState}${e.applyUrl ? ` — ${e.applyUrl}` : ""}`)}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const windowDays = Number(flag("--days") ?? 30);
  const icsPath = flag("--ics");

  if (!existsSync(PROJECTION_PATH)) {
    console.log(`No projection at ${PROJECTION_PATH} yet — run \`bun state/rebuild.ts\` first.`);
    process.exit(0);
  }

  const projection = loadProjection();
  const todayISO = new Date().toISOString().slice(0, 10);
  const entries = upcomingDeadlines(projection, windowDays, todayISO);

  printDigest(entries);

  if (icsPath) {
    writeFileSync(icsPath, buildIcs(entries), "utf8");
    console.log(`\nWrote ${entries.length} event(s) → ${icsPath}`);
  }
}
