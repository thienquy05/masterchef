/**
 * MasterChef backend: paste this whole file into Extensions > Apps Script of your Google Sheet.
 * 1. Run `install` once (authorize: Advanced > Go to project). It creates the tabs, a secret key and the daily email trigger.
 * 2. Deploy > New deployment > Web app. Execute as: Me. Who has access: Anyone. Copy the /exec URL.
 * 3. Later code changes: Deploy > Manage deployments > Edit (pencil) > Version: New version. NEVER "New deployment" (new URL = every phone breaks).
 * Owner-only functions: install, rotateKey (if the link leaks), sendDigest (test the email), daily.
 * See README.md for the full guide.
 */
/** @OnlyCurrentDoc */
const TABLES = {
  Recipes:   ['id','name','servings','tags','exact','ingredients','steps','af','notes','updatedAt','deleted','by'],
  Storage:   ['id','name','qty','unit','category','locationId','expiry','added','openedAt','openedDays','notes','updatedAt','deleted','by'],
  Locations: ['id','name','kind','sort','updatedAt','deleted','by'],
  Shopping:  ['id','name','qty','unit','done','recipeId','updatedAt','deleted','by'],
};
const NUM = ['servings','qty','openedDays','sort','updatedAt'], BOOL = ['exact','deleted','done'];
const PUBLIC = ['warnDays','siteUrl'];
const DAY = 86400000;

function doGet() { return out_({ ok: true, app: 'masterchef' }); }   // health check only: no data, no writes over GET

function doPost(e) {
  try {                                    // an uncaught throw serves an HTML page that the browser reports as a CORS error
    const req = JSON.parse(e.postData.contents);
    if (!checkKey_(req.key)) return out_({ ok: false, error: 'unauthorized' });
    if (req.action === 'sync')  return out_({ ok: true, result: sync_() });
    if (req.action === 'write') return out_({ ok: true, result: withLock_(() => write_(req.ops, String(req.by || '').slice(0, 40))) });
    return out_({ ok: false, error: 'unknown_action' });
  } catch (err) { return out_({ ok: false, error: String((err && err.message) || err) }); }
}
function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function sheet_(n) { const sh = SpreadsheetApp.getActive().getSheetByName(n); if (!sh) throw new Error('missing_sheet_' + n); return sh; }
function settings_() { const s = {}; sheet_('Settings').getDataRange().getValues().forEach(r => { if (r[0]) s[String(r[0])] = String(r[1]); }); return s; }
function checkKey_(k) {
  if (typeof k !== 'string' || k.length < 20) return false;
  const s = settings_();
  return k === s.activeKey || (!!s.previousKey && k === s.previousKey);
}
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('busy_try_again');
  try { const r = fn(); SpreadsheetApp.flush(); return r; } finally { lock.releaseLock(); }
}
function read_(name) {
  const tz = Session.getScriptTimeZone(), v = sheet_(name).getDataRange().getValues(), h = v.shift() || [];
  return v.filter(r => r[0] !== '').map(r => {
    const o = {};
    h.forEach((k, i) => {
      let x = r[i] instanceof Date ? Utilities.formatDate(r[i], tz, 'yyyy-MM-dd') : r[i];   // Sheets may coerce date text
      if (typeof x === 'string' && /^'[=+\-@]/.test(x)) x = x.slice(1);                    // undo the formula guard if Sheets kept it
      o[k] = x;
    });
    return o;
  });
}
function sync_() {
  const s = settings_(), out = { config: {} };
  PUBLIC.forEach(k => out.config[k] = s[k] || '');
  Object.keys(TABLES).forEach(t => out[t] = read_(t));        // tombstones included; the client filters them
  return out;
}
function cell_(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'object') v = JSON.stringify(v);
  if (typeof v === 'string') {
    if (v.length > 45000) throw new Error('too_large');      // Sheets cell limit is 50k characters
    if (/^[=+\-@]/.test(v)) v = "'" + v;                      // formula injection guard
  }
  return v;
}
function write_(ops, by) {
  if (!Array.isArray(ops) || ops.length > 200) throw new Error('bad_ops');
  const res = { applied: 0, stale: 0, rejected: [] }, cache = {};
  ops.forEach(op => { try { writeOne_(op, by, res, cache); } catch (err) {   // one bad op must not block the rest of the queue
    res.rejected.push({ id: String(op && (op.id || (op.row && op.row.id)) || '').slice(0, 64), error: String(err.message || err) }); } });
  return res;
}
function writeOne_(op, by, res, cache) {
  {
    const cols = TABLES[op && op.table];
    if (!cols) throw new Error('bad_table');                  // allowlist: Settings can never be reached
    const del = op.op === 'delete';
    const row = del ? { id: op.id, updatedAt: op.updatedAt } : (op.row || {});
    if (!/^[\w-]{6,64}$/.test(String(row.id))) throw new Error('bad_id');
    row.updatedAt = Number(row.updatedAt) || Date.now();
    const sh = sheet_(op.table);
    const t = cache[op.table] || (cache[op.table] = (v => ({ h: v[0], rows: v.slice(1) }))(sh.getDataRange().getValues()));
    const idi = t.h.indexOf('id'), ui = t.h.indexOf('updatedAt'), di = t.h.indexOf('deleted');
    const at = t.rows.findIndex(r => String(r[idi]) === String(row.id));
    if (at >= 0 && Number(t.rows[at][ui]) > row.updatedAt) { res.stale++; return; }   // last write wins
    let vals;
    if (del) { if (at < 0) return; vals = t.rows[at].slice(); vals[di] = true; vals[ui] = row.updatedAt; }
    else vals = t.h.map((c, i) => cols.indexOf(c) < 0 ? (at >= 0 ? t.rows[at][i] : '') : cell_(c === 'by' ? by : row[c]));
    if (at >= 0) { sh.getRange(at + 2, 1, 1, vals.length).setValues([vals]); t.rows[at] = vals; }
    else { sh.appendRow(vals); t.rows.push(vals); }
    res.applied++;
  }
}

