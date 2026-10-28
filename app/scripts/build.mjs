// Build step (Vercel runs it, and `npm start` runs it first): writes the static data the
// browser loads, so the room needs no server for the roster or the example councils.
//   app/public/data/roster.json          every seat, its portrait frames, the default board
//   app/public/data/examples.json        the shipped example councils (list)
//   app/public/data/sessions/<id>.json   each example's recorded events, for replay
import fs from "node:fs";
import path from "node:path";
import { PUBLIC_DIR, SESSIONS_DIR } from "../lib/env.mjs";
import { publicRoster } from "../lib/seats.mjs";

const out = path.join(PUBLIC_DIR, "data");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, "sessions"), { recursive: true });

const roster = publicRoster();
fs.writeFileSync(path.join(out, "roster.json"), JSON.stringify(roster));

const list = [];
for (const dir of fs.existsSync(SESSIONS_DIR) ? fs.readdirSync(SESSIONS_DIR).sort().reverse() : []) {
  if (!dir.includes("example")) continue; // only the shipped examples are published
  const p = path.join(SESSIONS_DIR, dir, "events.json");
  if (!fs.existsSync(p)) continue;
  const j = JSON.parse(fs.readFileSync(p, "utf8"));
  const id = dir;
  const events = j.events.filter((e) => !["delta", "usage", "seat_error", "end"].includes(e.type));
  fs.writeFileSync(path.join(out, "sessions", `${id}.json`), JSON.stringify({ id, title: j.title, prompt: j.prompt || "", mode: j.mode, status: j.status || "done", example: true, events }));
  list.push({ id, title: j.title || id, mode: j.mode, status: j.status || "done", example: true });
}
fs.writeFileSync(path.join(out, "examples.json"), JSON.stringify({ sessions: list }));
console.log(`build: ${roster.seats.length} seats, ${list.length} example councils -> app/public/data`);
