// Loaded before every test file (see bunfig.toml). Redirects the append-only event log to a
// throwaway path so running the suite cannot pollute or corrupt state/events.jsonl.
import { tmpdir } from "os";
import { join } from "path";
import { rmSync } from "fs";

const scratch = join(tmpdir(), `ccp-test-events-${process.pid}.jsonl`);
process.env.CCP_EVENTS_PATH = scratch;

const { setEventsPath } = await import("./state/log");
setEventsPath(scratch);

process.on("exit", () => { try { rmSync(scratch, { force: true }); } catch {} });
