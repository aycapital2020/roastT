// The council's server side, as three small stateless calls the browser orchestrates:
//   GET  /api/config  models in use and how the Gateway is authenticated
//   POST /api/chair   { step: setup|cruxes|draft|verdict, st, extra }  -> the Chair's JSON
//   POST /api/seat    { round, key, st }                                -> one seat's card
// Each call is one model request, so no function runs longer than a single answer.
// Shared by the Vercel functions in /api and the local server (app/server.mjs).
import { byKey, systemFor, parseCard, checkQuotes, loadRoster } from "./seats.mjs";
import { chairSystem, chairStep, ROUND_PROMPT, SEAT_MAX_TOKENS } from "../public/engine.js";
import * as gw from "./gateway.mjs";

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const bad = (msg, status = 400) => json({ error: msg }, status);

async function body(req) {
  const t = await req.text();
  if (t.length > 1_000_000) throw Object.assign(new Error("request too large"), { status: 413 });
  return t ? JSON.parse(t) : {};
}

// Seat keys and text sizes come from the browser, so check them before they reach a prompt.
function checkState(st, { needSeats = true } = {}) {
  if (!st || typeof st !== "object") return "missing council state";
  if (typeof st.prompt !== "string" || st.prompt.trim().length < 10) return "the decision is too short";
  if (st.prompt.length > 4000) return "the decision is too long (4,000 characters max)";
  if (!Array.isArray(st.board) || !st.board.length || st.board.some((k) => !byKey[k])) return "unknown seat on the board";
  if (needSeats && (!Array.isArray(st.seats) || st.seats.some((k) => !byKey[k]))) return "unknown seat at the table";
  return null;
}

export function config(req) {
  loadRoster();
  return json({ models: gw.MODELS, auth: gw.authMode(req), gateway: gw.GATEWAY_URL });
}

export async function chair(req) {
  try {
    loadRoster();
    const { step, st, extra } = await body(req);
    const err = checkState(st, { needSeats: step !== "setup" });
    if (err) return bad(err);
    const c = chairStep(step, st, extra || {});
    const t0 = Date.now();
    const r = await gw.json({ model: gw.MODELS.chair, system: chairSystem(st), prompt: c.prompt, schema: c.schema, name: c.name, maxTokens: c.maxTokens * 3, token: gw.authToken(req) });
    return json({ data: r.data, usage: r.usage, model: r.model, ms: Date.now() - t0 });
  } catch (e) {
    return bad(String(e.message || e), e.status && e.status >= 400 ? (e.status === 401 || e.status === 403 || e.status === 402 ? e.status : 502) : 500);
  }
}

export async function seat(req) {
  try {
    loadRoster();
    const { round, key, st } = await body(req);
    const err = checkState(st);
    if (err) return bad(err);
    if (!st.seats.includes(key)) return bad("that seat is not at the table");
    const fn = ROUND_PROMPT[round];
    if (!fn) return bad("round must be 1, 2, or 3");
    const t0 = Date.now();
    const r = await gw.text({ model: gw.MODELS.seat, system: systemFor(key), prompt: fn(st, byKey[key]), maxTokens: SEAT_MAX_TOKENS, token: gw.authToken(req) });
    const parsed = parseCard(r.text, st.options.map((o) => o.id));
    const quotes = checkQuotes(key, r.text);
    return json({ text: r.text, parsed, quotes, usage: r.usage, model: r.model, ms: Date.now() - t0 });
  } catch (e) {
    return bad(String(e.message || e), e.status && e.status >= 400 ? (e.status === 401 || e.status === 403 || e.status === 402 ? e.status : 502) : 500);
  }
}
