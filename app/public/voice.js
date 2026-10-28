// Read-aloud for the council, using the browser's own speech engine (Web Speech API).
// No paid text-to-speech and no keys: whatever voices this browser and OS ship with.
//   - every seat gets its own voice: a stable pick from the installed voices plus its own
//     pitch and rate, so even a browser with one or two voices still sounds like different people
//   - the Chair has a voice of its own
//   - say() resolves when the line is spoken, so the player's queue keeps speakers from overlapping
//   - nothing plays until the user has clicked something (browser autoplay rules)
const synth = typeof window !== "undefined" ? window.speechSynthesis : null;
const KEY = "roastroom.listen";

// who reads as which kind of voice; anyone not listed just gets a stable pick
const FEMALE_SEATS = new Set(["sanchez", "blakely", "leila"]);
// pitch and rate per slot: spread wide enough to tell apart on a single voice
const PROFILES = [
  [1.0, 1.02], [0.82, 0.96], [1.18, 1.08], [0.92, 1.12], [1.08, 0.92],
  [0.74, 1.0], [1.26, 1.0], [0.98, 0.88], [0.86, 1.14], [1.14, 0.98], [1.0, 1.16], [0.8, 0.9],
];
const CHAIR_PROFILE = [0.9, 0.95];
const FEMALE_NAMES = /female|woman|samantha|victoria|karen|moira|tessa|fiona|zira|aria|jenny|hazel|susan|libby|sonia|natasha|heera|kalpana|veena|neerja|ava|allison|serena|kate|catherine|emma|joanna|salli|kimberly|ivy|michelle|clara|nicky|zoe|amy|olivia|emily|swara|lekha|isha/i;
const MALE_NAMES = /\bmale\b|man\b|david|mark|george|daniel|alex\b|fred|guy|ryan|rishi|ravi|prabhat|thomas|james|oliver|arthur|aaron|tom\b|eric|christopher|roger|steffan|brian|matthew|joey|justin|liam|william|hemant|madhur|prabhat|reed|rocko|grandpa|eddy/i;

const hash = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
const kindOf = (v) => (FEMALE_NAMES.test(v.name) && !/\bmale\b/i.test(v.name) ? "f" : MALE_NAMES.test(v.name) ? "m" : "?");

