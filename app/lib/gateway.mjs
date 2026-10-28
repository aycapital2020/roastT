// Every seat and the Chair run on xAI Grok through Vercel AI Gateway's OpenAI-compatible
// endpoint. Auth: AI_GATEWAY_API_KEY if set, else the project's OIDC token (on Vercel the
// x-vercel-oidc-token request header, or VERCEL_OIDC_TOKEN, e.g. after `vercel env pull`).
// MOCK_MODEL=1 swaps the Gateway for canned answers, for offline end-to-end tests.
import { env } from "./env.mjs";

export const GATEWAY_URL = (env("AI_GATEWAY_BASE_URL") || "https://ai-gateway.vercel.sh/v1").replace(/\/$/, "");

export const MODELS = {
  seat: env("SEAT_MODEL") || "spacexai/grok-4.20-non-reasoning",
  chair: env("CHAIR_MODEL") || "spacexai/grok-4.3",
};

export const isMock = () => /^(1|true|yes)$/i.test(env("MOCK_MODEL"));

export function authToken(req) {
  return env("AI_GATEWAY_API_KEY") || req?.headers?.get?.("x-vercel-oidc-token") || req?.headers?.["x-vercel-oidc-token"] || env("VERCEL_OIDC_TOKEN") || "";
}

export function authMode(req) {
  if (isMock()) return "mock";
  if (env("AI_GATEWAY_API_KEY")) return "api-key";
  if (authToken(req)) return "oidc";
  return process.env.VERCEL ? "oidc" : "none"; // on Vercel the token arrives with each request
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(body, token) {
  if (!token) throw new Error("No AI Gateway credentials: set AI_GATEWAY_API_KEY, or run on Vercel (OIDC), or `vercel env pull` for VERCEL_OIDC_TOKEN.");
  let last;
  for (let attempt = 0; attempt < 4; attempt++) {
    let res;
    try {
      res = await fetch(`${GATEWAY_URL}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
    } catch (e) {
      last = new Error(`AI Gateway unreachable: ${e.message || e}`);
      await sleep(800 * 2 ** attempt);
      continue;
    }
    const text = await res.text();
    if (res.ok) {
      const j = JSON.parse(text);
      const msg = j.choices?.[0]?.message || {};
      return { content: typeof msg.content === "string" ? msg.content : (msg.content || []).map((p) => p.text || "").join(""), usage: j.usage || {}, model: j.model || body.model, finish: j.choices?.[0]?.finish_reason };
    }
    let detail = text.slice(0, 600);
    try { const e = JSON.parse(text); detail = e.error?.message || e.message || detail; } catch {}
    last = Object.assign(new Error(`AI Gateway ${res.status}: ${detail}`), { status: res.status });
    if (res.status !== 429 && res.status < 500) break; // auth, billing, bad request: retrying will not help
    await sleep(Number(res.headers.get("retry-after")) * 1000 || 1000 * 2 ** attempt);
  }
  throw last;
}

/** Plain text completion (a seat's card). */
export async function text({ model = MODELS.seat, system, prompt, maxTokens = 1400, token }) {
  if (isMock()) return mockText(prompt);
  const r = await call({ model, max_tokens: maxTokens, temperature: 0.8, messages: [{ role: "system", content: system }, { role: "user", content: prompt }] }, token);
  if (!r.content.trim()) throw new Error(`${model} returned an empty answer`);
  return { text: r.content.trim(), usage: r.usage, model: r.model };
}

/** Structured JSON completion against a strict JSON schema (the Chair). */
export async function json({ model = MODELS.chair, system, prompt, schema, name = "result", maxTokens = 3000, token }) {
  if (isMock()) return mockJson(schema);
  const body = {
    model, max_tokens: maxTokens,
    messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
    response_format: { type: "json_schema", json_schema: { name, strict: true, schema } },
  };
  let r = await call(body, token);
  let data = parseJson(r.content);
  if (!data) { // one retry with a firmer nudge if the model wrapped or cut its JSON
    body.messages.push({ role: "assistant", content: r.content.slice(0, 2000) }, { role: "user", content: "That was not valid JSON for the schema. Reply with only the complete JSON object." });
    body.max_tokens = Math.round(maxTokens * 1.5);
    r = await call(body, token);
    data = parseJson(r.content);
  }
  if (!data) throw new Error(`${model} did not return valid JSON (${r.finish || "unknown finish"})`);
  return { data, usage: r.usage, model: r.model };
}

function parseJson(t) {
  if (!t) return null;
  try { return JSON.parse(t); } catch {}
  const m = t.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}

// ---------------------------------------------------------------- mock model
const MOCK_DELAY = () => sleep(Number(env("MOCK_DELAY_MS") || 250));
let mockN = 0;

async function mockText(prompt) {
  await MOCK_DELAY();
  const ids = [...(prompt.match(/OPTION SCORES: ([^\n]+)/)?.[1] || "A n/10").matchAll(/\b([A-D]) n\/10/g)].map((m) => m[1]);
  const seat = prompt.match(/You hold the (.+?) seat/)?.[1] || "SEAT";
  const n = mockN++;
  const sc = ids.map((id, i) => `${id} ${(3 + ((n + i * 3) % 7))}/10`).join(" · ");
  const r = /ROUND 3/.test(prompt) ? 3 : /ROUND 2/.test(prompt) ? 2 : 1;
  const card = r === 1
    ? `SEAT: ${seat}\nSTANCE: Conditional yes\nOPTION SCORES: ${sc}\nPILLAR SCORE: 7/10\nCONFIDENCE: 4/5\nRUIN RISK: none\nDOOR: two-way\n\nTHE CALL: Take option ${ids[0]}, but test it small first.\nWHY:\n1. Mock argument one (Mock Framework, S001)\n2. Mock argument two.\n3. Mock argument three.\nTHE RISK I SEE: The mock risk.\nWHAT WOULD CHANGE MY MIND: A mock number.\nWHAT I'D DO THIS WEEK: Run the mock test.\nQUESTION FOR THE FOUNDER: What is the mock number?`
    : r === 2
      ? `SEAT: ${seat}\nI DISAGREE MOST WITH: Buffett. Mock rebuttal.\nI CONCEDE: Nothing, because the mock point fails.\nON THE CRUXES: Mock answer.\nSTANCE: Yes\nOPTION SCORES: ${sc}\nPILLAR SCORE: 7/10\nCONFIDENCE: 4/5\nRUIN RISK: none\nMOVED: no\nMY CONDITIONS FOR YES: 1. Mock condition by day 30.`
      : `SEAT: ${seat}\nVOTE: Endorse\nOPTION SCORES: ${sc}\nFINAL SCORE: 8/10\nFINAL PILLAR SCORE: 7/10\nAMENDMENT OR DISSENT:\nONE LINE FOR THE FOUNDER: Mock line for the founder.`;
  return { text: card, usage: { prompt_tokens: 1000, completion_tokens: 200 }, model: "mock" };
}

function mockValue(s, key) {
  if (s.enum) return s.enum[0];
  switch (s.type) {
    case "string": return `Mock ${key || "text"}.`;
    case "number": return 7;
    case "integer": return key === "weight" ? 2 : 1;
    case "boolean": return false;
    case "array": {
      const it = s.items;
      if (it.enum) return it.enum.slice(0, 9);
      const en = it.type === "object" && Object.entries(it.properties).find(([, v]) => v.enum);
      if (en) {
        const vals = en[1].enum.join() === "A,B,C,D" ? ["A", "B", "C"] : /GO/.test(en[1].enum[0]) ? [en[1].enum[0]] : en[1].enum.slice(0, 9);
        return vals.map((v) => ({ ...mockValue(it), [en[0]]: v }));
      }
      return [mockValue(it, key), mockValue(it, key)];
    }
    case "object": return Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, mockValue(v, k)]));
  }
  return null;
}

async function mockJson(schema) {
  await MOCK_DELAY();
  return { data: mockValue(schema), usage: { prompt_tokens: 2000, completion_tokens: 500 }, model: "mock" };
}
