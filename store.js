// Data layer: connect link, localStorage cache, optimistic writes with a pending queue, Apps Script sync.
import { DEFAULT_LOCATIONS } from './data.js';

export const TABLES = ['Recipes', 'Storage', 'Locations', 'Shopping'];
const NUM = ['servings', 'qty', 'openedDays', 'sort', 'updatedAt'];
const BOOL = ['exact', 'deleted', 'done'];
const JSONCOLS = ['ingredients', 'steps', 'af'];
const EXEC_RE = /^https:\/\/script\.google\.com\/(?:a\/macros\/[\w.-]+|macros)\/s\/[\w-]+\/exec$/;

const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode / quota: keep in memory */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
export const prefs = { get: (k, d) => ls.get('mc_' + k, d), set: (k, v) => ls.set('mc_' + k, v) };

let conn = ls.get('mc_conn', null);
let queue = ls.get('mc_queue', []);
export let db = ls.get('mc_data', null) || seed();
export const state = { status: conn ? 'idle' : 'local', error: '', syncedAt: db.syncedAt || 0 };

function seed() {
  const d = { config: {}, syncedAt: 0 };
  TABLES.forEach(t => d[t] = []);
  d.Locations = DEFAULT_LOCATIONS.map(l => ({ ...l, updatedAt: 1 }));
  return d;
}

// ---------- events ----------
const listeners = new Set();
export const on = fn => listeners.add(fn);
const emit = what => listeners.forEach(fn => fn(what));

// ---------- connect link ----------
const b64url = s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = s => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));

/** Accepts a full link, a "#connect=..." fragment or the raw code. Returns {u,k} or null. Trust boundary. */
export function parseConnect(str) {
  const m = String(str || '').trim().match(/(?:connect=)?([A-Za-z0-9_-]{20,})\s*$/);
  if (!m) return null;
  try {
    const o = JSON.parse(unb64url(m[1]));
    if (typeof o.u !== 'string' || !EXEC_RE.test(o.u) || typeof o.k !== 'string' || !/^[\w-]{20,128}$/.test(o.k)) return null;
    return { u: o.u, k: o.k };
  } catch { return null; }
}
export function makeConnect(u, k) {
  if (!EXEC_RE.test(String(u).trim()) || !/^[\w-]{20,128}$/.test(String(k).trim())) return null;
  const base = location.href.split('#')[0].replace(/index\.html$/, '');
  return `${base}#connect=${b64url(JSON.stringify({ u: String(u).trim(), k: String(k).trim() }))}`;
}
export const connection = () => conn;
export const connectLink = () => conn && makeConnect(conn.u, conn.k);

export function connect(c) {
  conn = c;
  ls.set('mc_conn', c);
  state.status = 'idle'; state.error = '';
  emit('status');
  return flush();
}
export function disconnect() {
  conn = null; ls.del('mc_conn');
  state.status = 'local'; emit('status');
}

// ---------- local writes (optimistic) ----------
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
export const rows = t => db[t].filter(r => !r.deleted);
export const byId = (t, id) => db[t].find(r => r.id === id && !r.deleted);

function applyLocal(op) {
  const list = db[op.table], i = list.findIndex(r => r.id === (op.row ? op.row.id : op.id));
  if (op.op === 'delete') { if (i >= 0) list.splice(i, 1); }
  else if (i >= 0) list[i] = op.row; else list.push(op.row);
}
function enqueue(op) {
  const id = op.row ? op.row.id : op.id;
  queue = queue.filter(q => !(q.table === op.table && (q.row ? q.row.id : q.id) === id)); // coalesce
  queue.push(op);
  applyLocal(op);
  persist();
  emit('data');
  flush();
}
export function save(table, row) {
  const r = { ...row, id: row.id || uid(), updatedAt: Date.now() };
  enqueue({ op: 'upsert', table, row: r });
  return r;
}
export function remove(table, id) { enqueue({ op: 'delete', table, id, updatedAt: Date.now() }); }
/** Several writes, one re-render and one flush. */
export function saveMany(ops) {
  ops.forEach(o => {
    const op = o.op === 'delete' ? { ...o, updatedAt: Date.now() } : { op: 'upsert', table: o.table, row: { ...o.row, id: o.row.id || uid(), updatedAt: Date.now() } };
    const id = op.row ? op.row.id : op.id;
    queue = queue.filter(q => !(q.table === op.table && (q.row ? q.row.id : q.id) === id));
    queue.push(op); applyLocal(op);
  });
  persist(); emit('data'); flush();
}
export const pending = () => queue.length;

function persist() { ls.set('mc_data', db); ls.set('mc_queue', queue); }