export const voice = {
  supported: !!synth && typeof window.SpeechSynthesisUtterance === "function",
  on: false,        // the saved Listen choice
  muted: false,     // muted for now, without changing the saved choice
  unlocked: false,  // the user has clicked something, so the browser lets us speak
  rate: 1,          // follows the playback speed
  voices: [],
  order: [],        // seat keys, so each seat keeps the same voice slot
  cur: null,        // the line being spoken: { cancel }
  map: new Map(),

  init(seatKeys = []) {
    try { this.on = localStorage.getItem(KEY) === "1"; } catch { this.on = false; }
    this.order = [...seatKeys];
    if (!this.supported) return;
    const load = () => { this.voices = synth.getVoices(); this.map.clear(); };
    load();
    synth.addEventListener?.("voiceschanged", load);
    // first click or key press anywhere unlocks speech for the page
    const unlock = () => {
      if (this.unlocked) return;
      this.unlocked = true;
      try { const u = new SpeechSynthesisUtterance(" "); u.volume = 0; synth.speak(u); } catch {}
    };
    window.addEventListener("pointerdown", unlock, { capture: true });
    window.addEventListener("keydown", unlock, { capture: true });
  },
  setSeats(keys) { for (const k of keys) if (!this.order.includes(k)) this.order.push(k); this.map.clear(); },
  setOn(on) {
    this.on = !!on;
    try { localStorage.setItem(KEY, this.on ? "1" : "0"); } catch {}
    if (this.on) this.muted = false; else this.stop();
  },
  get active() { return this.supported && this.on && !this.muted && this.unlocked; },

  // English voices first; local ones before network ones (network voices ignore pitch in Chrome)
  pool() {
    const all = this.voices.length ? this.voices : (this.supported ? synth.getVoices() : []);
    const en = all.filter((v) => /^en/i.test(v.lang));
    const list = (en.length ? en : all).slice();
    list.sort((a, b) => (b.localService === true) - (a.localService === true) || (/^en-(US|GB|IN)/i.test(b.lang) - /^en-(US|GB|IN)/i.test(a.lang)));
    return list;
  },
  chairVoice(pool) {
    return pool.find((v) => /Google UK English Male|Daniel|Microsoft (Ryan|Guy|George|David)|Arthur/i.test(v.name)) || pool.find((v) => kindOf(v) === "m") || pool[0] || null;
  },
  /** { voice, pitch, rate } for a seat key, or null for the Chair. Stable for a given browser. */
  profile(key) {
    const id = key || "__chair";
    if (this.map.has(id)) return this.map.get(id);
    const pool = this.pool();
    const chair = this.chairVoice(pool);
    let p;
    if (!key) p = { voice: chair, pitch: CHAIR_PROFILE[0], rate: CHAIR_PROFILE[1] };
    else {
      let slot = this.order.indexOf(key);
      if (slot < 0) slot = hash(key) % PROFILES.length;
      const others = pool.length > 1 ? pool.filter((v) => v !== chair) : pool;
      const want = FEMALE_SEATS.has(key) ? "f" : "m";
      const match = others.filter((v) => kindOf(v) === want);
      const fit = match.length ? match : others.filter((v) => kindOf(v) === "?").length ? others.filter((v) => kindOf(v) === "?") : others;
      // seats of the same kind spread across the matching voices, in seat order
      // seats of the same kind spread across the matching voices, in seat order
      const sameKind = this.order.filter((k) => (FEMALE_SEATS.has(k) ? "f" : "m") === want);
      let n = sameKind.indexOf(key);
      if (n < 0) n = hash(key);
      const v = fit.length ? fit[n % fit.length] : null;
      let [pitch, rate] = PROFILES[slot % PROFILES.length];
      if (want === "f" && !match.length) pitch = Math.min(1.5, pitch + 0.25); // no female voice installed: lift the pitch
      p = { voice: v, pitch, rate };
    }
    this.map.set(id, p);
    return p;
  },

  /** Queue a line. Resolves when it has been spoken, skipped, or stopped. Lines never overlap. */
  say(key, text, { force = false } = {}) {
    if (!text || !this.supported || !this.unlocked || (!force && !this.active)) return Promise.resolve();
    const epoch = this.epoch;
    const run = () => (epoch === this.epoch && (force || this.active) ? this.speakNow(key, text) : undefined);
    const p = this.tail.then(run, run);
    this.tail = p;
    return p;
  },
  epoch: 0,
  tail: Promise.resolve(),
  speakNow(key, text) {
    const { voice: v, pitch, rate } = this.profile(key);
    // short chunks: Chrome cuts off long utterances and ignores pitch on network voices
    const chunks = String(text).replace(/\s+/g, " ").match(/[^.!?;]{1,220}[.!?;]*["”)]?\s*|.{1,220}/g)?.map((c) => c.trim()).filter(Boolean) || [];
    return new Promise((resolve) => {
      let done = false, i = 0, guard;
      const me = { key, cancel: () => { finish(); try { synth.cancel(); } catch {} } };
      const finish = () => { if (done) return; done = true; clearTimeout(guard); if (this.cur === me) this.cur = null; resolve(); };
      this.cur = me;
      const next = () => {
        clearTimeout(guard);
        if (done) return;
        if (i >= chunks.length) return finish();
        const c = chunks[i++];
        const u = new SpeechSynthesisUtterance(c);
        if (v) { u.voice = v; u.lang = v.lang; }
        u.pitch = pitch;
        u.rate = Math.min(2, rate * this.rate);
        u.onend = next;
        u.onerror = next;
        // some engines never fire onend; don't let the room hang on them
        guard = setTimeout(next, 4000 + (c.length * 110) / u.rate);
        try { synth.speak(u); } catch { finish(); }
      };
      next();
    });
  },
  /** "Play this turn": interrupts whatever is playing, works even with Listen off. */
  playNow(key, text) { this.stop(); return this.say(key, text, { force: true }); },
  cancelCurrent() { const c = this.cur; this.cur = null; if (c) c.cancel(); },
  /** Skip the current speaker; the next queued line starts. */
  skip() { this.cancelCurrent(); },
  /** Stop everything: the current line and anything queued. */
  stop() { this.epoch++; this.tail = Promise.resolve(); this.cancelCurrent(); try { synth?.cancel(); } catch {} },
};
