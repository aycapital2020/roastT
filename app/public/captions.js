// Live captions for the council, like subtitles on a video: who is talking, and their line as it
// is said. With Listen on they follow the voice (word by word where the browser reports word
// boundaries, otherwise timed per spoken piece). With Listen off they follow the on-screen
// playback, so 1x / 1.6x / 2.5x and Skip apply to them too.
import { normText } from "./voice.js";

const KEY = "roastroom.cc";
const MAX = 90; // characters per caption: two lines on a laptop, three on a 360px phone
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Split a line into caption-sized pieces, breaking at sentence ends, then commas, then words. */
export function chunkCaption(text, max = MAX) {
  const words = [];
  for (const m of text.matchAll(/\S+/g)) words.push({ w: m[0], s: m.index, e: m.index + m[0].length });
  const out = [];
  let cur = [];
  const push = () => { if (cur.length) out.push({ s: cur[0].s, e: cur[cur.length - 1].e, words: cur }); cur = []; };
  for (const w of words) {
    if (cur.length && w.e - cur[0].s > max) push();
    cur.push(w);
    const len = w.e - cur[0].s;
    if ((/[.!?]["”')\]]*$/.test(w.w) && len >= 28) || (/[,;:—–]$/.test(w.w) && len >= 55)) push();
  }
  push();
  return out;
}

export const cc = {
  on: true,
  el: null, seq: 0, chunks: [], text: "", idx: -1, pos: 0, tick: 0, boundary: false, shown: false, hideTimer: 0,

  init(el) {
    this.el = el;
    try { this.on = localStorage.getItem(KEY) !== "0"; } catch { this.on = true; }
    this.sync();
  },
  setOn(on) {
    this.on = !!on;
    try { localStorage.setItem(KEY, this.on ? "1" : "0"); } catch {}
    this.sync();
  },
  sync() { if (this.el) this.el.hidden = !(this.on && this.shown); },

  /** Start a new caption. who: { name, img, chair }. Returns its id, for the calls that follow. */
  line(who, text) {
    clearInterval(this.tick);
    clearTimeout(this.hideTimer);
    this.seq++;
    this.text = normText(text);
    this.chunks = chunkCaption(this.text);
    this.who = who || { name: "The Chair", chair: true };
    this.idx = -1;
    this.pos = -1;
    this.boundary = false;
    this.shown = !!this.text;
    if (this.el) this.el.querySelector(".cc-prev").textContent = "";
    this.sync();
    this.progress(0);
    return this.seq;
  },

  /** Move the caption to a character offset in the line: the piece holding it shows, words up to it light up. */
  progress(pos, seq = this.seq) {
    if (seq !== this.seq || !this.el || !this.chunks.length) return;
    pos = Math.max(0, Math.min(pos, this.text.length));
    let i = 0;
    while (i + 1 < this.chunks.length && this.chunks[i + 1].s <= pos) i++;
    const cur = this.el.querySelector(".cc-cur");
    if (i !== this.idx) {
      const prev = this.idx >= 0 ? this.chunks[this.idx] : null;
      this.el.querySelector(".cc-prev").textContent = prev ? this.text.slice(prev.s, prev.e) : "";
      this.idx = i;
      const w = this.who;
      cur.innerHTML = `<span class="cc-who${w.chair ? " chair" : ""}">${w.img ? `<img src="${esc(w.img)}" alt="">` : ""}${esc(w.name)}</span>` +
        this.chunks[i].words.map((x) => `<span class="w" data-s="${x.s}">${esc(x.w)}</span>`).join(" ");
      cur.classList.remove("in"); void cur.offsetWidth; cur.classList.add("in"); // the old piece scrolls away, the new one rises in
    }
    this.pos = pos;
    for (const sp of cur.querySelectorAll(".w")) sp.classList.toggle("on", Number(sp.dataset.s) <= pos);
  },
  /** The whole line has been said: show its last piece in full. */
  finish(seq = this.seq) { if (seq !== this.seq) return; clearInterval(this.tick); this.progress(this.text.length, seq); },
  hide() { clearInterval(this.tick); clearTimeout(this.hideTimer); this.seq++; this.shown = false; this.sync(); },
  /** Fade out a finished caption after a while, unless a newer one has replaced it. */
  hideLater(seq, ms) { clearTimeout(this.hideTimer); this.hideTimer = setTimeout(() => { if (seq === this.seq) this.hide(); }, ms); },

  /** Follow the speech engine for this caption. */
  hooks(seq = this.seq) {
    return {
      chunk: (off, len, rate = 1) => {
        if (seq !== this.seq) return;
        clearInterval(this.tick);
        this.progress(off, seq);
        if (this.boundary) return; // real word timings are arriving; no need to estimate
        // no word boundaries from this engine (yet): estimate how far into the piece the voice is
        const t0 = performance.now(), msPerChar = 68 / Math.max(0.3, rate);
        this.tick = setInterval(() => {
          if (seq !== this.seq) return clearInterval(this.tick);
          const p = off + (performance.now() - t0) / msPerChar;
          this.progress(Math.min(off + len, p), seq);
          if (p >= off + len) clearInterval(this.tick);
        }, 90);
      },
      boundary: (pos) => {
        if (seq !== this.seq) return;
        this.boundary = true;
        clearInterval(this.tick);
        this.progress(pos, seq);
      },
    };
  },

  /** No voice: step through the pieces at reading pace. sleep(ms) is the player's, so speed and Skip apply. */
  async pace(sleep, seq = this.seq) {
    if (!this.on) return this.finish(seq);
    for (let i = 0; i < this.chunks.length - 1; i++) {
      if (seq !== this.seq) return;
      this.progress(this.chunks[i].e, seq);
      const c = this.chunks[i];
      await sleep(Math.max(1400, (c.e - c.s) * 55));
    }
    this.finish(seq);
  },
};