// ---------- server ----------
async function api(action, payload = {}) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 20000);
  try {
    const res = await fetch(conn.u, { method: 'POST', redirect: 'follow', signal: ctl.signal,
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },           // simple request: no CORS preflight
      body: JSON.stringify({ key: conn.k, action, by: prefs.get('name', ''), ...payload }) });
    const json = await res.json();
    if (!json.ok) throw Object.assign(new Error(json.error || 'error'), { code: json.error });
    return json.result;
  } finally { clearTimeout(timer); }
}

function normalize(result) {
  const d = { config: result.config || {}, syncedAt: Date.now() };
  for (const t of TABLES) {
    d[t] = (result[t] || []).map(r => {
      const o = { ...r };
      NUM.forEach(k => { if (k in o) o[k] = o[k] === '' ? null : Number(o[k]); });
      BOOL.forEach(k => { if (k in o) o[k] = o[k] === true || o[k] === 'TRUE' || o[k] === 'true'; });
      JSONCOLS.forEach(k => { if (k in o) { try { o[k] = o[k] === '' ? null : JSON.parse(o[k]); } catch { o[k] = null; } } });
      ['id', 'name', 'unit', 'tags', 'notes', 'category', 'locationId', 'expiry', 'added', 'openedAt', 'kind', 'recipeId', 'by']
        .forEach(k => { if (k in o && o[k] !== null) o[k] = String(o[k]); });
      return o;
    }).filter(r => r.id && !r.deleted);
  }
  if (!d.Locations.length) d.Locations = db.Locations; // first connect to an empty sheet keeps local locations (queued below)
  return d;
}

let flushing = null, retry = 0;
export function flush() {
  if (!conn || !navigator.onLine) { state.status = conn ? 'offline' : 'local'; emit('status'); return Promise.resolve(); }
  if (flushing) return flushing;
  const c = conn;                                     // a disconnect mid-request must not write family data back
  flushing = (async () => {
    state.status = 'syncing'; emit('status');
    try {
      if (!db.syncedAt) {
        // first sync on this device: upload anything created before connecting (local-only mode).
        // Seed locations (updatedAt 1) only go up when the family Sheet has no places yet.
        const server = await api('sync');
        if (conn !== c) return;
        const hasLocs = (server.Locations || []).length > 0;
        const known = new Set(queue.map(q => q.table + (q.row ? q.row.id : q.id)));
        TABLES.forEach(t => db[t].forEach(r => {
          if (!known.has(t + r.id) && !(r.updatedAt === 1 && hasLocs)) queue.push({ op: 'upsert', table: t, row: r });
        }));
      }
      while (queue.length) {
        const batch = queue.slice(0, 200);
        const res = await api('write', { ops: batch });
        if (conn !== c) return;
        queue = queue.filter(q => !batch.includes(q));   // rejected ops (too large / invalid) are dropped, not retried forever
        if (res && res.rejected && res.rejected.length) emit('rejected');
        persist();
      }
      const fresh = normalize(await api('sync'));
      if (conn !== c) return;
      queue.forEach(applyLocalTo(fresh));            // edits made during the request stay visible
      db = fresh;
      state.syncedAt = db.syncedAt; state.status = 'ok'; state.error = '';
      persist(); emit('data');
    } catch (e) {
      if (conn !== c) return;
      state.status = 'error';
      state.error = e.name === 'AbortError' ? 'timeout' : (e.code || e.message || String(e));
      if (e.code === 'unauthorized') emit('unauthorized');
      else if (queue.length) setTimeout(flush, Math.min(300000, 30000 * ++retry));
    } finally {
      flushing = null;
      if (conn && conn !== c) setTimeout(flush, 0);  // switched family mid-request: sync the new one
      else if (state.status === 'ok') { retry = 0; if (queue.length) setTimeout(flush, 0); } // edits made during the final sync
      emit('status');
    }
  })();
  return flushing;
}
const applyLocalTo = d => op => {
  const list = d[op.table], i = list.findIndex(r => r.id === (op.row ? op.row.id : op.id));
  if (op.op === 'delete') { if (i >= 0) list.splice(i, 1); } else if (i >= 0) list[i] = op.row; else list.push(op.row);
};

/** Wipe local data and queue (used by Disconnect + "clear this device"). */
export function resetLocal() { db = seed(); queue = []; persist(); emit('data'); }

// Another tab wrote: adopt its copy so this tab's next save doesn't overwrite it.
addEventListener('storage', e => {
  if (e.key !== 'mc_data' && e.key !== 'mc_queue' && e.key !== 'mc_conn') return;
  db = ls.get('mc_data', null) || seed(); queue = ls.get('mc_queue', []); conn = ls.get('mc_conn', null);
  emit('data');
});
addEventListener('online', () => flush());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && Date.now() - (state.syncedAt || 0) > 30000) flush();
});
