// End-to-end check: starts the local server and runs whole councils through the real
// /api/chair and /api/seat handlers with the browser's runner.
//   npm test                 mocked model (MOCK_MODEL=1), no Gateway calls
//   LIVE=1 npm test          real Gateway calls (quick council), needs credentials
//   BASE=https://... LIVE=1  run against a deployed URL instead of a local server
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const live = process.env.LIVE === "1";
let base = process.env.BASE;
let child;
if (!base) {
  const port = 4800 + Math.floor(Math.random() * 100);
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ["app/server.mjs"], { cwd: root, env: { ...process.env, PORT: String(port), MOCK_MODEL: live ? "" : "1", MOCK_DELAY_MS: "20" }, stdio: ["ignore", "pipe", "inherit"] });
  await new Promise((res) => child.stdout.on("data", (d) => /Roast Room on/.test(d) && res()));
}
const headers = process.env.BYPASS ? { "x-vercel-protection-bypass": process.env.BYPASS } : {};
const realFetch = globalThis.fetch;
globalThis.fetch = (u, o = {}) => realFetch(String(u).startsWith("/") ? base + u : u, { ...o, headers: { ...(o.headers || {}), ...headers } });

const { runCouncil, usage } = await import("../public/runner.js");
const roster = await (await fetch("/data/roster.json")).json().catch(() => null);
const config = await (await fetch("/api/config")).json();
console.log("config", config);
const byKey = Object.fromEntries((roster?.seats || []).map((s) => [s.key, s]));
const all = Object.keys(byKey);

const prompt = process.env.PROMPT || "I run a coaching business doing $30k a month with 15 clients at $2,000 each. Should I raise to $3,500 for everyone, raise for new clients only, or keep $2,000? Close rate is about 50% and I have $40k in the bank.";
const cases = live ? [["quick", { pick: true, board: all }]] : [
  ["full", { pick: true, board: all }],
  ["quick", { pick: false, board: roster.board.default }],
  ["full", { pick: false, board: ["hormozi", "buffett", "naval"] }],
];
let failed = 0;
for (const [mode, table] of cases) {
  const seen = [];
  const errors = [];
  const t0 = Date.now();
  try {
    const { st } = await runCouncil({ prompt, mode, table, byKey, emit: (e) => { seen.push(e.type); if (e.type === "seat_error") errors.push(e.error); } });
    const v = st.verdict;
    const ok = v && v.label && st.seats.length >= 3 && seen.includes("verdict") && !errors.length;
    console.log(`${ok ? "PASS" : "FAIL"} ${mode} pick=${table.pick} seats=${st.seats.join(",")} rounds=${st.rounds.join("")} -> ${v.label} on ${v.recommended} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    if (live) console.log(JSON.stringify({ label: v.label, recommended: v.recommended, call: v.call, options: st.options, why: (v.why || []).map((w) => w.point), conditions: v.conditions, kill: v.kill_criteria }, null, 1));
    if (errors.length) console.log("  seat errors:", errors);
    if (!ok) failed++;
  } catch (e) {
    failed++;
    console.log(`FAIL ${mode}: ${e.message}`);
  }
}
console.log("usage", usage);
child?.kill();
process.exit(failed ? 1 : 0);