/* Owner-only functions, run from the editor */
function install() {
  const ss = SpreadsheetApp.getActive();
  Object.keys(TABLES).forEach(n => {
    const cols = TABLES[n], sh = ss.getSheetByName(n) || ss.insertSheet(n);
    if (sh.getLastRow() === 0) sh.appendRow(cols);            // a re-run keeps existing data
    sh.setFrozenRows(1);
    cols.forEach((c, i) => { if (NUM.indexOf(c) < 0 && BOOL.indexOf(c) < 0) sh.getRange(1, i + 1, sh.getMaxRows()).setNumberFormat('@'); });
  });
  if (!ss.getSheetByName('Settings')) {
    const st = ss.insertSheet('Settings');
    st.getRange('B:B').setNumberFormat('@');                  // set before writing so a hex key is never parsed as a number
    st.getRange(1, 1, 6, 2).setValues([['activeKey', newKey_()], ['previousKey', ''],
      ['digestEmails', Session.getEffectiveUser().getEmail()], ['digestHour', '7'], ['warnDays', '3'], ['siteUrl', '']]);
  }
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'daily').forEach(t => ScriptApp.deleteTrigger(t));
  const h = Number(settings_().digestHour);                    // change digestHour, then run install again
  ScriptApp.newTrigger('daily').timeBased().everyDays(1).atHour(Number.isInteger(h) && h >= 0 && h <= 23 ? h : 7).nearMinute(0).create();
  console.log('Key: ' + settings_().activeKey + '\nNext: Deploy > New deployment > Web app. Execute as: Me. Who has access: Anyone.');
}
function newKey_() { return Utilities.getUuid().replace(/-/g, ''); }   // 32 hex characters, 122 random bits
function rotateKey() {                                                // then reshare the QR; clear previousKey once everyone has reconnected
  const st = sheet_('Settings'), v = st.getRange(1, 1, st.getLastRow(), 2).getValues();
  const row = k => v.findIndex(r => r[0] === k) + 1;
  st.getRange(row('previousKey'), 2).setValue(settings_().activeKey);
  st.getRange(row('activeKey'), 2).setValue(newKey_());
  console.log('New key: ' + settings_().activeKey);
}
function daily() { withLock_(purge_); sendDigest(); }
function purge_() {
  const cut = Date.now() - 365 * DAY;               // long enough that a phone offline for months can't resurrect a delete
  Object.keys(TABLES).forEach(n => {
    const sh = sheet_(n), v = sh.getDataRange().getValues(), di = v[0].indexOf('deleted'), ui = v[0].indexOf('updatedAt');
    for (let i = v.length - 1; i >= 1; i--) if (v[i][di] === true && Number(v[i][ui]) < cut) sh.deleteRow(i + 1);
  });
}
function ms_(d) { const p = String(d).split('-'); return Date.UTC(+p[0], p[1] - 1, +p[2]); }
function days_(a, b) { return Math.round((ms_(b) - ms_(a)) / DAY); }
function add_(d, n) { return new Date(ms_(d) + n * DAY).toISOString().slice(0, 10); }
function eff_(r) {                       // same rule as core.js effectiveExpiry
  let e = r.expiry || '';
  if (r.openedAt && Number(r.openedDays) > 0) { const o = add_(r.openedAt, Number(r.openedDays)); if (!e || o < e) e = o; }
  return e;
}
function sendDigest() {
  const s = settings_(), to = String(s.digestEmails || '').split(',').map(x => x.trim()).filter(Boolean);
  if (!to.length) return;
  const tz = Session.getScriptTimeZone(), today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd'), warn = Number(s.warnDays) || 3;
  const loc = {}; read_('Locations').forEach(l => loc[l.id] = l.name);
  const items = read_('Storage').filter(r => r.deleted !== true && r.qty !== 0)
    .map(r => ({ r, e: eff_(r) })).filter(x => x.e && days_(today, x.e) <= warn).sort((a, b) => a.e < b.e ? -1 : 1);
  if (!items.length || MailApp.getRemainingDailyQuota() < to.length) return;   // quota counts each recipient
  const esc = x => String(x == null ? '' : x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const rows = items.map(x => { const d = days_(today, x.e);
    return [x.r.name, ((x.r.qty || '') + ' ' + (x.r.unit || '')).trim(), loc[x.r.locationId] || '', x.e, d < 0 ? 'EXPIRED' : d === 0 ? 'today' : d + ' d']; });
  MailApp.sendEmail(to.join(','), 'MasterChef: ' + items.length + ' item(s) to use soon',
    rows.map(r => r.join(' | ')).join('\n') + (s.siteUrl ? '\n\n' + s.siteUrl : ''),
    { name: 'MasterChef', htmlBody: '<table border="1" cellpadding="4" style="border-collapse:collapse"><tr><th>Item</th><th>Qty</th><th>Where</th><th>Expires</th><th></th></tr>' +
      rows.map(r => '<tr>' + r.map(c => '<td>' + esc(c) + '</td>').join('') + '</tr>').join('') + '</table>' +
      (s.siteUrl ? '<p><a href="' + esc(s.siteUrl) + '">Open MasterChef</a></p>' : '') });
}
