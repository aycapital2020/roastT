// The chats sidebar: New chat, past councils grouped by date, the shipped examples, and a
// lock that pins it open (pushing the room over) or lets it slide away to a slim rail.
// On phones it is an off-canvas drawer behind the menu button.
import { listLocal, renameLocal, deleteLocal, migrateLocal } from "./runner.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const LOCK_KEY = "roastroom:sidebar";
const EX_KEY = "roastroom:sidebar:examples";
const mobileQ = matchMedia("(max-width: 820px)");
const root = document.documentElement;

const sb = { opts: null, examples: [], open: false, hoverTimer: 0, lastFocus: null, noHover: false };

const ICON = {
  pdf: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3.5v9M6.5 9 10 12.5 13.5 9M4.5 15.5h11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  edit: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 16l.8-3.2L13 4.6a1.4 1.4 0 0 1 2 0l.4.4a1.4 1.4 0 0 1 0 2L7.2 15.2z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  del: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 6h11M8 6V4.5h4V6M6 6l.7 9.5h6.6L14 6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

const locked = () => localStorage.getItem(LOCK_KEY) !== "unlocked";
const isMobile = () => mobileQ.matches;
/** The panel is showing as an overlay (unlocked desktop) or drawer (phone), not pinned. */
const floating = () => isMobile() || !locked();

export async function initSidebar(opts) {
  sb.opts = opts;
  migrateLocal();
  applyMode();
  bind();
  sb.examples = await fetch("/data/examples.json").then((x) => x.json()).then((j) => j.sessions || []).catch(() => []);
  refreshSidebar();
}

// ------------------------------------------------------------- lock, open, close
function applyMode() {
  const mob = isMobile(), lock = locked();
  root.classList.toggle("sb-mobile", mob);
  root.classList.toggle("sb-locked", !mob && lock);
  root.classList.toggle("sb-unlocked", !mob && !lock);
  const b = $("#sbLock");
  b.setAttribute("aria-pressed", String(lock));
  b.setAttribute("aria-label", lock ? "Unlock sidebar" : "Lock sidebar open");
  b.title = lock ? "Unlock: let the sidebar slide away" : "Lock: keep the sidebar open";
  if (!floating()) setOpen(false, { quiet: true });
  syncInert();
}

function syncInert() {
  const hidden = floating() && !sb.open;
  $("#sbPanel").inert = hidden;
  $("#sbPanel").setAttribute("aria-hidden", String(hidden));
}

function setOpen(open, { quiet = false, focus = false } = {}) {
  if (open && !floating()) open = false;
  if (sb.open === open && !focus) { syncInert(); return; }
  sb.open = open;
  // the panel covers the rail while open: once it closes, a pointer resting there must not reopen it
  if (!open) { clearTimeout(sb.hoverTimer); sb.noHover = true; }
  root.classList.toggle("sb-open", open);
  $("#sbBackdrop").hidden = !(open && isMobile());
  ["#sbMenuBtn", "#sbRailOpen"].forEach((s) => $(s).setAttribute("aria-expanded", String(open)));
  syncInert();
  if (open) {
    if (focus) { sb.lastFocus = document.activeElement; requestAnimationFrame(() => $("#sbNew").focus()); }
  } else if (!quiet && sb.lastFocus && $("#sidebar").contains(document.activeElement)) {
    sb.lastFocus.focus?.();
    sb.lastFocus = null;
  }
}

/** Close the overlay or drawer after picking something; a pinned sidebar stays put. */
function settle() { if (floating()) setOpen(false); }

function bind() {
  mobileQ.addEventListener("change", applyMode);
  $("#sbLock").addEventListener("click", () => {
    localStorage.setItem(LOCK_KEY, locked() ? "unlocked" : "locked");
    applyMode();
    if (!locked()) { setOpen(false, { quiet: true }); $("#sbRailOpen").focus(); }
  });
  $("#sbMenuBtn").addEventListener("click", () => setOpen(!sb.open, { focus: !sb.open }));
  $("#sbRailOpen").addEventListener("click", () => setOpen(!sb.open, { focus: !sb.open }));
  $("#sbClose").addEventListener("click", () => setOpen(false));
  $("#sbBackdrop").addEventListener("click", () => setOpen(false));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && sb.open && !$("dialog[open]")) { setOpen(false); }
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest("[data-new-chat]")) return;
    sb.opts.onNew();
    settle();
  });

  // unlocked desktop: hovering the rail slides the panel out; leaving it slides it back
  const rail = $("#sbRail"), panel = $("#sbPanel");
  const hoverable = () => !isMobile() && !locked() && matchMedia("(hover: hover)").matches;
  rail.addEventListener("mouseenter", () => { if (!hoverable() || sb.noHover) return; clearTimeout(sb.hoverTimer); sb.hoverTimer = setTimeout(() => setOpen(true), 140); });
  rail.addEventListener("mouseleave", () => { clearTimeout(sb.hoverTimer); sb.noHover = false; });
  document.addEventListener("pointermove", (e) => { if (sb.noHover && !sb.open && !rail.contains(e.target)) sb.noHover = false; }, { passive: true });
  panel.addEventListener("mouseenter", () => clearTimeout(sb.hoverTimer));
  panel.addEventListener("mouseleave", () => {
    if (!hoverable() || !sb.open) return;
    clearTimeout(sb.hoverTimer);
    sb.hoverTimer = setTimeout(() => { if (!panel.contains(document.activeElement) || document.activeElement === document.body) setOpen(false, { quiet: true }); }, 350);
  });
  // keyboard: leaving the floating panel with Tab closes it
  panel.addEventListener("focusout", (e) => {
    if (floating() && sb.open && e.relatedTarget && !$("#sidebar").contains(e.relatedTarget)) setOpen(false, { quiet: true });
  });

  // phones: swipe the drawer left to close it
  let sx = null, sy = 0;
  panel.addEventListener("touchstart", (e) => { if (!isMobile()) return; sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  panel.addEventListener("touchmove", (e) => {
    if (sx === null) return;
    const dx = e.touches[0].clientX - sx, dy = e.touches[0].clientY - sy;
    if (dx < -60 && Math.abs(dx) > Math.abs(dy) * 1.5) { sx = null; setOpen(false); }
  }, { passive: true });
  panel.addEventListener("touchend", () => { sx = null; });

  // the list: open, download, rename, delete
  $("#sbList").addEventListener("click", (e) => {
    const item = e.target.closest(".sb-item"); if (!item) return;
    const id = item.dataset.id;
    if (e.target.closest("[data-rename]")) return startRename(item);
    if (e.target.closest("[data-delete]")) return remove(item);
    if (e.target.closest("[data-pdf]")) return; // the app's PDF handler takes it
    if (e.target.closest(".sb-open")) { sb.opts.onOpen(id); settle(); }
  });
  $("#sbList").addEventListener("toggle", (e) => {
    if (e.target.matches?.("details.sb-examples")) localStorage.setItem(EX_KEY, e.target.open ? "open" : "closed");
  }, true);
}

// ------------------------------------------------------------- the list
function dayStart(t) { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }
function groupOf(created, today) {
  const day = dayStart(created || 0);
  if (day >= today) return "Today";
  if (day >= today - 864e5) return "Yesterday";
  if (day >= today - 7 * 864e5) return "Previous 7 days";
  return "Older";
}
const GROUPS = ["Today", "Yesterday", "Previous 7 days", "Older"];
const label = (s) => (s.name || s.title || s.prompt || "Untitled council").replace(/\s+/g, " ").trim();
const STATUS = { error: "Stopped by an error", stopped: "Stopped", running: "In session" };

function itemHtml(s, { example = false, active, running = false } = {}) {
  const text = label(s);
  const status = running ? "running" : s.status;
  const tip = [text, s.prompt && s.prompt !== text ? s.prompt : "", STATUS[status] || ""].filter(Boolean).join("\n\n");
  const done = status === "done";
  return `<div class="sb-item${s.id === active ? " active" : ""}" data-id="${esc(s.id)}" role="listitem">
    <button class="sb-open" type="button" title="${esc(tip)}"${s.id === active ? ' aria-current="true"' : ""}>${status !== "done" ? `<span class="sb-dot ${esc(status)}" aria-label="${esc(STATUS[status] || status)}"></span>` : ""}<span class="sb-text">${esc(text)}</span></button>
    <span class="sb-actions">${done ? `<button class="sb-act" type="button" data-pdf="${esc(s.id)}" aria-label="Download PDF: ${esc(text)}" title="Download PDF">${ICON.pdf}</button>` : ""}${example ? "" : `<button class="sb-act" type="button" data-rename aria-label="Rename: ${esc(text)}" title="Rename">${ICON.edit}</button><button class="sb-act danger" type="button" data-delete aria-label="Delete: ${esc(text)}" title="Delete">${ICON.del}</button>`}</span>
  </div>`;
}

export function refreshSidebar() {
  if (!sb.opts) return;
  const list = $("#sbList");
  const active = sb.opts.getActive?.() || null;
  const run = sb.opts.getRunning?.() || null;
  const mine = listLocal().slice().sort((a, b) => (b.created || 0) - (a.created || 0));
  const rows = mine.map((s) => ({ s, running: false }));
  if (run && !mine.some((s) => s.id === run.id)) rows.unshift({ s: { ...run, created: run.started || Date.now() }, running: true });
  const today = dayStart(Date.now());
  const by = Object.fromEntries(GROUPS.map((g) => [g, []]));
  for (const r of rows) by[groupOf(r.s.created, today)].push(r);
  let html = GROUPS.filter((g) => by[g].length).map((g) => `<section class="sb-group" aria-label="${g}"><h3 class="sb-gh">${g}</h3><div role="list">${by[g].map((r) => itemHtml(r.s, { active, running: r.running })).join("")}</div></section>`).join("");
  if (!rows.length) html = '<p class="sb-empty">No chats yet. Ask the council something and it shows up here.</p>';
  if (sb.examples.length) {
    const pref = localStorage.getItem(EX_KEY);
    const open = pref ? pref === "open" : !rows.length;
    html += `<details class="sb-examples"${open ? " open" : ""}><summary class="sb-gh">Examples</summary><div role="list">${sb.examples.map((s) => itemHtml(s, { example: true, active })).join("")}</div></details>`;
  }
  const focusedId = document.activeElement?.closest?.(".sb-item")?.dataset.id;
  list.innerHTML = html;
  if (focusedId) $(`.sb-item[data-id="${CSS.escape(focusedId)}"] .sb-open`, list)?.focus();
}

function startRename(item) {
  const id = item.dataset.id;
  const s = listLocal().find((x) => x.id === id); if (!s) return;
  const btn = $(".sb-open", item);
  const input = document.createElement("input");
  input.className = "sb-rename";
  input.value = label(s);
  input.maxLength = 120;
  input.setAttribute("aria-label", "New name for this chat");
  btn.replaceWith(input);
  item.classList.add("editing");
  input.focus();
  input.select();
  let done = false;
  const finish = (save) => {
    if (done) return; done = true;
    if (save) {
      const v = input.value.trim();
      if (v && !renameLocal(id, v)) sb.opts.toast?.("Couldn't rename: this browser is out of space.");
    }
    refreshSidebar();
    $(`.sb-item[data-id="${CSS.escape(id)}"] .sb-open`)?.focus();
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); finish(true); }
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(false); }
  });
  input.addEventListener("blur", () => finish(true));
}

function remove(item) {
  const id = item.dataset.id;
  const s = listLocal().find((x) => x.id === id); if (!s) return;
  if (!confirm(`Delete "${label(s)}"?\n\nThis removes the council and its verdict from this browser. It can't be undone.`)) return;
  const next = item.nextElementSibling || item.previousElementSibling;
  deleteLocal(id);
  sb.opts.onDeleted?.(id);
  refreshSidebar();
  const nid = next?.dataset?.id;
  ($(nid ? `.sb-item[data-id="${CSS.escape(nid)}"] .sb-open` : "#sbNew") || $("#sbNew")).focus();
}
