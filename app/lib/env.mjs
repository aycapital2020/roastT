import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const REPO_ROOT = path.resolve(APP_ROOT, "..");
export const COUNCIL_DIR = path.join(REPO_ROOT, "council");
export const BRAINS_DIR = path.join(COUNCIL_DIR, "brains");
export const ROSTER = path.join(COUNCIL_DIR, "roster.json");
export const AGENTS_DIR = path.join(COUNCIL_DIR, "agents");
export const SESSIONS_DIR = path.join(REPO_ROOT, "sessions");
export const PUBLIC_DIR = path.join(APP_ROOT, "public");

// process.env first (Vercel), then a local .env file (npm start).
let cache = null;
export function env(key) {
  if (process.env[key]) return process.env[key];
  if (!cache) {
    cache = {};
    const p = path.join(REPO_ROOT, ".env");
    if (fs.existsSync(p)) {
      for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m && !(m[1] in cache)) cache[m[1]] = m[2].trim();
      }
    }
  }
  return cache[key] || "";
}
