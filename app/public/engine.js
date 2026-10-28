// The council's shared engine: prompts, JSON schemas, and scoring math. Pure JavaScript with
// no imports, so the browser (which runs the council round by round) and the server
// functions (which build each prompt and call the model) use the exact same rules.

export const DISCLAIMER = "Simulated advisors built from each person's public work. They are not the people and do not speak for them.";

// The seat roster, keyed by seat key. Both sides fill it once from the roster data.
export const byKey = {};
export function setRoster(seats) {
  for (const k of Object.keys(byKey)) delete byKey[k];
  for (const s of seats) byKey[s.key] = s;
}

// ---------------------------------------------------------------- JSON schema helpers
// Strict structured output: every property required, no extras.
export const S = {
  str: { type: "string" },
  num: { type: "number" },
  int: { type: "integer" },
  bool: { type: "boolean" },
  arr: (items) => ({ type: "array", items }),
  obj: (properties) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false }),
  enum: (...values) => ({ type: "string", enum: values }),
};

export function chairSystem(st) {
  const seats = st.board.map((k) => byKey[k]).filter(Boolean);
  return `You are the Chair of a Roast Room council: ${seats.length} simulated advisors built from the public work of ${seats.map((x) => `${x.name} (${x.pillar.toLowerCase()})`).join(", ")}.
You never argue a side and never add your own pillar. You run the room, keep score, and write in plain English: short sentences, no em dashes, no hype, no tee-ups like "here's the thing", no filler. Seat keys (for key fields only): ${seats.map((x) => x.key).join(", ")}. Whenever you write a seat's name in prose or in a seat field, use its display name: ${seats.map((x) => x.short).join(", ")}.`;
}

// ---------------------------------------------------------------- seat prompts
export function briefBlock(st) {
  const opts = st.options.map((o) => `(${o.id}) ${o.label}`).join("\n");
  return `THE DECISION: ${st.decision}\n\nOPTIONS:\n${opts}\n\n${st.brief}\n\nAssumptions the Chair made (marked as assumed; challenge them if they matter):\n${st.assumptions.map((a) => `- ${a}`).join("\n")}`;
}
const optLine = (st) => st.options.map((o) => `${o.id} n/10`).join(" · ");

export function round1Prompt(st, seat) {
  const w = st.weights[seat.key];
  return `ROAST ROOM COUNCIL, ROUND 1 OF 3: OPENING POSITION

You hold the ${seat.short.toUpperCase()} seat (${seat.pillar}).

THE BRIEF
${briefBlock(st)}

Your weight on this decision: ${w.weight}/3 (${w.reason}).

Answer in your seat's voice, first person, plain text, under 300 words, in exactly this shape:

SEAT: ${seat.short.toUpperCase()} (${seat.pillar})
STANCE: Strong yes | Yes | Conditional yes | No | Strong no   (on the option you recommend)
OPTION SCORES: ${optLine(st)}
PILLAR SCORE: n/10   (${seat.dimension}: the option you recommend, judged on your pillar alone)
CONFIDENCE: n/5
RUIN RISK: none | possible | likely
DOOR: one-way | two-way

THE CALL: one sentence, naming the option or a variant.
WHY:
1. argument, naming the framework or principle you used and its source id, e.g. (Value Equation, S014)
2. ...
3. ...
THE RISK I SEE: the single biggest thing that goes wrong.
WHAT WOULD CHANGE MY MIND: a concrete fact or number.
WHAT I'D DO THIS WEEK: one action.
QUESTION FOR THE FOUNDER: the one question you would ask before signing off.

Rules: argue from your pillar first. Use real numbers when the brief has them, and say which numbers you are assuming. Quote only verbatim lines from your brain, with the source id. Do not hedge to sound balanced; the Chair balances the council.`;
}

function cardsBlock(st, round) {
  return st.seats.map((k) => `### ${byKey[k].short} (weight ${st.weights[k].weight})\n${st.cards[round][k]?.text || "(no card)"}`).join("\n\n");
}

