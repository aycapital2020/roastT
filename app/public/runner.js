// Runs a council from the browser, one short API call at a time, so no server function has
// to live for the whole meeting. Emits the same events the room plays (phase, setup,
// round_start, seat_start, seat_done, round_done, cruxes, draft, verdict, error).
import { optionScores, finalNumbers, verdictSeats, DISCLAIMER } from "./engine.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const usage = { calls: 0, input: 0, output: 0 };
function tally(u = {}) {
  usage.calls++;
  usage.input += u.prompt_tokens || u.input_tokens || 0;
  usage.output += u.completion_tokens || u.output_tokens || 0;
}

async function post(path, payload, { tries = 3, signal } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    if (signal?.aborted) throw new Error("stopped");
    try {
      const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), signal });
      const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
      if (r.ok) { tally(j.usage); return j; }
      last = new Error(j.error || `HTTP ${r.status}`);
      if ([400, 401, 402, 403].includes(r.status)) break; // will not get better on retry
    } catch (e) {
      if (signal?.aborted) throw new Error("stopped");
      last = e;
    }
    await sleep(1500 * (i + 1));
  }
  throw last;
}

// What the server needs to rebuild a prompt; cards travel without their parsed extras.
const wire = (st) => ({
  prompt: st.prompt, mode: st.mode, pick: st.pick, board: st.board, seats: st.seats,
  title: st.title, decision: st.decision, brief: st.brief, options: st.options, assumptions: st.assumptions,
  weights: st.weights, cruxes: st.cruxes, pressure: st.pressure, draft: st.draft, rounds: st.rounds, scores: st.scores,
  cards: Object.fromEntries([1, 2, 3].map((r) => [r, Object.fromEntries(Object.entries(st.cards[r]).map(([k, c]) => [k, { text: c.text, parsed: { optionScores: c.parsed.optionScores, ruin: c.parsed.ruin } }]))])),
});

/**
 * @param {object} o
 * @param {string} o.prompt   the founder's decision
 * @param {"full"|"quick"} o.mode
 * @param {{pick: boolean, board: string[]}} o.table  who may sit: the Chair picks from board, or board is fixed
 * @param {(ev: object) => void} o.emit
 */
export async function runCouncil({ prompt, mode, table, emit, byKey, signal }) {
  const started = Date.now();
  const ev = (type, data = {}) => emit({ type, t: Date.now() - started, at: Date.now(), ...data });
  const chair = (step, st, extra) => post("/api/chair", { step, st: wire(st), extra }, { signal }).then((j) => j.data);
  const st = { prompt, mode, pick: table.pick, board: table.board.slice(), cards: { 1: {}, 2: {}, 3: {} }, scores: {}, rounds: [] };

  ev("phase", { phase: "setup", label: "The Chair is reading your question" });
  const setup = await chair("setup", st);
  Object.assign(st, {
    title: setup.title, decision: setup.decision, brief: setup.brief,
    options: (setup.options || []).slice(0, 4), assumptions: setup.assumptions || [],
    weights: Object.fromEntries(st.board.map((k) => [k, { weight: 1, reason: "" }])),
  });
  if (st.options.length < 2) throw new Error("The Chair could not frame at least two options. Add your options to the question and try again.");
  for (const w of setup.weights || []) if (st.weights[w.seat]) st.weights[w.seat] = { weight: Math.max(1, Math.min(3, Math.round(w.weight) || 1)), reason: w.reason || "" };
  const picked = [...new Set(setup.seats || [])].filter((k) => st.board.includes(k)).slice(0, 9);
  const full = st.pick && picked.length >= 3 ? picked : st.board.slice(0, 9);
  st.seats = mode === "quick" ? [...new Set(setup.quick_seats || [])].filter((k) => st.board.includes(k)).slice(0, 4) : full;
  if (mode === "quick" && st.seats.length < 4) for (const k of [...full, ...st.board]) if (st.seats.length < 4 && !st.seats.includes(k)) st.seats.push(k);
  st.board = st.seats.slice(); // later Chair calls only see the seats at the table
  ev("setup", { title: st.title, decision: st.decision, brief: st.brief, options: st.options, assumptions: st.assumptions, weights: st.weights, seats: st.seats, mode });

  async function round(r) {
    st.rounds.push(r);
    ev("round_start", { round: r });
    const snapshot = wire(st); // every seat in a round sees the same table
    await Promise.all(st.seats.map(async (k, i) => {
      await sleep(i * 250);
      ev("seat_start", { round: r, seat: k });
      try {
        const j = await post("/api/seat", { round: r, key: k, st: snapshot }, { signal });
        st.cards[r][k] = { text: j.text, parsed: j.parsed, quotes: j.quotes };
        ev("seat_done", { round: r, seat: k, text: j.text, parsed: j.parsed, quotes: j.quotes, name: byKey[k]?.name });
      } catch (e) {
        ev("seat_error", { round: r, seat: k, error: String(e.message || e) });
      }
    }));
    const got = st.seats.filter((k) => st.cards[r][k]).length;
    if (got < Math.min(2, st.seats.length)) throw new Error(`Round ${r} failed: only ${got} of ${st.seats.length} seats answered.`);
    st.scores[r] = optionScores(st, r);
    ev("round_done", { round: r, scores: st.scores[r] });
  }

  ev("phase", { phase: "round1", label: "Round 1: opening positions" });
  await round(1);

  ev("phase", { phase: "cruxes", label: "The Chair is finding the fault lines" });
  const cx = await chair("cruxes", st);
  st.cruxes = cx.cruxes || [];
  st.pressure = Object.fromEntries((cx.pressure || []).map((p) => [p.seat, p.ask]));
  ev("cruxes", { cruxes: st.cruxes, unanimous: Boolean(cx.unanimous), note: cx.note || "", pressure: st.pressure });

  ev("phase", { phase: "round2", label: "Round 2: the debate" });
  await round(2);

  const s2 = st.scores[2];
  const top2 = Object.entries(s2).sort((a, b) => (b[1].score ?? 0) - (a[1].score ?? 0))[0][0];
  const vals = st.seats.map((k) => st.cards[2][k]?.parsed.optionScores[top2]).filter((v) => typeof v === "number");
  const spread = vals.length ? Math.max(...vals) - Math.min(...vals) : 0;
  const ruin = st.seats.some((k) => st.cards[2][k]?.parsed.ruin === "likely");
  const skip3 = mode === "quick" && spread <= 3 && !ruin;

  if (!skip3) {
    ev("phase", { phase: "draft", label: "The Chair is drafting a resolution" });
    st.draft = await chair("draft", st, { interim: s2 });
    ev("draft", { draft: st.draft });
    ev("phase", { phase: "round3", label: "Round 3: the vote" });
    await round(3);
  } else {
    ev("phase", { phase: "skip3", label: `Quick mode: spread ${spread} and no ruin risk, so the vote round is skipped` });
  }

  const { last, finalScores, recommended, spreadF, confidence, support, votes } = finalNumbers(st);
  ev("phase", { phase: "verdict", label: "The Chair is writing the verdict" });
  const v = await chair("verdict", st, { finalScores, recommended });
  st.verdict = { ...v, recommended, scores: finalScores, spread: spreadF, confidence, support, votes, disclaimer: DISCLAIMER };
  ev("verdict", { verdict: st.verdict, seats: verdictSeats(st, last) });
  return { st, ms: Date.now() - started };
}

