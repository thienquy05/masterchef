// Runs apps-script/Code.gs against an in-memory fake of the Sheets/Apps Script services.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const src = readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');
const sheets = {}, mails = [], triggers = [];
const mkSheet = name => {
  const sh = { name, v: [], fmt: {},
    getLastRow: () => sh.v.length, appendRow: r => { sh.v.push(r.map(x => typeof x === 'string' && x.startsWith("'") ? x.slice(1) : x)); },
    setFrozenRows() {}, getMaxRows: () => 1000,
    getDataRange: () => ({ getValues: () => sh.v.map(r => r.slice()) }),
    getRange: (r, c, nr = 1, nc = 1) => (typeof r === 'string' ? { setNumberFormat() {} } : {
      setNumberFormat() { return this; },
      setValues: vals => vals.forEach((row, i) => row.forEach((x, j) => { (sh.v[r - 1 + i] ||= [])[c - 1 + j] = typeof x === 'string' && x.startsWith("'") ? x.slice(1) : x; })),
      setValue: x => { (sh.v[r - 1] ||= [])[c - 1] = x; },
      getValues: () => sh.v.slice(r - 1, r - 1 + nr).map(row => row.slice(c - 1, c - 1 + nc)),
    }),
    deleteRow: i => sh.v.splice(i - 1, 1) };
  return sh;
};
const ss = { getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = mkSheet(n)) };
const g = {
  SpreadsheetApp: { getActive: () => ss, flush() {} },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ setMimeType: () => ({ body: s }) }) },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
  Utilities: { getUuid: () => 'aaaaaaaa-bbbb-cccc-dddd-' + String(Math.random()).slice(2, 14).padEnd(12, '0'),
    formatDate: (d, tz, f) => d.toISOString().slice(0, 10) },
  Session: { getScriptTimeZone: () => 'UTC', getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' }) },
  ScriptApp: { getProjectTriggers: () => triggers, deleteTrigger() {}, newTrigger: fn => ({ timeBased: () => ({ everyDays: () => ({ atHour: h => ({ nearMinute: () => ({ create: () => triggers.push({ fn, h, getHandlerFunction: () => fn }) }) }) }) }) }) },
  MailApp: { getRemainingDailyQuota: () => 100, sendEmail: (...a) => mails.push(a) },
  console: { log() {} },
};
const api = new Function(...Object.keys(g), src + '\nreturn { doGet, doPost, install, rotateKey, sendDigest, daily, settings_ };')(...Object.values(g));
const post = body => JSON.parse(api.doPost({ postData: { contents: JSON.stringify(body) } }).body);

api.install();
assert.deepEqual(Object.keys(sheets).sort(), ['Locations', 'Recipes', 'Settings', 'Shopping', 'Storage']);
assert.equal(triggers[0].h, 7);
const key = api.settings_().activeKey;
assert.equal(key.length, 32);
assert.deepEqual(JSON.parse(api.doGet().body), { ok: true, app: 'masterchef' });
assert.equal(post({ key: 'x'.repeat(25), action: 'sync' }).error, 'unauthorized');
assert.equal(post({ action: 'sync' }).error, 'unauthorized');
let r = post({ key, action: 'sync' });
assert.ok(r.ok && Array.isArray(r.result.Storage) && !('activeKey' in r.result.config) && !r.result.Settings, 'sync hides Settings');

// writes: upsert, formula guard, stale, delete tombstone, Settings unreachable, rejected op does not block the batch
const t0 = 1000;
r = post({ key, action: 'write', by: 'Mom', ops: [
  { op: 'upsert', table: 'Storage', row: { id: 'item-000001', name: '=1+1', qty: 2, unit: 'pcs', expiry: '2026-11-05', updatedAt: t0 } },
  { op: 'upsert', table: 'Settings', row: { id: 'item-000002', activeKey: 'pwned' } },
  { op: 'upsert', table: 'Recipes', row: { id: 'rec-0000001', name: 'Soup', servings: 4, ingredients: [{ qty: 1, unit: 'tsp', name: 'salt' }], notes: 'x'.repeat(46000), updatedAt: t0 } },
  { op: 'upsert', table: 'Recipes', row: { id: 'rec-0000002', name: 'Rice', servings: 2, ingredients: [{ qty: 1.5, unit: 'cup', name: 'rice' }], updatedAt: t0 } },
] });
assert.equal(r.result.applied, 2); assert.equal(r.result.rejected.length, 2, JSON.stringify(r.result));
assert.equal(api.settings_().activeKey, key, 'Settings untouched');
r = post({ key, action: 'sync' }).result;
const it = r.Storage.find(x => x.id === 'item-000001');
assert.equal(it.name, '=1+1', 'formula text round-trips'); assert.equal(it.by, 'Mom'); assert.equal(it.qty, 2);
assert.equal(typeof JSON.parse(r.Recipes[0].ingredients)[0].qty, 'number');
// stale write ignored, newer applied
r = post({ key, action: 'write', ops: [{ op: 'upsert', table: 'Storage', row: { id: 'item-000001', name: 'old', updatedAt: t0 - 1 } }] }).result;
assert.equal(r.stale, 1);
r = post({ key, action: 'write', ops: [{ op: 'delete', table: 'Storage', id: 'item-000001', updatedAt: t0 + 5 }] }).result;
assert.equal(r.applied, 1);
r = post({ key, action: 'sync' }).result;
assert.equal(r.Storage.find(x => x.id === 'item-000001').deleted, true, 'tombstone');
// stale upsert cannot resurrect
post({ key, action: 'write', ops: [{ op: 'upsert', table: 'Storage', row: { id: 'item-000001', name: 'zombie', updatedAt: t0 + 1 } }] });
assert.equal(post({ key, action: 'sync' }).result.Storage.find(x => x.id === 'item-000001').deleted, true);

// digest: item expiring tomorrow (relative to real today), escaped HTML
const today = new Date().toISOString().slice(0, 10), tmr = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
post({ key, action: 'write', ops: [{ op: 'upsert', table: 'Storage', row: { id: 'item-000003', name: '<b>milk</b>', qty: 1, expiry: tmr, updatedAt: t0 } },
  { op: 'upsert', table: 'Storage', row: { id: 'item-000004', name: 'used up', qty: 0, expiry: today, updatedAt: t0 } }] });
api.sendDigest();
assert.equal(mails.length, 1); assert.ok(mails[0][3].htmlBody.includes('&lt;b&gt;milk&lt;/b&gt;') && !mails[0][3].htmlBody.includes('<b>milk'));
assert.ok(!mails[0][3].htmlBody.includes('used up'), 'qty 0 skipped');

// rotate: old key still works until previousKey is cleared
api.rotateKey();
const nk = api.settings_().activeKey;
assert.notEqual(nk, key); assert.ok(post({ key, action: 'sync' }).ok); assert.ok(post({ key: nk, action: 'sync' }).ok);
console.log('Code.gs mock tests: all passed');