export function round2Prompt(st, seat) {
  const cr = st.cruxes.map((c, i) => `${i + 1}. ${c.question} (${c.sides.map((x) => `${x.position}: ${x.seats.map((k) => byKey[k]?.short || k).join(", ")}`).join("; ")})`).join("\n");
  const push = st.pressure?.[seat.key] ? `\nFor you specifically: ${st.pressure[seat.key]}\n` : "";
  return `ROAST ROOM COUNCIL, ROUND 2 OF 3: DEBATE

You hold the ${seat.short.toUpperCase()} seat.

THE BRIEF
${briefBlock(st)}

ROUND 1, EVERY SEAT'S CARD
${cardsBlock(st, 1)}

THE CRUXES THE CHAIR SEES
${cr}
${push}
Answer in your seat's voice, first person, plain text, under 280 words, in exactly this shape:

SEAT: ${seat.short.toUpperCase()}
I DISAGREE MOST WITH: [seat name]. Their argument, in one line, then your rebuttal using your frameworks.
I CONCEDE: the strongest point another seat made against you, and what it changes. "Nothing" only if you can say why their best point fails.
ON THE CRUXES: your answer to each crux, one or two lines each.
STANCE: ...
OPTION SCORES: ${optLine(st)}
PILLAR SCORE: n/10
CONFIDENCE: n/5
RUIN RISK: none | possible | likely
MOVED: no | yes, from X to Y, because ...
MY CONDITIONS FOR YES: up to three, concrete and checkable (a number, a date, a test result).

Rules: engage the actual arguments on the table. Move only for a better argument, never to be agreeable. If everyone agrees with you, attack the weakest part of your own case.`;
}

export function round3Prompt(st, seat) {
  const d = st.draft;
  return `ROAST ROOM COUNCIL, ROUND 3 OF 3: VOTE ON THE DRAFT RESOLUTION

You hold the ${seat.short.toUpperCase()} seat.

THE BRIEF
${briefBlock(st)}

YOUR ROUND 2 CARD
${st.cards[2][seat.key]?.text || ""}

THE CHAIR'S DRAFT RESOLUTION
Recommendation: ${d.label} on option ${d.option}. ${d.recommendation}
Conditions:
${d.conditions.map((c) => `- ${c}`).join("\n")}
Next steps:
${d.next_steps.map((c) => `- ${c}`).join("\n")}
Cheapest test: ${d.cheapest_test}
Kill criteria: ${d.kill_criteria}

Answer in your seat's voice, first person, under 140 words, in exactly this shape:

SEAT: ${seat.short.toUpperCase()}
VOTE: Endorse | Endorse with amendment | Dissent
OPTION SCORES: ${optLine(st)}   (given the resolution's conditions)
FINAL SCORE: n/10   (your support for the draft resolution as written)
FINAL PILLAR SCORE: n/10
AMENDMENT OR DISSENT: one or two sentences. Blank if you endorse.
ONE LINE FOR THE FOUNDER: the thing from your pillar they must not forget.`;
}

export const ROUND_PROMPT = { 1: round1Prompt, 2: round2Prompt, 3: round3Prompt };
export const SEAT_MAX_TOKENS = 1400;

// ---------------------------------------------------------------- scoring
export function optionScores(st, round) {
  const out = {};
  for (const o of st.options) {
    let num = 0, den = 0;
    const parts = [];
    for (const k of st.seats) {
      const v = st.cards[round][k]?.parsed.optionScores[o.id];
      const w = st.weights[k].weight;
      if (typeof v === "number") { num += w * v; den += w; parts.push(`${w}x${v}`); }
    }
    out[o.id] = { score: den ? Math.round((num / den) * 10) / 10 : null, math: den ? `(${parts.join(" + ")}) / ${den}` : "" };
  }
  return out;
}

export function bandFor(score) {
  if (score == null) return "RESHAPE";
  if (score >= 7.5) return "GO";
  if (score >= 6) return "GO WITH CONDITIONS";
  if (score >= 4.5) return "RESHAPE";
  return "DON'T DO IT";
}