// ---------------------------------------------------------------- saved sessions (this browser)
// The sidebar lists these. Index entries: { id, title, name?, prompt, mode, status, created }.
// `name` is a title the user typed (rename); `created` is ms since epoch, for the date groups.
const INDEX = "roastroom:sessions";
const KEY = (id) => `roastroom:s:${id}`;
const VERSION_KEY = "roastroom:sessions:v";
export const MAX_SAVED = 100;

// ids look like 2026-10-28-<Date.now() in base 36>; older ones may only carry the date
export function createdFromId(id) {
  const m = String(id).match(/^(\d{4}-\d{2}-\d{2})(?:-([0-9a-z]+))?/);
  if (!m) return 0;
  const t = m[2] ? parseInt(m[2], 36) : NaN;
  if (Number.isFinite(t) && t > 1.5e12 && t < 4e12) return t;
  return new Date(`${m[1]}T12:00:00`).getTime() || 0;
}

export function listLocal() {
  let list;
  try { list = JSON.parse(localStorage.getItem(INDEX) || "[]"); } catch { list = []; }
  if (!Array.isArray(list)) return [];
  return list.filter((x) => x && x.id).map((x) => ({ ...x, created: x.created || createdFromId(x.id) }));
}

function writeIndex(list) { localStorage.setItem(INDEX, JSON.stringify(list)); }

/** One-time upgrade of councils saved by the old "Past sessions" list (last 25, no dates). */
export function migrateLocal() {
  try {
    if (localStorage.getItem(VERSION_KEY) === "2") return;
    const list = listLocal()
      .map((x) => ({ ...x, created: x.created || loadLocal(x.id)?.started || createdFromId(x.id) }))
      .filter((x) => localStorage.getItem(KEY(x.id)) !== null) // drop index rows whose council is gone
      .sort((a, b) => b.created - a.created);
    writeIndex(list.slice(0, MAX_SAVED));
    localStorage.setItem(VERSION_KEY, "2");
  } catch { /* storage unavailable: nothing to migrate */ }
}

export function loadLocal(id) {
  try { return JSON.parse(localStorage.getItem(KEY(id)) || "null"); } catch { return null; }
}

export function saveLocal(s) {
  const old = listLocal().find((x) => x.id === s.id);
  const meta = { id: s.id, title: s.title || s.prompt.slice(0, 60), prompt: s.prompt, mode: s.mode, status: s.status, created: old?.created || s.started || createdFromId(s.id) };
  if (old?.name) meta.name = old.name;
  let list = [meta, ...listLocal().filter((x) => x.id !== s.id)];
  while (list.length > MAX_SAVED) localStorage.removeItem(KEY(list.pop().id));
  for (;;) {
    try {
      localStorage.setItem(KEY(s.id), JSON.stringify(s));
      writeIndex(list);
      return true;
    } catch {
      // storage full: drop the oldest saved council and try again
      if (list.length <= 1) return false;
      localStorage.removeItem(KEY(list.pop().id));
    }
  }
}

/** Give a saved council a title of your own. An empty name goes back to the Chair's title. */
export function renameLocal(id, name) {
  const clean = String(name || "").replace(/\s+/g, " ").trim().slice(0, 120);
  const list = listLocal().map((x) => {
    if (x.id !== id) return x;
    const { name: _old, ...rest } = x;
    return clean && clean !== x.title ? { ...rest, name: clean } : rest;
  });
  try { writeIndex(list); return true; } catch { return false; }
}

export function deleteLocal(id) {
  localStorage.removeItem(KEY(id));
  writeIndex(listLocal().filter((x) => x.id !== id));
}
