// Replay events.jsonl → projection.json.
//
// The projection is a pure fold over the log: same log in, same projection out, always. That
// property is the whole point — it means the log is the truth and the projection is a cache you
// can delete. `bun state/rebuild.ts --verify` asserts determinism by folding twice.
//
// Usage:
//   bun state/rebuild.ts            # rebuild projection.json
//   bun state/rebuild.ts --verify   # rebuild twice + check the hash chain; non-zero exit on drift

import { writeFileSync } from "fs";
import { join } from "path";
import { readAll, verify, STATE_DIR, type LogEvent } from "./log";
import { EMPTY_APPLICATION, toApplication } from "./schema.js";
import { toCanonical } from "../src/lib/machine.js";

export const PROJECTION_PATH = join(STATE_DIR, "projection.json");
export const QUEUE_PATH = join(STATE_DIR, "queue.json");

export interface Projection {
  applications: Record<string, any>;
  /** Open interrupts, keyed by interrupt id. Resolved ones are removed. */
  interrupts: Record<string, any>;
  lastSeq: number;
}

export function fold(events: LogEvent[]): Projection {
  const applications: Record<string, any> = {};
  const interrupts: Record<string, any> = {};

  const ensure = (id?: string) => {
    if (!id) return null;
    if (!applications[id]) applications[id] = { ...EMPTY_APPLICATION, id };
    return applications[id];
  };

  for (const e of events) {
    const app = ensure(e.applicationId);

    switch (e.type) {
      case "discovered": {
        const rec = toApplication({ ...(e.data as any), id: e.applicationId });
        applications[rec.id] = { ...(applications[rec.id] ?? {}), ...rec, discoveredAt: rec.discoveredAt ?? e.at };
        break;
      }
      case "eligibility_screened": {
        if (app) app.eligibility = { ...app.eligibility, ...(e.data as any) };
        break;
      }
      case "state_changed": {
        if (app) app.workflowState = toCanonical((e.data as any).to);
        break;
      }
      case "form_mapped": {
        if (app) {
          const prompts = (e.data as any).essayPrompts ?? [];
          if (prompts.length) app.requirements = { ...app.requirements, essayPrompts: prompts };
          app.platform = (e.data as any).platform ?? app.platform;
          app.lastMappedAt = e.at;
        }
        break;
      }
      case "form_filled":
      case "submitted": {
        if (app) {
          app.lastRunAt = e.at;
          if (e.type === "submitted") app.submittedAt = e.at;
        }
        break;
      }
      case "artifact_added": {
        if (app) app.artifacts = [...(app.artifacts ?? []), e.data];
        break;
      }
      case "interrupt_raised": {
        const d = e.data as any;
        interrupts[d.id] = {
          id: d.id,
          type: d.type,
          applicationId: e.applicationId ?? null,
          context: d.context ?? {},
          raisedAt: e.at,
        };
        break;
      }
      case "interrupt_resolved": {
        const d = e.data as any;
        delete interrupts[d.id];
        break;
      }
      // field_read / capability_denied / field_filled / field_skipped are audit-only: they exist
      // to answer "why did this value go into that box", not to move state.
      default:
        break;
    }
  }

  return { applications, interrupts, lastSeq: events.length ? events[events.length - 1].seq : 0 };
}

function write(p: Projection) {
  writeFileSync(PROJECTION_PATH, JSON.stringify(p, null, 2) + "\n", "utf8");
  writeFileSync(QUEUE_PATH, JSON.stringify(Object.values(p.interrupts), null, 2) + "\n", "utf8");
}

if (import.meta.main) {
  const events = readAll();
  const chain = verify();
  if (!chain.ok) {
    console.error(`✗ hash chain broken at seq ${chain.brokenAtSeq}: ${chain.reason}`);
    process.exit(1);
  }

  const first = fold(events);
  write(first);

  if (process.argv.includes("--verify")) {
    const second = fold(readAll());
    const a = JSON.stringify(first);
    const b = JSON.stringify(second);
    if (a !== b) {
      console.error("✗ fold is not deterministic — two replays of the same log disagree.");
      process.exit(1);
    }
    console.log(`✓ chain intact, fold deterministic (${events.length} events)`);
  }

  console.log(
    `Rebuilt ${Object.keys(first.applications).length} applications, ` +
      `${Object.keys(first.interrupts).length} open interrupts → ${PROJECTION_PATH}`,
  );
}