// ---------------------------------------------------------------- chair steps
// Each returns { name, schema, maxTokens, prompt } for one structured Chair call.
function chairSetup(st) {
  const schema = S.obj({
    title: S.str,
    decision: S.str,
    brief: S.str,
    options: S.arr(S.obj({ id: S.enum("A", "B", "C", "D"), label: S.str })),
    assumptions: S.arr(S.str),
    weights: S.arr(S.obj({ seat: S.enum(...st.board), weight: S.int, reason: S.str })),
    quick_seats: S.arr(S.enum(...st.board)),
    seats: S.arr(S.enum(...st.board)),
  });
  return {
    schema, maxTokens: 3000,
    prompt: `A founder brought this to the council:

"""${st.prompt}"""

Set up the room.
- title: the decision in 3 to 7 words.
- decision: one line.
- options: 2 to 4 options with ids A, B, C (D only if truly needed). Always include "don't do it" or "keep doing what you do now", and the obvious smaller version if the founder brought one big idea.
- brief: under 200 words covering the business, resources, what success looks like, and the founder's lean, using only what the founder said. Do not invent facts.
- assumptions: any number or fact you had to assume to make the brief usable, each one line. Keep it to what matters.
- weights: one entry for every seat, weight 1 to 3 (3 = the decision lives in this pillar, 2 = materially affected, 1 = touched at the edges). Exactly one or two seats at 3. Reason in one line.
- quick_seats: the four seats for a quick council: the two highest-weight seats, the seat that guards the downside (money, capital, or risk) if it is not already in, and the seat most likely to disagree with the others.
- seats: ${st.pick ? "the board for a full council, five to seven seats: every seat at weight 2 or 3, the seat that guards the downside, and the seat most likely to disagree. Leave out seats at weight 1 unless they are the downside or dissent seat." : "every seat (the board is fixed)."}`,
  };
}

function chairCruxes(st) {
  const schema = S.obj({
    cruxes: S.arr(S.obj({ question: S.str, sides: S.arr(S.obj({ position: S.str, seats: S.arr(S.enum(...st.board)) })) })),
    unanimous: S.bool,
    note: S.str,
    pressure: S.arr(S.obj({ seat: S.enum(...st.board), ask: S.str })),
  });
  return {
    schema, maxTokens: 3000,
    prompt: `${briefBlock(st)}

ROUND 1 CARDS
${cardsBlock(st, 1)}

Name the one to three cruxes: the underlying disagreements that explain why seats split (a fact, a number, or a value such as speed versus safety), with the seats on each side.
Unanimity check: if every seat's top option is the same and their scores for it sit within 1 point, set unanimous true, make the strongest unargued alternative a crux, and say which seats whose pillars are most at risk must argue it at full strength.
note: one or two plain sentences for the founder on what the room is fighting about.
pressure: for each seat that holds a minority view, or that the unanimity check names, one sentence telling it exactly which argument it must answer in Round 2. Leave others out.`,
  };
}

function chairDraft(st, interim) {
  const schema = S.obj({
    option: S.str,
    label: S.enum("GO", "GO WITH CONDITIONS", "RESHAPE", "WAIT", "DON'T DO IT"),
    recommendation: S.str,
    conditions: S.arr(S.str),
    next_steps: S.arr(S.str),
    cheapest_test: S.str,
    kill_criteria: S.str,
  });
  return {
    schema, maxTokens: 3000,
    prompt: `${briefBlock(st)}

ROUND 2 CARDS (the debate)
${cardsBlock(st, 2)}

Interim weighted option scores: ${JSON.stringify(Object.fromEntries(Object.entries(interim).map(([k, v]) => [k, v.score])))}
Band rule: 7.5+ GO, 6.0 to 7.4 GO WITH CONDITIONS, 4.5 to 5.9 RESHAPE, under 4.5 DON'T DO IT. Use WAIT when the top option is good but depends on a prerequisite not met yet. Overrides: any seat at RUIN RISK likely caps at RESHAPE until a mitigation it endorsed is in the conditions.

Write the draft resolution. Weigh arguments, not headcount: one seat with a decisive fact beats three with vibes. Merge duplicate conditions, keep each checkable (a number or a date), and where seats gave different numbers pick one and say whose. Next steps carry dates or day counts. recommendation is one or two sentences.`,
  };
}

