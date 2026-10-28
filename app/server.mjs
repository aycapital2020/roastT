// Local dev server for `npm start`: serves app/public and the same three API handlers the
// Vercel functions in /api use. Councils run in the browser and are saved there too.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { PUBLIC_DIR } from "./lib/env.mjs";
import * as api from "./lib/api.mjs";
import { MODELS, authMode } from "./lib/gateway.mjs";

const PORT = Number(process.env.PORT) || 4730;
const HOST = process.env.HOST || "127.0.0.1";
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".ico": "image/x-icon", ".json": "application/json", ".ttf": "font/ttf", ".txt": "text/plain; charset=utf-8" };
const ROUTES = { "GET /api/config": api.config, "POST /api/chair": api.chair, "POST /api/seat": api.seat };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;
  try {
    const route = ROUTES[`${req.method} ${p}`];
    if (route) {
      let raw = "";
      for await (const c of req) raw += c;
      const headers = new Headers(Object.entries(req.headers).filter(([, v]) => typeof v === "string"));
      const r = await route(new Request(url, { method: req.method, headers, body: req.method === "GET" ? undefined : raw }));
      res.writeHead(r.status, Object.fromEntries(r.headers));
      return res.end(await r.text());
    }
    if (p.startsWith("/api/")) { res.writeHead(404, { "content-type": "application/json" }); return res.end('{"error":"not found"}'); }
    const file = path.normalize(path.join(PUBLIC_DIR, p === "/" ? "index.html" : decodeURIComponent(p)));
    if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404, { "content-type": "text/plain" }); return res.end("Not found"); }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": "no-store" });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: String(e.message || e) }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Roast Room on http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
  console.log(`Seats: ${MODELS.seat} · Chair: ${MODELS.chair} · Gateway auth: ${authMode()}`);
});