function chairVerdict(st, finalScores, recommended) {
  const lastRound = st.rounds.at(-1);
  const schema = S.obj({
    label: S.enum("GO", "GO WITH CONDITIONS", "RESHAPE", "WAIT", "DON'T DO IT"),
    call: S.str,
    override_note: S.str,
    why: S.arr(S.obj({ point: S.str, seat: S.str, framework: S.str })),
    fights: S.arr(S.obj({ crux: S.str, story: S.str })),
    minority: S.obj({ seat: S.str, quote: S.str, would_have_to_be_true: S.str }),
    amendments: S.arr(S.obj({ seat: S.str, amendment: S.str, adopted: S.bool, reason: S.str })),
    conditions: S.arr(S.str),
    next_steps: S.arr(S.obj({ when: S.str, action: S.str })),
    cheapest_test: S.str,
    kill_criteria: S.str,
    revisit: S.str,
  });
  return {
    schema, maxTokens: 5000,
    prompt: `${briefBlock(st)}

CRUXES: ${JSON.stringify(st.cruxes)}

ROUND 2 CARDS
${cardsBlock(st, 2)}

${lastRound === 3 ? `DRAFT RESOLUTION\n${JSON.stringify(st.draft)}\n\nROUND 3 VOTES\n${cardsBlock(st, 3)}` : "(Quick mode: Round 3 skipped.)"}

FINAL WEIGHTED OPTION SCORES (computed, do not change): ${JSON.stringify(Object.fromEntries(Object.entries(finalScores).map(([k, v]) => [k, v.score])))}
Recommended option by score: ${recommended}. Band for it: ${bandFor(finalScores[recommended]?.score)}.
Any seat at ruin risk likely: ${st.seats.filter((k) => st.cards[lastRound][k]?.parsed.ruin === "likely" || st.cards[2][k]?.parsed.ruin === "likely").join(", ") || "none"}.

Write the verdict for the founder.
- label: the band, or WAIT if the recommended option depends on an unmet prerequisite, or a cap from an override. If you change the band, say why in override_note; otherwise override_note is "".
- call: one or two sentences the founder can act on, naming the option.
- why: 3 to 5 arguments that carried the room, each tagged with the seat and the framework.
- fights: one entry per crux: who was on each side, who moved and why, how it resolved.
- minority: the strongest losing view; quote copies the seat's own words exactly from a card; would_have_to_be_true in one line. If unanimous, use the least-tested assumption instead.
- amendments: every Round 3 amendment, adopted or not, with the reason (empty in quick mode). Adopt when no seat objected or the argument went unanswered.
- conditions, next_steps (with when), cheapest_test, kill_criteria, revisit: final, merged, checkable.`,
  };
}


export function chairStep(step, st, extra = {}) {
  const fn = { setup: () => chairSetup(st), cruxes: () => chairCruxes(st), draft: () => chairDraft(st, extra.interim || st.scores?.[2] || {}), verdict: () => chairVerdict(st, extra.finalScores, extra.recommended) }[step];
  if (!fn) throw new Error(`unknown chair step "${step}"`);
  return { ...fn(), name: `chair_${step}` };
}

// ---------------------------------------------------------------- the verdict's numbers
/** The verdict's numbers, computed from the last round's cards (shared with the folder watcher). */
export function finalNumbers(st) {
  const last = st.rounds.at(-1);
  const finalScores = st.scores[last] || optionScores(st, last);
  const recommended = Object.entries(finalScores).sort((a, b) => (b[1].score ?? 0) - (a[1].score ?? 0))[0][0];
  const fv = st.seats.map((k) => st.cards[last][k]?.parsed.optionScores[recommended]).filter((v) => typeof v === "number");
  const confs = st.seats.map((k) => st.cards[2][k]?.parsed.confidence ?? st.cards[1][k]?.parsed.confidence).filter((v) => typeof v === "number");
  const spreadF = fv.length ? Math.max(...fv) - Math.min(...fv) : 0;
  const confidence = confs.length ? Math.max(1, Math.min(10, Math.round((confs.reduce((a, b) => a + b, 0) / confs.length) * 2) - (spreadF >= 5 ? 1 : 0))) : null;
  const support = last === 3 ? (() => {
    let n = 0, d = 0;
    for (const k of st.seats) { const v = st.cards[3][k]?.parsed.finalScore; if (typeof v === "number") { n += v * st.weights[k].weight; d += st.weights[k].weight; } }
    return d ? Math.round((n / d) * 10) / 10 : null;
  })() : null;
  const votes = last === 3 ? st.seats.reduce((acc, k) => { const v = st.cards[3][k]?.parsed.vote || "endorse"; acc[v] = (acc[v] || 0) + 1; return acc; }, {}) : null;
  return { last, finalScores, recommended, spreadF, confidence, support, votes };
}

export function verdictSeats(st, last) {
  return st.seats.map((k) => ({
    key: k, weight: st.weights[k].weight,
    stance: st.cards[last][k]?.parsed.vote || st.cards[2][k]?.parsed.stance,
    optionScores: st.cards[last][k]?.parsed.optionScores,
    pillar: st.cards[last][k]?.parsed.pillar ?? st.cards[2][k]?.parsed.pillar,
    moved: st.cards[2][k]?.parsed.moved,
    oneLine: st.cards[3][k]?.parsed.oneLine || st.cards[2][k]?.parsed.stance,
  }));
}

