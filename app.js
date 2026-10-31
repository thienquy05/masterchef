// UI: hash router, screens, event delegation. All user text goes through esc() (any key holder can write data).
import * as C from './core.js';
import * as S from './store.js';
import { AIRFRYER, SHELF, CATEGORIES, AF_CATS, SAFE_TEMPS, SAMPLE_RECIPES } from './data.js';
import { t, getLang, setLang } from './i18n.js';

const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const units = () => S.prefs.get('units', 'us');
const warnDays = () => Number(S.prefs.get('warnDays', '') || S.db.config.warnDays || 3);
const today = () => C.todayStr();
const L = () => getLang();
const ui = { q: '', tag: '', sort: 'az', afQ: '', afCat: '', sQ: '', loc: '', cat: '', zeroId: '', sv: null, draft: null, draftKey: '' };
let installEvt = null;

// ---------- small helpers ----------
const fmtTemp = (f, round5 = false) => {
  if (f === null || f === undefined || f === '') return '';
  if (units() === 'us') return `${f}°F`;
  const c = C.fToC(f);
  return `${round5 ? Math.round(c / 5) * 5 : Math.round(c)}°C`;
};
const fmtDate = d => {
  if (!d) return '';
  const [y, m, dd] = d.split('-').map(Number);
  return new Intl.DateTimeFormat(L(), { month: 'short', day: 'numeric', year: y !== new Date().getFullYear() ? 'numeric' : undefined }).format(new Date(y, m - 1, dd));
};
const daysText = days => days < 0 ? t('expired_ago', { n: -days }) : days === 0 ? t('today') : days === 1 ? t('tomorrow') : t('in_days', { n: days });
const tagsOf = r => String(r.tags || '').split(',').map(s => s.trim()).filter(Boolean);
const locName = id => (S.byId('Locations', id) || {}).name || '';
const locs = () => S.rows('Locations').sort((a, b) => (a.sort || 0) - (b.sort || 0));
const isWater = n => /^(warm |cold |hot |boiling )?(water|nuoc|nuoc am|nuoc soi|nuoc loc|ice|da vien)$/.test(C.norm(n));
const shelfName = r => L() === 'vi' ? r[1] : r[0];
// Keys: "Ketchup / chili sauce" → ketchup, chili sauce; "Bread, commercially baked" → bread; "(…)" dropped.
// The head noun wins: last words in English ("chicken broth" → broth), first words in Vietnamese ("nước dùng gà" → nước dùng).
const keysOf = n => n.replace(/\(.*?\)/g, '').split(',')[0].split('/').map(k => C.norm(k)).filter(Boolean);
const SHELF_KEYS = SHELF.map(r => [r, keysOf(r[0]).map(k => [k, 'en']).concat(keysOf(r[1]).map(k => [k, 'vi']))]);
function shelfFor(name) {
  const n = C.norm(name);
  if (!n) return null;
  const exact = SHELF.find(r => C.norm(r[0]) === n || C.norm(r[1]) === n);
  if (exact) return exact;
  let best = null, score = 0;
  for (const [r, keys] of SHELF_KEYS) for (const [k, lang] of keys) {
    if (!(' ' + n + ' ').includes(' ' + k + ' ')) continue;
    const head = lang === 'en' ? n.endsWith(k) : n.startsWith(k);
    const sc = k.length + (head ? 100 : 0);
    if (sc > score) { best = r; score = sc; }
  }
  return best;
}
const stockItems = () => S.rows('Storage').filter(i => i.qty !== 0);
function stockFor(name) {
  const hits = stockItems().filter(i => C.nameMatch(i.name, name));
  if (!hits.length) return null;
  return hits.map(i => ({ i, s: C.expiryStatus(i, today(), warnDays()) }))
    .sort((a, b) => (a.s.date || '9') < (b.s.date || '9') ? -1 : 1)[0];
}
const countable = ing => ing.class !== 'toTaste' && ing.class !== 'fixed' && !isWater(ing.name);
function haveRatio(r) {
  const list = (r.ingredients || []).filter(countable);
  return { have: list.filter(i => stockFor(i.name)).length, total: list.length };
}
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg; el.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { el.hidden = true; }, 3200);
}
const icon = {
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
};
const backBtn = href => `<a class="icon-btn" href="${href}" aria-label="${esc(t('back'))}">${icon.back}</a>`;
const fab = href => `<a class="fab" href="${href}" aria-label="${esc(t('add'))}">${icon.plus}</a>`;
const chip = (act, val, label, on) => `<button type="button" class="chip${on ? ' on' : ''}" data-act="${act}" data-v="${esc(val)}" aria-pressed="${!!on}">${esc(label)}</button>`;

// ---------- router ----------
function route() {
  const p = (location.hash.slice(1) || '/recipes').split('/').filter(Boolean);
  return { name: p[0] || 'recipes', id: p[1] ? decodeURIComponent(p[1]) : '', sub: p[2] || '' };
}
const isEditing = r => (r.name === 'recipe' && r.sub === 'edit') || r.name === 'item';
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const needConnect = () => standalone() && !S.connection() && !S.prefs.get('localOnly', false);

function render() {
  const r = route();
  let html;
  if (needConnect()) html = connectScreen();
  else if (r.name === 'recipe') html = r.sub === 'edit' ? recipeEdit(r.id) : recipeView(r.id);
  else html = ({ recipes: recipesList, airfryer: airFryer, storage: storageList, item: itemEdit, shopping, settings, safety }[r.name] || recipesList)(r.id);
  view.innerHTML = html;
  chrome(r);
  if (r.name === 'settings' && S.connection()) drawQR();
}
function chrome(r) {
  const tab = { recipe: 'recipes', airfryer: 'recipes', item: 'storage', safety: 'settings' }[r.name] || r.name;
  document.querySelectorAll('.tabbar a').forEach(a => a.setAttribute('aria-current', a.dataset.tab === tab ? 'page' : 'false'));
  const n = S.rows('Storage').filter(i => i.qty !== 0 && ['expired', 'soon'].includes(C.expiryStatus(i, today(), warnDays()).status)).length;
  const b = $('#badge'); b.textContent = n; b.hidden = !n;
  const sb = $('#shopbadge'), ns = S.rows('Shopping').filter(x => !x.done).length; sb.textContent = ns; sb.hidden = !ns;
  $('#title').textContent = t('tab_' + tab);
  $('#units').textContent = units() === 'us' ? 'US' : t('metric_short');
  $('#units').setAttribute('aria-label', `${t('units')}: ${units() === 'us' ? 'US' : t('metric')}`);
  syncDot();
  document.documentElement.lang = L();
  document.querySelectorAll('[data-t]').forEach(el => { el.textContent = t(el.dataset.t); });
}
function syncDot() {
  const st = S.state, p = S.pending();
  const cls = { ok: 'ok', syncing: 'busy', idle: 'busy', error: 'err', offline: 'off', local: 'off' }[st.status] || 'off';
  const label = st.status === 'local' ? t('sync_local') : st.status === 'error' ? t('sync_error', { e: st.error })
    : st.status === 'offline' ? t('sync_offline', { n: p }) : p ? t('sync_pending', { n: p }) : st.status === 'syncing' ? t('syncing') : t('sync_ok');
  const el = $('#sync');
  el.className = 'sync ' + cls; el.title = label; el.setAttribute('aria-label', label);
}

// ---------- Recipes list ----------
function recipesList() {
  const all = S.rows('Recipes');
  const tags = [...new Set(all.flatMap(tagsOf).map(s => s.toLowerCase()))].sort();
  return `
  ${segment('recipes')}
  <div class="bar">
    <input type="search" data-in="q" value="${esc(ui.q)}" placeholder="${esc(t('search_recipes'))}" aria-label="${esc(t('search_recipes'))}">
  </div>
  <div class="chips">${chip('sort', 'az', t('sort_az'), ui.sort === 'az')}${chip('sort', 'stock', t('sort_stock'), ui.sort === 'stock')}
    ${tags.map(g => chip('tag', g, '#' + g, ui.tag === g)).join('')}</div>
  ${useSoonBanner(all)}
  <div id="list">${recipeCards()}</div>
  ${fab('#/recipe/new/edit')}`;
}
function recipeCards() {
  const q = C.norm(ui.q);
  let list = S.rows('Recipes').filter(r => (!ui.tag || tagsOf(r).some(g => g.toLowerCase() === ui.tag)) &&
    (!q || C.norm([r.name, r.tags, ...(r.ingredients || []).map(i => i.name)].join(' ')).includes(q)));
  const withRatio = list.map(r => ({ r, h: haveRatio(r) }));
  if (ui.sort === 'stock') withRatio.sort((a, b) => (b.h.have / (b.h.total || 1)) - (a.h.have / (a.h.total || 1)) || a.r.name.localeCompare(b.r.name));
  else withRatio.sort((a, b) => a.r.name.localeCompare(b.r.name));
  if (!S.rows('Recipes').length) return `<div class="empty"><p>${esc(t('no_recipes'))}</p>
    <button class="btn" data-act="samples">${esc(t('add_samples'))}</button></div>`;
  if (!withRatio.length) return `<p class="empty">${esc(t('no_match'))}</p>`;
  return withRatio.map(({ r, h }, n) => `<a class="card recipe-card" href="#/recipe/${encodeURIComponent(r.id)}">
    <div class="recipe-tile tile-${n % 4}" aria-hidden="true">${esc((r.name || '?').trim().charAt(0).toLocaleUpperCase())}</div>
    <div class="grow recipe-copy"><div class="name">${esc(r.name)}</div>
      <div class="sub">${t('serves', { n: esc(r.servings) })}${r.af ? ' · ' + esc(t('air_fryer')) : ''}</div>
      ${tagsOf(r).length ? `<div class="recipe-tags">${tagsOf(r).map(g => `<span class="chip static">${esc(g)}</span>`).join('')}</div>` : ''}
      ${h.total ? `<div class="stock-line"><span>${h.have}/${h.total} ${esc(t('in_storage'))}</span><span class="stock-track" aria-hidden="true"><span style="width:${Math.round(h.have / h.total * 100)}%"></span></span></div>` : ''}
    </div><span class="recipe-arrow" aria-hidden="true">›</span>
  </a>`).join('');
}
function useSoonBanner(recipes) {
  const soon = stockItems().map(i => ({ i, s: C.expiryStatus(i, today(), warnDays()) }))
    .filter(x => x.s.status === 'soon' || x.s.status === 'expired').sort((a, b) => a.s.days - b.s.days).slice(0, 6);
  if (!soon.length) return '';
  const recs = recipes.filter(r => (r.ingredients || []).some(g => countable(g) && soon.some(x => C.nameMatch(x.i.name, g.name)))).slice(0, 5);
  return `<div class="banner"><strong>${esc(t('use_soon'))}:</strong> ${soon.map(x =>
    `<a href="#/item/${encodeURIComponent(x.i.id)}" class="${x.s.status}">${esc(x.i.name)} (${esc(daysText(x.s.days))})</a>`).join(', ')}
    ${recs.length ? `<div class="sub">${esc(t('try_recipes'))}: ${recs.map(r => `<a href="#/recipe/${encodeURIComponent(r.id)}">${esc(r.name)}</a>`).join(', ')}</div>` : ''}</div>`;
}
const segment = cur => `<nav class="segment" aria-label="${esc(t('tab_recipes'))}">
  <a href="#/recipes" aria-current="${cur === 'recipes' ? 'page' : 'false'}">${esc(t('my_recipes'))}</a>
  <a href="#/airfryer" aria-current="${cur === 'airfryer' ? 'page' : 'false'}">${esc(t('air_fryer'))}</a></nav>`;

// ---------- Recipe view + scaling ----------
const anchorOf = r => (r.ingredients || []).find(i => i.isAnchor && i.qty > 0);
function scaleState(r) {
  if (!ui.sv || ui.sv.id !== r.id) {
    const a = anchorOf(r);
    ui.sv = { id: r.id, servings: Number(r.servings) || 1, mode: 'servings', haveQty: '', haveUnit: a ? C.canonUnit(a.unit) : '', smart: true };
  }
  return ui.sv;
}
function factor(r, sv) {
  const base = Number(r.servings) || 1;
  if (sv.mode === 'anchor') {
    const f = C.anchorFactor(anchorOf(r), C.parseQty(sv.haveQty), sv.haveUnit);
    if (f) return f;
  }
  return sv.servings / base;
}
function grainMl(r) {
  const vol = i => i.qty > 0 && C.dimOf(i.unit) === 'vol';
  const a = anchorOf(r);
  const g = a && vol(a) ? a : (r.ingredients || []).find(i => vol(i) && /(^| )(rice|gao|quinoa|grain|oats|barley|com)( |$)/.test(C.norm(i.name)));
  return g ? C.toBase(g.qty, g.unit) : 0;
}
function fmtIng(ing, f, r, exact) {
  if (ing.qty === null || ing.qty === undefined || ing.class === 'toTaste') return t('to_taste');
  if (ing.class === 'egg' && C.dimOf(ing.unit) === 'count') {
    const e = C.eggCount(ing.qty * f);
    return `${e.whole}${e.half ? ' ' + t('half_egg') : ''}${ing.unit ? ' ' + ing.unit : ''}`;
  }
  const q = C.scaleQty(ing, f, { exact, grainMl: grainMl(r) });
  if (ing.class === 'ratio' && C.dimOf(ing.unit) === 'wt') {           // exact grams, never rounded to 0 or to ounces
    const g = C.toBase(q, ing.unit);
    return g > 0 && g < 0.01 ? '< 0.01 g' : new Intl.NumberFormat(L(), { maximumFractionDigits: 2 }).format(g) + ' g';
  }
  const up = ing.class === 'ratio' || (exact && C.SUBLINEAR.has(ing.class));
  return C.fmtAmount(q, ing.unit, { system: units(), name: ing.name, up, lang: L() });
}
function recipeView(id) {
  const r = S.byId('Recipes', id);
  if (!r) return notFound('#/recipes');
  const sv = scaleState(r), a = anchorOf(r), f = factor(r, sv);
  const anchorUnits = a ? unitChoices(a) : [];
  ui.shownAt = r.updatedAt;
  return `
  <div class="toolbar">${backBtn('#/recipes')}<h2 class="grow">${esc(r.name)}</h2>
    <a class="btn small" href="#/recipe/${encodeURIComponent(r.id)}/edit">${esc(t('edit'))}</a></div>
  ${tagsOf(r).length ? `<div class="chips">${tagsOf(r).map(g => `<span class="chip static">#${esc(g)}</span>`).join('')}</div>` : ''}
  <section class="card scale-panel">
    <div class="row scale-heading">
      <span class="grow">${esc(t('servings'))}</span>
      <button class="icon-btn round" data-act="sv-" aria-label="${esc(t('fewer'))}">−</button>
      <output id="svout" class="big">${esc(fmtServ(r, sv))}</output>
      <button class="icon-btn round" data-act="sv+" aria-label="${esc(t('more'))}">+</button>
    </div>
    ${a ? `<div class="row wrap anchor">
      <label for="haveQty" class="grow">${esc(t('i_have'))} <b>${esc(a.name)}</b>:</label>
      <input id="haveQty" data-in="haveQty" value="${esc(sv.haveQty)}" placeholder="${esc(C.fmtAmount(a.qty, a.unit, { system: 'us' }).split(' ')[0])}" class="num">
      <select data-in="haveUnit" aria-label="${esc(t('unit'))}">${anchorUnits.map(u => `<option value="${esc(u)}"${u === sv.haveUnit ? ' selected' : ''}>${esc(u)}</option>`).join('')}</select>
    </div>` : `<p class="hint">${esc(t('anchor_hint'))}</p>`}
    <div class="row between"><span id="fbadge" class="${fBadge(f).cls}">${esc(fBadge(f).text)}</span>
      ${r.exact ? `<span class="hint">${esc(t('exact_on'))}</span>` : `<span class="seg-mini">
        ${chip('smart', '1', t('smart'), sv.smart)}${chip('smart', '0', t('exact'), !sv.smart)}</span>`}
      <button class="link" data-act="sv-reset">${esc(t('reset'))}</button></div>
  </section>
  <div id="scaled">${scaledPart(r)}</div>
  ${r.af ? `<section class="card af"><h3>${esc(t('air_fryer'))}</h3>
    <p class="big">${esc(fmtTemp(r.af.tempF, true))} · ${esc(r.af.min)}${r.af.max && r.af.max !== r.af.min ? '–' + esc(r.af.max) : ''} ${esc(t('min'))}${r.af.flip ? ' · ' + esc(t('flip_half')) : ''}</p>
    <p class="hint">${esc(t('af_batch'))}</p></section>` : ''}
  ${(r.steps || []).length ? `<section class="card"><h3>${esc(t('steps'))}</h3><ol class="steps">${r.steps.map(s => `<li data-act="step">${esc(s)}</li>`).join('')}</ol></section>` : ''}
  ${r.notes ? `<section class="card"><h3>${esc(t('notes'))}</h3><p class="pre">${esc(r.notes)}</p></section>` : ''}`;
}
function unitChoices(a) {
  const dim = C.dimOf(a.unit), d = C.density(a.name);
  const VOL = ['tsp', 'tbsp', 'cup', 'floz', 'ml', 'l'], WT = ['oz', 'lb', 'g', 'kg'];
  if (dim === 'count' || dim === 'pinch') return [C.canonUnit(a.unit)];
  const own = dim === 'vol' ? VOL : WT, other = dim === 'vol' ? WT : VOL;
  const list = d ? [...own, ...other] : own, mine = C.canonUnit(a.unit);
  return list.includes(mine) ? list : [mine, ...list];
}
const fmtServ = (r, sv) => {
  const f = factor(r, sv), s = (Number(r.servings) || 1) * f;
  return sv.mode === 'anchor' && C.anchorFactor(anchorOf(r), C.parseQty(sv.haveQty), sv.haveUnit) ? '≈ ' + C.fracStr(C.snap(s, [0, 0.5, 1])) : String(sv.servings);
};
function scaledPart(r) {
  const sv = scaleState(r), f = factor(r, sv), exact = !!r.exact || !sv.smart;
  const ings = r.ingredients || [];
  const missing = ings.filter(i => !isWater(i.name) && !stockFor(i.name));
  const rows = ings.map(i => {
    const st = isWater(i.name) ? null : stockFor(i.name);
    const mark = isWater(i.name) ? '' : st ? `<span class="mark ${st.s.status === 'expired' ? 'expired' : st.s.status === 'soon' ? 'soon' : 'ok'}" title="${esc(t('in_storage'))}: ${esc(st.i.name)}${st.s.date ? ' · ' + esc(daysText(st.s.days)) : ''}">✓</span>`
      : `<span class="mark none" title="${esc(t('missing'))}">○</span>`;
    const hint = f !== 1 && !exact && C.SUBLINEAR.has(i.class) ? `<span class="hint"> · ${esc(t('cls_' + i.class))}</span>` : '';
    const state = isWater(i.name) ? '' : st ? (st.s.status === 'soon' || st.s.status === 'expired' ? daysText(st.s.days) : t('in_storage')) : t('missing');
    return `<li class="ing${i.isAnchor ? ' anchor' : ''} ${st ? st.s.status : 'missing'}">${mark}<span class="amt">${esc(fmtIng(i, f, r, exact))}</span><span class="grow">${esc(i.name)}${hint}${state ? `<span class="ing-state">${esc(state)}</span>` : ''}</span></li>`;
  }).join('');
  const warn = [];
  if (Math.abs(f - 1) > 1e-6) {
    warn.push(t('w_time'));
    if (!exact && ings.some(i => C.SUBLINEAR.has(i.class))) warn.push(t('w_season', { f: C.fracStr(C.snap(f, [0, 0.25, 0.5, 0.75, 1])) }));
    if (f > 2 && ings.some(i => i.class === 'leavening')) warn.push(t('w_pans'));
    else if (f > 2) warn.push(t('w_rounds'));
    if (f < 0.5 && tagsOf(r).some(g => /bak|banh|cake|bread/.test(C.norm(g)))) warn.push(t('w_bakedown'));
    if (f > 1.5) warn.push(t('w_cool'));
    if (r.af) warn.push(t('af_batch'));
  }
  const safe = C.safeTempFor(ings);
  return `<section class="card"><h3>${esc(t('ingredients'))}</h3><ul class="ings">${rows || `<li class="hint">${esc(t('no_ings'))}</li>`}</ul>
    ${missing.length ? `<button class="btn ghost full" data-act="to-shop">${esc(t('add_missing', { n: missing.length }))}</button>` : ings.length ? `<p class="hint ok">${esc(t('all_in_storage'))}</p>` : ''}</section>
    ${safe ? `<p class="safe">🌡 ${esc(t('cook_to', { t: fmtTemp(safe.tempF) }))}${safe.rest ? ' ' + esc(t('plus_rest')) : ''}</p>` : ''}
    ${warn.length ? `<section class="card warn"><ul>${warn.map(w => `<li>${esc(w)}</li>`).join('')}</ul></section>` : ''}`;
}
function updateScaled() {
  const r = S.byId('Recipes', route().id);
  if (!r) return;
  const sv = scaleState(r), f = factor(r, sv);
  $('#scaled').innerHTML = scaledPart(r);
  $('#svout').textContent = fmtServ(r, sv);
  const fb = $('#fbadge'), b = fBadge(f); fb.textContent = b.text; fb.className = b.cls;
}
const fBadge = f => Math.abs(f - 1) < 1e-6 ? { text: '×1', cls: 'pill' } : { text: '×' + new Intl.NumberFormat(L(), { maximumFractionDigits: 2 }).format(f), cls: 'pill soon' };
function addMissingToShopping(r) {
  const sv = scaleState(r), f = factor(r, sv), exact = !!r.exact || !sv.smart;
  const shop = S.rows('Shopping'), ops = [];
  for (const i of (r.ingredients || []).filter(i => !isWater(i.name) && !stockFor(i.name))) {
    const egg = i.class === 'egg' && C.dimOf(i.unit) === 'count' && i.qty > 0 && C.eggCount(i.qty * f);
    let q = i.class === 'toTaste' || i.qty == null ? null : egg ? egg.whole + (egg.half ? 1 : 0) : C.scaleQty(i, f, { exact, grainMl: grainMl(r) });
    if (q !== null) q = Math.round(q * 100) / 100;
    const same = shop.find(s => !s.done && C.nameMatch(s.name, i.name) && C.canonUnit(s.unit) === C.canonUnit(i.unit));
    if (same) { if (q !== null) ops.push({ table: 'Shopping', row: { ...same, qty: Math.round(((Number(same.qty) || 0) + q) * 100) / 100 } }); }
    else ops.push({ table: 'Shopping', row: { name: i.name, qty: q, unit: i.unit || '', done: false, recipeId: r.id } });
  }
  S.saveMany(ops);
  toast(t('added_to_shop', { n: ops.length }));
}

// ---------- Recipe editor ----------
function newDraft(r) {
  const d = r ? JSON.parse(JSON.stringify(r)) : { name: '', servings: 4, tags: '', exact: false, ingredients: [], steps: [], af: null, notes: '' };
  d.ingredients = (d.ingredients || []).map(i => ({ ...i, qtyText: i.qty === null || i.qty === undefined ? '' : C.fracStr(i.qty) === '0' ? String(i.qty) : (Number.isInteger(i.qty * 8) ? C.fracStr(i.qty) : String(i.qty)), auto: false }));
  if (!d.ingredients.length) d.ingredients.push(blankIng());
  d.stepsText = (d.steps || []).join('\n');
  d.afOn = !!d.af;
  d.af = d.af || { tempF: 380, min: 10, max: 15, flip: true };
  return d;
}
const blankIng = () => ({ qtyText: '', unit: '', name: '', class: 'normal', isAnchor: false, note: '', auto: true });
function draftFor(key, make) {
  if (ui.draftKey !== key) { ui.draft = make(); ui.draftKey = key; }
  return ui.draft;
}
const UNIT_LIST = ['tsp', 'tbsp', 'cup', 'fl oz', 'ml', 'l', 'oz', 'lb', 'g', 'kg', 'pinch', 'dash', 'cloves', 'stalks', 'pcs', 'can', 'slices'];
function recipeEdit(id) {
  const r = id === 'new' ? null : S.byId('Recipes', id);
  if (id !== 'new' && !r) return notFound('#/recipes');
  const d = draftFor('recipe:' + id, () => newDraft(r));
  const tUnit = units() === 'us' ? '°F' : '°C';
  const afT = d.af.tempF == null ? '' : units() === 'us' ? d.af.tempF : Math.round(C.fToC(d.af.tempF) / 5) * 5;
  return `
  <div class="toolbar">${backBtn(r ? `#/recipe/${encodeURIComponent(id)}` : '#/recipes')}<h2 class="grow">${esc(r ? t('edit_recipe') : t('new_recipe'))}</h2></div>
  <form id="redit" class="form" data-form="recipe" novalidate>
    <label>${esc(t('name'))}<input data-f="name" value="${esc(d.name)}" required maxlength="120"></label>
    <div class="row gap">
      <label class="grow">${esc(t('servings'))}<input data-f="servings" value="${esc(d.servings)}" class="num"></label>
      <label class="grow">${esc(t('tags'))}<input data-f="tags" value="${esc(d.tags)}" placeholder="${esc(t('tags_ph'))}"></label>
    </div>
    <label class="check"><input type="checkbox" data-f="exact"${d.exact ? ' checked' : ''}> ${esc(t('exact_label'))}</label>
    <fieldset><legend>${esc(t('ingredients'))}</legend>
      <p class="hint">${esc(t('ing_help'))}</p>
      <datalist id="units">${UNIT_LIST.map(u => `<option value="${u}">`).join('')}</datalist>
      ${d.ingredients.map((i, n) => `<div class="ingrow" data-row="${n}">
        <input data-k="qtyText" value="${esc(i.qtyText)}" placeholder="${esc(t('qty'))}" class="num" aria-label="${esc(t('qty'))}">
        <input data-k="unit" value="${esc(i.unit)}" list="units" placeholder="${esc(t('unit'))}" class="unit" aria-label="${esc(t('unit'))}">
        <input data-k="name" value="${esc(i.name)}" placeholder="${esc(t('ingredient'))}" class="grow" aria-label="${esc(t('ingredient'))}">
        <select data-k="class" aria-label="${esc(t('scaling'))}">${C.CLASSES.map(c => `<option value="${c}"${c === i.class ? ' selected' : ''}>${esc(t('cls_' + c))}</option>`).join('')}</select>
        <label class="radio" title="${esc(t('main_ing'))}"><input type="radio" name="anchor" data-k="isAnchor"${i.isAnchor ? ' checked' : ''}> ${esc(t('main'))}</label>
        <button type="button" class="icon-btn" data-act="ing-del" data-v="${n}" aria-label="${esc(t('delete'))}">✕</button>
      </div>`).join('')}
      <button type="button" class="btn ghost" data-act="ing-add">+ ${esc(t('add_ing'))}</button>
      <details><summary>${esc(t('paste_lines'))}</summary>
        <textarea id="paste" rows="4" placeholder="2 tbsp fish sauce&#10;1 1/2 cups rice&#10;3 eggs"></textarea>
        <button type="button" class="btn ghost" data-act="ing-paste">${esc(t('add_lines'))}</button></details>
    </fieldset>
    <label>${esc(t('steps'))} <span class="hint">${esc(t('one_per_line'))}</span><textarea data-f="stepsText" rows="6" maxlength="20000">${esc(d.stepsText)}</textarea></label>
    <fieldset><legend><label class="check"><input type="checkbox" data-f="afOn"${d.afOn ? ' checked' : ''}> ${esc(t('af_recipe'))}</label></legend>
      <div class="row gap wrap${d.afOn ? '' : ' dim'}">
        <label>${esc(t('temp'))} (${tUnit})<input data-f="afTemp" inputmode="numeric" value="${esc(afT)}" class="num"></label>
        <label>${esc(t('min'))}<input data-f="afMin" inputmode="numeric" value="${esc(d.af.min)}" class="num"></label>
        <label>${esc(t('max'))}<input data-f="afMax" inputmode="numeric" value="${esc(d.af.max)}" class="num"></label>
        <label class="check"><input type="checkbox" data-f="afFlip"${d.af.flip ? ' checked' : ''}> ${esc(t('flip_half'))}</label>
      </div></fieldset>
    <label>${esc(t('notes'))}<textarea data-f="notes" rows="3" maxlength="5000">${esc(d.notes)}</textarea></label>
    <p id="formerr" class="err" role="alert"></p>
    <div class="row gap">
      <button type="submit" class="btn grow">${esc(t('save'))}</button>
      ${r ? `<button type="button" class="btn danger" data-act="recipe-del">${esc(t('delete'))}</button>` : ''}
    </div>
  </form>`;
}
function readRecipeField(el) {
  const d = ui.draft, row = el.closest('[data-row]');
  if (row) {
    const i = d.ingredients[+row.dataset.row], k = el.dataset.k;
    if (k === 'isAnchor') d.ingredients.forEach((x, n) => { x.isAnchor = n === +row.dataset.row; });
    else if (k === 'class') { i.class = el.value; i.auto = false; }
    else {
      i[k] = el.value;
      if (i.auto && (k === 'name' || k === 'unit' || k === 'qtyText')) {
        i.class = C.classify(i.name, i.unit, i.qtyText.trim() === '' ? null : 1);
        const sel = row.querySelector('[data-k=class]'); if (sel) sel.value = i.class;
      }
    }
    return;
  }
  const f = el.dataset.f;
  if (!f) return;
  const v = el.type === 'checkbox' ? el.checked : el.value;
  const n = String(v).trim() === '' ? null : Number(v);
  if (f === 'afTemp') d.af.tempF = n === null ? null : units() === 'us' ? n : Math.round(C.cToF(n));
  else if (f === 'afMin') d.af.min = n;
  else if (f === 'afMax') d.af.max = n;
  else if (f === 'afFlip') d.af.flip = v;
  else d[f] = v;
  if (f === 'afOn') el.closest('fieldset').querySelector('.row').classList.toggle('dim', !v);
}
function saveRecipe() {
  const d = ui.draft, err = $('#formerr'), id = route().id;
  const name = d.name.trim();
  if (!name) { err.textContent = t('err_name'); return; }
  const ingredients = [];
  for (const i of d.ingredients) {
    if (!i.name.trim()) continue;
    const qty = C.parseQty(i.qtyText);
    if (i.qtyText.trim() && qty === null) { err.textContent = t('err_qty', { v: i.qtyText }); return; }
    let cls = qty === null ? 'toTaste' : i.class === 'toTaste' ? 'normal' : i.class;
    if (C.isCure(i.name)) {
      if (C.dimOf(i.unit) !== 'wt' || C.canonUnit(i.unit) !== 'g') { err.textContent = t('err_cure'); return; }
      cls = 'ratio';
    }
    ingredients.push({ qty, unit: i.unit.trim(), name: i.name.trim(), class: cls, isAnchor: !!i.isAnchor && qty > 0, note: i.note || '' });
  }
  const servings = C.parseQty(String(d.servings));
  if (!(servings > 0)) { err.textContent = t('err_servings'); return; }
  const tags = d.tags.split(',').map(s => s.trim()).filter(Boolean).join(', ');
  const exact = !!d.exact || /(^| )(sauce|dressing|nuoc cham|pickle|pickles|pickled|dua chua|do chua|ferment|fermented|brine|cure)( |$)/.test(C.norm(tags).replace(/[,;]/g, ' '));
  if (d.afOn && !(d.af.tempF > 0 && d.af.min > 0)) { err.textContent = t('err_af'); return; }
  const af = d.afOn ? { tempF: d.af.tempF, min: d.af.min, max: Math.max(d.af.min, d.af.max || d.af.min), flip: !!d.af.flip } : null;
  const old = id === 'new' ? {} : S.byId('Recipes', id) || {};
  const saved = S.save('Recipes', { ...old, name, servings, tags, exact, ingredients, steps: d.stepsText.split('\n').map(s => s.trim()).filter(Boolean), af, notes: d.notes.trim() });
  ui.draftKey = ''; ui.sv = null;
  if (exact && !d.exact) toast(t('exact_auto'));
  location.hash = `#/recipe/${encodeURIComponent(saved.id)}`;
}

// ---------- Air fryer ----------
function airFryer() {
  return `${segment('airfryer')}
  <p class="hint">${esc(t('af_note'))}</p>
  <section class="card"><h3>${esc(t('converter'))}</h3>
    <div class="row gap wrap">
      <label>${esc(t('oven_temp'))} (${units() === 'us' ? '°F' : '°C'})<input data-in="cvT" inputmode="numeric" class="num" value="${units() === 'us' ? 400 : 200}"></label>
      <label>${esc(t('min'))}<input data-in="cvM" inputmode="numeric" class="num" value="25"></label>
      <label>${esc(t('food_kind'))}<select data-in="cvK">
        <option value="fresh">${esc(t('kind_fresh'))}</option><option value="frozenCooked">${esc(t('kind_frozen_cooked'))}</option>
        <option value="frozenRaw">${esc(t('kind_frozen_raw'))}</option></select></label>
    </div>
    <p id="conv" class="big" aria-live="polite">${convResult(units() === 'us' ? 400 : 200, 25, 'fresh')}</p>
  </section>
  <div class="bar"><input type="search" data-in="afQ" value="${esc(ui.afQ)}" placeholder="${esc(t('search_food'))}" aria-label="${esc(t('search_food'))}"></div>
  <div class="chips">${chip('afcat', '', t('all'), !ui.afCat)}${AF_CATS.map(c => chip('afcat', c, t('afc_' + c), ui.afCat === c)).join('')}</div>
  <div id="list">${afRows()}</div>
  <p class="hint"><a href="#/safety">${esc(t('safe_temps'))} →</a> · ${esc(t('af_source'))}</p>`;
}
function convResult(temp, min, kind) {
  const r = C.ovenToAirFryer({ temp: Number(temp), min: Number(min), unit: units() === 'us' ? 'F' : 'C', kind });
  if (r.refuse) return `<span class="err">${esc(t('frozen_raw_refuse', { t: fmtTemp(165) }))}</span>`;
  if (!(Number(temp) > 0) || !(Number(min) > 0)) return '';
  return esc(t('conv_out', { t: `${r.temp}°${units() === 'us' ? 'F' : 'C'}`, m: r.min, c: r.checkAt }));
}
function afRows() {
  const q = C.norm(ui.afQ);
  const list = AIRFRYER.filter(r => (!ui.afCat || r[2] === ui.afCat) && (!q || C.norm(r[0] + ' ' + r[1]).includes(q)));
  if (!list.length) return `<p class="empty">${esc(t('no_match'))}</p>`;
  return list.map(([name, vi, , tF, mn, mx, flip, safe, tip, est]) => `<details class="card af-row">
    <summary><span class="grow">${esc(L() === 'vi' ? vi : name)}</span>
      <span class="af-meta">${esc(fmtTemp(tF, true))} · ${mn}${mx !== mn ? '–' + mx : ''} ${esc(t('min'))}${flip ? ' ↻' : ''}</span></summary>
    <p>${esc(tip)}</p>
    <p class="hint">${flip ? esc(t('flip_half')) + ' · ' : ''}${safe ? esc(t('cook_to', { t: fmtTemp(safe) })) : ''}${est ? ` <span class="pill soon">${esc(t('estimate'))}</span>` : ''}</p>
  </details>`).join('');
}

// ---------- Storage ----------
function storageList() {
  return `
  <div class="bar"><input type="search" data-in="sQ" value="${esc(ui.sQ)}" placeholder="${esc(t('search_items'))}" aria-label="${esc(t('search_items'))}"></div>
  <div class="chips">${chip('loc', '', t('all_places'), !ui.loc)}${locs().map(l => chip('loc', l.id, l.name, ui.loc === l.id)).join('')}</div>
  <div class="chips">${chip('cat', '', t('all'), !ui.cat)}${CATEGORIES.map(c => chip('cat', c, t('cat_' + c), ui.cat === c)).join('')}</div>
  <div id="list">${storageRows()}</div>
  ${fab('#/item/new')}`;
}
function storageRows() {
  const q = C.norm(ui.sQ);
  const items = S.rows('Storage').filter(i => (!ui.loc || i.locationId === ui.loc) && (!ui.cat || i.category === ui.cat) &&
    (!q || C.norm(i.name + ' ' + (i.notes || '')).includes(q))).map(i => ({ i, s: C.expiryStatus(i, today(), warnDays()) }));
  if (!S.rows('Storage').length) return `<div class="empty"><p>${esc(t('no_items'))}</p></div>`;
  if (!items.length) return `<p class="empty">${esc(t('no_match'))}</p>`;
  const groups = [['expired', t('g_expired')], ['soon', t('g_soon', { n: warnDays() })], ['ok', t('g_later')], ['none', t('g_nodate')]];
  return groups.map(([k, label]) => {
    const g = items.filter(x => x.s.status === k).sort((a, b) => (a.s.date || '').localeCompare(b.s.date || '') || a.i.name.localeCompare(b.i.name));
    return g.length ? `<h3 class="group ${k}">${esc(label)} <span class="count">${g.length}</span></h3>${g.map(itemRow).join('')}` : '';
  }).join('');
}
function itemRow({ i, s }) {
  const shelf = shelfFor(i.name), quality = shelf && shelf[7].includes('q') && !i.openedAt;
  const qty = i.qty === null || i.qty === undefined || i.qty === '' ? null : Number(i.qty);
  const zero = ui.zeroId === i.id;
  return `<div class="card item ${s.status}">
    <a class="grow" href="#/item/${encodeURIComponent(i.id)}">
      <div class="name">${esc(i.name)}</div>
      <div class="sub">${locName(i.locationId) ? `<span class="badge">${esc(locName(i.locationId))}</span>` : ''}${i.openedAt ? `<span class="badge">${esc(t('opened'))}</span>` : ''}
        ${s.date ? `<span class="pill ${quality ? 'quality' : s.status}">${quality ? esc(t('best_by')) + ' ' : ''}${esc(daysText(s.days))}</span>` : ''}</div>
    </a>
    ${qty === null ? '' : `<div class="stepper">
      <button class="icon-btn round" data-act="q-" data-v="${esc(i.id)}" aria-label="${esc(t('use_some'))}">−</button>
      <span class="qty">${esc(fmtQty(qty))}${i.unit ? ' ' + esc(i.unit) : ''}</span>
      <button class="icon-btn round" data-act="q+" data-v="${esc(i.id)}" aria-label="${esc(t('add_more'))}">+</button></div>`}
    ${zero ? `<div class="zero-actions"><span>${esc(t('used_up'))}</span>
      <button class="btn small danger" data-act="z-remove" data-v="${esc(i.id)}">${esc(t('remove'))}</button>
      <button class="btn small" data-act="z-shop" data-v="${esc(i.id)}">${esc(t('to_shopping'))}</button>
      <button class="btn small ghost" data-act="z-keep">${esc(t('keep'))}</button></div>` : ''}
  </div>`;
}
const fmtQty = q => new Intl.NumberFormat(L(), { maximumFractionDigits: 2 }).format(q);
const stepFor = u => { const c = C.canonUnit(u); return c === 'g' || c === 'ml' ? 50 : c === 'kg' || c === 'l' || c === 'lb' ? 0.5 : 1; };

// ---------- Item editor ----------
function itemEdit(id) {
  const it = id === 'new' ? null : S.byId('Storage', id);
  if (id !== 'new' && !it) return notFound('#/storage');
  const d = draftFor('item:' + id, () => it ? { ...it } : { name: '', qty: 1, unit: 'pcs', category: '', locationId: ui.loc || (locs()[0] || {}).id || '',
    expiry: '', added: today(), openedAt: '', openedDays: null, notes: '' });
  const shelf = shelfFor(d.name), loc = S.byId('Locations', d.locationId), freezer = loc && loc.kind === 'freezer';
  const names = [...new Set([...SHELF.map(shelfName), ...S.rows('Storage').map(x => x.name)])];
  const sugg = [];
  if (shelf) {
    const days = freezer ? shelf[6] : shelf[4];
    if (days === 'inf') sugg.push(`<button type="button" class="chip" data-act="exp-none">${esc(t('no_expiry'))}</button>`);
    else if (days) sugg.push(`<button type="button" class="chip" data-act="exp-days" data-v="${days}">+${days} ${esc(t('days'))}${freezer ? ' (' + esc(t('freezer')) + ')' : ''}</button>`);
    if (!freezer && shelf[6]) sugg.push(`<span class="hint">${esc(t('freezer_keeps', { n: shelf[6] }))}</span>`);
    if (shelf[4] === null && !freezer) sugg.push(`<span class="hint">${esc(t('use_printed'))}</span>`);
  }
  const openLabel = freezer ? t('after_thaw') : t('after_open');
  return `
  <div class="toolbar">${backBtn('#/storage')}<h2 class="grow">${esc(it ? t('edit_item') : t('new_item'))}</h2></div>
  <form id="iedit" class="form" data-form="item" novalidate>
    <label>${esc(t('name'))}<input data-f="name" value="${esc(d.name)}" list="shelfnames" required maxlength="120" autocomplete="off"></label>
    <datalist id="shelfnames">${names.map(n => `<option value="${esc(n)}">`).join('')}</datalist>
    <div class="row gap">
      <label class="grow">${esc(t('qty'))}<input data-f="qty" value="${esc(d.qty ?? '')}" class="num"></label>
      <label class="grow">${esc(t('unit'))}<input data-f="unit" value="${esc(d.unit)}" list="sunits"></label>
      <datalist id="sunits">${['pcs', 'g', 'kg', 'oz', 'lb', 'ml', 'L', 'bottle', 'pack', 'can', 'bag', 'box', 'bunch'].map(u => `<option value="${u}">`).join('')}</datalist>
    </div>
    <div class="row gap">
      <label class="grow">${esc(t('location'))}<select data-f="locationId">${locs().map(l => `<option value="${esc(l.id)}"${l.id === d.locationId ? ' selected' : ''}>${esc(l.name)}</option>`).join('')}</select></label>
      <label class="grow">${esc(t('category'))}<select data-f="category"><option value="">—</option>${CATEGORIES.map(c => `<option value="${c}"${c === d.category ? ' selected' : ''}>${esc(t('cat_' + c))}</option>`).join('')}</select></label>
    </div>
    <label>${esc(t('expiry'))}<input type="date" data-f="expiry" value="${esc(d.expiry)}"></label>
    <div class="chips" id="sugg">${sugg.join('')}${shelf ? `<span class="hint">${esc(t('src_usda'))}</span>` : ''}</div>
    <fieldset><legend>${esc(t('opened'))}</legend>
      ${d.openedAt ? `<div class="row gap wrap">
        <label>${esc(t('opened_on'))}<input type="date" data-f="openedAt" value="${esc(d.openedAt)}"></label>
        <label>${esc(t('good_for'))} (${esc(openLabel)})<input data-f="openedDays" inputmode="numeric" class="num" value="${esc(d.openedDays ?? '')}"></label>
        <button type="button" class="btn small ghost" data-act="unopen">${esc(t('not_opened'))}</button></div>
        ${shelf && !shelf[7].includes('p') && shelf[3] === 'pantry' && !freezer ? `<p class="hint warn-text">${esc(t('refrigerate_after'))}</p>` : ''}`
      : `<button type="button" class="btn ghost" data-act="open-now">${esc(t('mark_opened'))}</button>`}
    </fieldset>
    <div class="row gap">
      <label class="grow">${esc(t('added'))}<input type="date" data-f="added" value="${esc(d.added)}"></label>
    </div>
    <label>${esc(t('notes'))}<textarea data-f="notes" rows="2" maxlength="5000">${esc(d.notes)}</textarea></label>
    <p id="formerr" class="err" role="alert"></p>
    <div class="row gap">
      <button type="submit" class="btn grow">${esc(t('save'))}</button>
      ${it ? `<button type="button" class="btn danger" data-act="item-del">${esc(t('delete'))}</button>` : ''}
    </div>
  </form>`;
}
function readItemField(el) {
  const f = el.dataset.f, d = ui.draft;
  if (!f) return;
  d[f] = el.value;
  if (f === 'category') d._catTouched = true;
  if (f === 'locationId') { d._locTouched = true; return rerenderForm(); } // freezer changes the suggestions
  if (f !== 'name') return;
  const shelf = shelfFor(d.name), before = [d.category, d.locationId, d._shelf].join('|');
  d._shelf = shelf ? shelf[0] : '';
  if (route().id === 'new') {
    if (!d._catTouched) d.category = shelf ? shelf[2] : '';
    const want = shelf && locs().find(l => l.kind === shelf[3]);
    if (want && !d._locTouched) d.locationId = want.id;
  }
  if ([d.category, d.locationId, d._shelf].join('|') !== before) rerenderForm();
}
function rerenderForm() {
  const active = document.activeElement && document.activeElement.dataset.f, y = scrollY;
  view.innerHTML = itemEdit(route().id);
  scrollTo(0, y);
  if (active) { const el = view.querySelector(`[data-f="${active}"]`); if (el) { el.focus(); if (el.setSelectionRange && el.type === 'text') el.setSelectionRange(el.value.length, el.value.length); } }
}
function saveItem() {
  const d = ui.draft, err = $('#formerr'), id = route().id;
  const name = String(d.name).trim();
  if (!name) { err.textContent = t('err_name'); return; }
  const qty = String(d.qty ?? '').trim() === '' ? null : C.parseQty(String(d.qty));
  if (String(d.qty ?? '').trim() && qty === null) { err.textContent = t('err_qty', { v: d.qty }); return; }
  const od = String(d.openedDays ?? '').trim() === '' ? null : Number(d.openedDays);
  const row = { ...(id === 'new' ? {} : S.byId('Storage', id)), name, qty, unit: String(d.unit || '').trim(), category: d.category || '',
    locationId: d.locationId || '', expiry: d.expiry || '', added: d.added || today(), openedAt: d.openedAt || '', openedDays: od, notes: String(d.notes || '').trim() };
  ['_locTouched', '_catTouched', '_shelf'].forEach(k => delete row[k]);
  S.save('Storage', row);
  ui.draftKey = '';
  location.hash = '#/storage';
}

// ---------- Shopping ----------
function shopping() {
  const list = S.rows('Shopping').sort((a, b) => (a.done - b.done) || a.name.localeCompare(b.name));
  const rec = id => (S.byId('Recipes', id) || {}).name;
  return `
  <form class="row gap card" data-form="shop">
    <input id="shopName" placeholder="${esc(t('item'))}" class="grow" aria-label="${esc(t('item'))}" maxlength="120">
    <input id="shopQty" placeholder="${esc(t('qty'))}" class="num" aria-label="${esc(t('qty'))}">
    <input id="shopUnit" placeholder="${esc(t('unit'))}" class="unit" list="units2" aria-label="${esc(t('unit'))}">
    <datalist id="units2">${UNIT_LIST.map(u => `<option value="${u}">`).join('')}</datalist>
    <button class="btn">${esc(t('add'))}</button>
  </form>
  ${list.length ? list.map(s => `<div class="card row shop${s.done ? ' done' : ''}">
    <label class="check grow"><input type="checkbox" data-act="shop-toggle" data-v="${esc(s.id)}"${s.done ? ' checked' : ''}>
      <span><span class="name">${esc(s.name)}</span> ${s.qty !== null && s.qty !== undefined && s.qty !== '' ? `<span class="sub">${esc(C.fmtAmount(Number(s.qty), s.unit, { system: units(), name: s.name, lang: L() }))}</span>` : ''}
      ${rec(s.recipeId) ? `<span class="sub"> · ${esc(t('from'))} ${esc(rec(s.recipeId))}</span>` : ''}</span></label>
    <button class="icon-btn" data-act="shop-del" data-v="${esc(s.id)}" aria-label="${esc(t('delete'))}">✕</button></div>`).join('')
    : `<p class="empty">${esc(t('shop_empty'))}</p>`}
  ${list.some(s => s.done) ? `<div class="row gap"><button class="btn grow" data-act="shop-move">${esc(t('move_to_storage'))}</button>
    <button class="btn ghost" data-act="shop-clear">${esc(t('clear_checked'))}</button></div>` : ''}`;
}
function moveCheckedToStorage() {
  const done = S.rows('Shopping').filter(s => s.done), ops = [];
  for (const s of done) {
    const shelf = shelfFor(s.name), loc = (shelf && locs().find(l => l.kind === shelf[3])) || locs()[0];
    const days = shelf && typeof shelf[4] === 'number' ? shelf[4] : null;
    const countish = C.dimOf(s.unit) === 'count';
    ops.push({ table: 'Storage', row: { name: s.name, qty: s.qty === null || s.qty === '' ? null : countish ? Math.ceil(Number(s.qty)) : Number(s.qty), unit: s.unit || '',
      category: shelf ? shelf[2] : '', locationId: loc ? loc.id : '', expiry: days ? C.addDays(today(), days) : '', added: today(), openedAt: '', openedDays: null, notes: '' } });
    ops.push({ op: 'delete', table: 'Shopping', id: s.id });
  }
  S.saveMany(ops);
  toast(t('moved', { n: done.length }));
}

// ---------- Settings ----------
function settings() {
  const c = S.connection(), st = S.state;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return `
  <section class="card settings-card"><h3>${esc(t('preferences'))}</h3>
    <div class="row gap wrap">
      <label class="grow">${esc(t('language'))}<select data-in="lang"><option value="en"${L() === 'en' ? ' selected' : ''}>English</option><option value="vi"${L() === 'vi' ? ' selected' : ''}>Tiếng Việt</option></select></label>
      <label class="grow">${esc(t('units'))}<select data-in="unitsSel"><option value="us"${units() === 'us' ? ' selected' : ''}>US (oz, cup, °F)</option><option value="metric"${units() === 'metric' ? ' selected' : ''}>${esc(t('metric'))} (g, mL, °C)</option></select></label>
    </div>
    <div class="row gap wrap">
      <label class="grow">${esc(t('warn_days'))}<input data-in="warnDays" inputmode="numeric" class="num" value="${esc(warnDays())}"></label>
      <label class="grow">${esc(t('your_name'))}<input data-in="name" value="${esc(S.prefs.get('name', ''))}" maxlength="40" placeholder="${esc(t('name_ph'))}"></label>
    </div>
  </section>
  <section class="card settings-card family-card"><h3>${esc(t('family'))}</h3>
    ${c ? `<p>${esc(t('connected'))} · <span class="hint">${st.syncedAt ? esc(t('last_sync', { t: new Date(st.syncedAt).toLocaleString(L()) })) : ''}${S.pending() ? ' · ' + esc(t('sync_pending', { n: S.pending() })) : ''}</span></p>
      ${st.status === 'error' ? `<p class="err">${esc(t('sync_error', { e: st.error }))}</p>` : ''}
      <div class="qr" id="qr" aria-label="${esc(t('qr_label'))}"></div>
      <p class="hint warn-text">${esc(t('share_warn'))}</p>
      <div class="row gap wrap"><button class="btn" data-act="copy-link">${esc(t('copy_link'))}</button>
        ${navigator.share ? `<button class="btn ghost" data-act="share-link">${esc(t('share'))}</button>` : ''}
        <button class="btn ghost" data-act="sync-now">${esc(t('sync_now'))}</button>
        <button class="btn ghost danger" data-act="disconnect">${esc(t('disconnect'))}</button></div>
      ${ios && !standalone() ? `<div class="banner"><strong>${esc(t('ios_install'))}</strong><ol><li>${esc(t('ios_1'))}</li><li>${esc(t('ios_2'))}</li><li>${esc(t('ios_3'))}</li></ol></div>` : ''}`
    : `<p class="hint">${esc(t('local_mode'))}</p>
      <label>${esc(t('paste_family'))}<input id="pasteLink" placeholder="https://…#connect=…" autocomplete="off"></label>
      <div class="row gap wrap"><button class="btn" data-act="connect-paste">${esc(t('connect'))}</button>
        ${navigator.clipboard && navigator.clipboard.readText ? `<button class="btn ghost" data-act="connect-clip">${esc(t('paste_clip'))}</button>` : ''}</div>
      <details><summary>${esc(t('owner_setup'))}</summary>
        <p class="hint">${esc(t('owner_help'))}</p>
        <label>${esc(t('exec_url'))}<input id="execUrl" placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off"></label>
        <label>${esc(t('secret_key'))}<input id="execKey" autocomplete="off"></label>
        <button class="btn" data-act="connect-owner">${esc(t('connect'))}</button></details>`}
  </section>
  <section class="card settings-card"><h3>${esc(t('locations'))}</h3>
    ${locs().map(l => `<div class="row gap"><input data-loc="${esc(l.id)}" value="${esc(l.name)}" class="grow" aria-label="${esc(t('location'))}" maxlength="40">
      <select data-lockind="${esc(l.id)}" aria-label="${esc(t('kind'))}">${['fridge', 'freezer', 'pantry', 'other'].map(k => `<option value="${k}"${k === l.kind ? ' selected' : ''}>${esc(t('kind_' + k))}</option>`).join('')}</select>
      <button class="icon-btn" data-act="loc-del" data-v="${esc(l.id)}" aria-label="${esc(t('delete'))}">✕</button></div>`).join('')}
    <button class="btn ghost" data-act="loc-add">+ ${esc(t('add_location'))}</button>
  </section>
  <section class="card settings-card"><h3>${esc(t('app'))}</h3>
    ${installEvt ? `<button class="btn" data-act="install">${esc(t('install'))}</button>` : standalone() ? `<p class="hint">${esc(t('installed'))}</p>` : `<p class="hint">${esc(ios ? t('ios_add') : t('install_hint'))}</p>`}
    <p><a href="#/safety">${esc(t('food_safety'))} →</a></p>
    <p><a href="test.html">${esc(t('self_test'))} →</a></p>
    <p class="hint">${esc(t('sources'))}</p>
  </section>`;
}
function drawQR() {
  const box = $('#qr'), link = S.connectLink();
  if (!box || !link) return;
  const go = () => { try { const q = window.qrcode(0, 'M'); q.addData(link); q.make(); box.innerHTML = q.createSvgTag({ cellSize: 5, margin: 4, scalable: true }); } catch { box.textContent = ''; } };
  if (window.qrcode) return go();
  if (!navigator.onLine) return;
  const s = document.createElement('script');
  s.src = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';
  s.integrity = 'sha384-8FWZA6BGMXhsfO+BLtrJK0We6gg5o1JyO8xQm6peWDEUs17ACA5ziE/NIAkl9z2k';
  s.crossOrigin = 'anonymous';
  s.onload = go;
  document.head.appendChild(s);
}
function safety() {
  return `<div class="toolbar">${backBtn('#/settings')}<h2 class="grow">${esc(t('food_safety'))}</h2></div>
  <section class="card"><h3>${esc(t('safe_temps'))}</h3><table class="tbl">${SAFE_TEMPS.map(([k, f, note]) =>
    `<tr><td>${esc(t(k))}</td><td class="num">${f ? esc(fmtTemp(f)) : '—'}</td><td class="hint">${note ? esc(t(note)) : ''}</td></tr>`).join('')}</table>
    <p class="hint">${esc(t('st_source'))}</p></section>
  <section class="card"><h3>${esc(t('rules'))}</h3><ul>
    <li>${esc(t('rule_2h', { t: fmtTemp(90) }))}</li><li>${esc(t('rule_fridge', { f: fmtTemp(40), z: fmtTemp(0) }))}</li>
    <li>${esc(t('w_cool'))}</li><li>${esc(t('rule_thermo'))}</li><li>${esc(t('rule_raw_frozen'))}</li><li>${esc(t('rule_brine'))}</li></ul></section>`;
}
function connectScreen() {
  return `<section class="card connect"><h2>${esc(t('connect_title'))}</h2><p>${esc(t('connect_help'))}</p>
    ${navigator.clipboard && navigator.clipboard.readText ? `<button class="btn full" data-act="connect-clip">${esc(t('paste_clip'))}</button>` : ''}
    <label>${esc(t('paste_family'))}<input id="pasteLink" placeholder="https://…#connect=…" autocomplete="off"></label>
    <button class="btn full" data-act="connect-paste">${esc(t('connect'))}</button>
    <button class="link" data-act="local-only">${esc(t('use_local'))}</button></section>`;
}
const notFound = back => `<div class="toolbar">${backBtn(back)}</div><p class="empty">${esc(t('not_found'))}</p>`;

// ---------- actions ----------
function tryConnect(text) {
  const c = S.parseConnect(text), cur = S.connection();
  if (!c) { toast(t('bad_link')); return render(); }
  if (cur && cur.u === c.u && cur.k === c.k) { toast(t('connected')); return render(); }
  if (cur && !confirm(t('confirm_switch', { n: S.pending() }))) return render();
  // never join a Sheet silently: a crafted link could point at someone else's deployment and receive this phone's data
  const local = ['Recipes', 'Storage', 'Shopping'].reduce((n, tb) => n + S.rows(tb).length, 0);
  const sid = c.u.split('/s/')[1].split('/')[0];
  if (!cur && !confirm(t('confirm_join', { id: '…' + sid.slice(-8), n: local }))) return render();
  if (cur) { S.disconnect(); S.resetLocal(); }
  S.prefs.set('localOnly', false);
  S.connect(c).then(() => toast(S.state.status === 'ok' ? t('connected') : t('sync_error', { e: S.state.error })));
  render();
}
const actions = {
  samples() {
    S.saveMany(SAMPLE_RECIPES.map(r => ({ table: 'Recipes', row: JSON.parse(JSON.stringify(r)) })));
  },
  sort: el => { ui.sort = el.dataset.v; render(); },
  tag: el => { ui.tag = ui.tag === el.dataset.v ? '' : el.dataset.v; render(); },
  afcat: el => { ui.afCat = el.dataset.v; render(); },
  loc: el => { ui.loc = el.dataset.v; render(); },
  cat: el => { ui.cat = el.dataset.v; render(); },
  'sv-': () => stepServ(-1), 'sv+': () => stepServ(1),
  'sv-reset': () => { ui.sv = null; render(); },
  smart: el => { ui.sv.smart = el.dataset.v === '1'; render(); },
  step: el => el.classList.toggle('done'),
  'to-shop': () => addMissingToShopping(S.byId('Recipes', route().id)),
  'ing-add': () => { ui.draft.ingredients.push(blankIng()); render(); view.querySelector(`[data-row="${ui.draft.ingredients.length - 1}"] [data-k=qtyText]`)?.focus(); },
  'ing-del': el => { ui.draft.ingredients.splice(+el.dataset.v, 1); if (!ui.draft.ingredients.length) ui.draft.ingredients.push(blankIng()); render(); },
  'ing-paste': () => {
    const lines = $('#paste').value.split('\n').map(s => s.replace(/^[-*•\s]+/, '').trim()).filter(Boolean);
    const d = ui.draft;
    if (d.ingredients.length === 1 && !d.ingredients[0].name) d.ingredients = [];
    for (const l of lines) {
      const p = C.parseLine(l);
      d.ingredients.push({ ...blankIng(), qtyText: p.qty === null ? '' : String(Math.round(p.qty * 1000) / 1000), unit: p.unit, name: p.name, class: C.classify(p.name, p.unit, p.qty) });
    }
    render();
  },
  'recipe-del': () => {
    if (!confirm(t('confirm_delete'))) return;
    S.remove('Recipes', route().id); ui.draftKey = ''; location.hash = '#/recipes';
  },
  'q-': el => stepQty(el.dataset.v, -1), 'q+': el => stepQty(el.dataset.v, 1),
  'z-remove': el => { ui.zeroId = ''; S.remove('Storage', el.dataset.v); },
  'z-shop': el => {
    const i = S.byId('Storage', el.dataset.v); ui.zeroId = '';
    if (i) S.saveMany([{ table: 'Shopping', row: { name: i.name, qty: null, unit: i.unit || '', done: false, recipeId: '' } }, { op: 'delete', table: 'Storage', id: i.id }]);
    toast(t('added_to_shop', { n: 1 }));
  },
  'z-keep': () => { ui.zeroId = ''; render(); },
  'exp-days': el => { ui.draft.expiry = C.addDays(today(), Number(el.dataset.v)); rerenderForm(); },
  'exp-none': () => { ui.draft.expiry = ''; rerenderForm(); },
  'open-now': () => {
    const d = ui.draft, shelf = shelfFor(d.name), loc = S.byId('Locations', d.locationId);
    d.openedAt = today();
    d.openedDays = shelf && typeof shelf[5] === 'number' ? shelf[5] : d.openedDays;
    if (shelf && loc && loc.kind === 'pantry' && !shelf[7].includes('p') && shelf[5] !== null) {
      const fridge = locs().find(l => l.kind === 'fridge');
      if (fridge && confirm(t('move_to_fridge', { f: fridge.name }))) d.locationId = fridge.id;
    }
    rerenderForm();
  },
  unopen: () => { ui.draft.openedAt = ''; ui.draft.openedDays = null; rerenderForm(); },
  'item-del': () => { if (!confirm(t('confirm_delete'))) return; S.remove('Storage', route().id); ui.draftKey = ''; location.hash = '#/storage'; },
  'shop-toggle': el => { const s = S.byId('Shopping', el.dataset.v); if (s) S.save('Shopping', { ...s, done: el.checked }); },
  'shop-del': el => S.remove('Shopping', el.dataset.v),
  'shop-clear': () => S.saveMany(S.rows('Shopping').filter(s => s.done).map(s => ({ op: 'delete', table: 'Shopping', id: s.id }))),
  'shop-move': moveCheckedToStorage,
  'copy-link': async () => { try { await navigator.clipboard.writeText(S.connectLink()); toast(t('copied')); } catch { prompt(t('copy_link'), S.connectLink()); } },
  'share-link': () => navigator.share({ title: 'MasterChef', url: S.connectLink() }).catch(() => {}),
  'sync-now': () => S.flush().then(() => toast(S.state.status === 'ok' ? t('sync_ok') : t('sync_error', { e: S.state.error }))),
  disconnect: () => {
    if (!confirm(S.pending() ? t('confirm_disconnect_pending', { n: S.pending() }) : t('confirm_disconnect'))) return;
    S.disconnect(); S.resetLocal(); render();
  },
  'connect-paste': () => { location.hash = '#/settings'; tryConnect($('#pasteLink').value); },
  'connect-clip': async () => { let txt; try { txt = await navigator.clipboard.readText(); } catch { return toast(t('clip_denied')); } location.hash = '#/settings'; tryConnect(txt); },
  'connect-owner': () => {
    const link = S.makeConnect($('#execUrl').value, $('#execKey').value);
    if (!link) return toast(t('bad_owner'));
    tryConnect(link);
  },
  'local-only': () => { S.prefs.set('localOnly', true); render(); },
  'loc-add': () => S.save('Locations', { name: t('new_location'), kind: 'other', sort: locs().length + 1 }),
  'loc-del': el => {
    if (S.rows('Storage').some(i => i.locationId === el.dataset.v)) return toast(t('loc_not_empty'));
    if (locs().length <= 1) return toast(t('loc_last'));
    S.remove('Locations', el.dataset.v);
  },
  install: async () => { installEvt.prompt(); await installEvt.userChoice; installEvt = null; render(); },
  units: () => { S.prefs.set('units', units() === 'us' ? 'metric' : 'us'); rerenderKeepingDraft(); },
  syncinfo: () => { const p = S.pending(); toast($('#sync').title + (p && S.state.status !== 'offline' ? '' : '')); if (S.connection()) S.flush(); },
};
function rerenderKeepingDraft() { const y = scrollY; render(); scrollTo(0, y); }
function stepServ(dir) {
  const r = S.byId('Recipes', route().id), sv = scaleState(r);
  if (sv.mode === 'anchor') { sv.servings = Math.max(0.5, Math.round((Number(r.servings) || 1) * factor(r, sv))); sv.mode = 'servings'; sv.haveQty = ''; $('#haveQty') && ($('#haveQty').value = ''); }
  const step = sv.servings + dir < 2 || sv.servings < 2 ? 0.5 : 1;
  sv.servings = Math.max(0.5, Math.round((sv.servings + dir * step) * 2) / 2);
  updateScaled();
}
function stepQty(id, dir) {
  const i = S.byId('Storage', id);
  if (!i) return;
  const q = Math.max(0, Math.round(((Number(i.qty) || 0) + dir * stepFor(i.unit)) * 100) / 100);
  ui.zeroId = q === 0 ? id : ui.zeroId === id ? '' : ui.zeroId;
  S.save('Storage', { ...i, qty: q });
}

// ---------- events ----------
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || !actions[el.dataset.act]) return;
  if (el.tagName === 'INPUT' && el.type === 'checkbox') { actions[el.dataset.act](el, e); return; }
  e.preventDefault();
  actions[el.dataset.act](el, e);
});
document.addEventListener('input', e => {
  const el = e.target, form = el.closest('form[data-form]');
  if (form && form.dataset.form === 'recipe') return readRecipeField(el);
  if (form && form.dataset.form === 'item') return readItemField(el);
  const k = el.dataset.in;
  if (!k) return;
  if (k === 'q') { ui.q = el.value; $('#list').innerHTML = recipeCards(); }
  else if (k === 'afQ') { ui.afQ = el.value; $('#list').innerHTML = afRows(); }
  else if (k === 'sQ') { ui.sQ = el.value; $('#list').innerHTML = storageRows(); }
  else if (k === 'cvT' || k === 'cvM' || k === 'cvK') {
    const v = n => view.querySelector(`[data-in="${n}"]`).value;
    $('#conv').innerHTML = convResult(v('cvT'), v('cvM'), v('cvK'));
  } else if (k === 'haveQty' || k === 'haveUnit') {
    ui.sv[k] = el.value; ui.sv.mode = C.parseQty(ui.sv.haveQty) > 0 ? 'anchor' : 'servings'; updateScaled();
  } else if (k === 'warnDays') { const n = parseInt(el.value, 10); if (n >= 0 && n <= 60) S.prefs.set('warnDays', n); chrome(route()); }
  else if (k === 'name') S.prefs.set('name', el.value.slice(0, 40));
});
document.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset.in === 'lang') { setLang(el.value); render(); }
  else if (el.dataset.in === 'unitsSel') { S.prefs.set('units', el.value); render(); }
  else if (el.dataset.loc) { const l = S.byId('Locations', el.dataset.loc); if (l && el.value.trim()) S.save('Locations', { ...l, name: el.value.trim().slice(0, 40) }); }
  else if (el.dataset.lockind) { const l = S.byId('Locations', el.dataset.lockind); if (l) S.save('Locations', { ...l, kind: el.value }); }
});
document.addEventListener('submit', e => {
  const f = e.target.dataset.form;
  if (!f) return;
  e.preventDefault();
  if (f === 'recipe') saveRecipe();
  else if (f === 'item') saveItem();
  else if (f === 'shop') {
    const name = $('#shopName').value.trim();
    if (!name) return $('#shopName').focus();
    const qty = C.parseQty($('#shopQty').value);
    S.save('Shopping', { name: name.slice(0, 120), qty, unit: $('#shopUnit').value.trim(), done: false, recipeId: '' });
    render(); $('#shopName')?.focus();
  }
});

let lastRoute = '';
addEventListener('hashchange', () => {
  if (location.hash.includes('connect=')) return handleConnectHash();
  const r = route(), key = r.name + '/' + r.id + '/' + r.sub;
  if (!isEditing(r)) ui.draftKey = '';
  if (key !== lastRoute) { ui.zeroId = ''; lastRoute = key; render(); scrollTo(0, 0); }
});
S.on(what => {
  if (what === 'status') { syncDot(); if (route().name === 'settings' && S.connection() && !isTyping()) rerenderKeepingDraft(); return; }
  if (what === 'rejected') { toast(t('rejected')); return; }
  if (what === 'unauthorized') { toast(t('unauthorized')); location.hash = '#/settings'; return; }
  const r = route();
  if (isEditing(r) || isTyping()) { chrome(r); return; }
  if (r.name === 'recipe') {
    const rec = S.byId('Recipes', r.id);
    chrome(r);
    if (rec && $('#scaled') && rec.updatedAt === ui.shownAt) updateScaled(); else rerenderKeepingDraft();
    return;
  }
  rerenderKeepingDraft();
});
const isTyping = () => { const a = document.activeElement; return a && view.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== 'checkbox'; };

function handleConnectHash() {
  const link = location.hash;
  history.replaceState(null, '', location.pathname + location.search + '#/settings');
  lastRoute = 'settings//';
  tryConnect(link);
}

addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; if (route().name === 'settings') render(); });
$('#units').addEventListener('click', () => actions.units());
$('#sync').addEventListener('click', () => actions.syncinfo());
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => {});

// boot
if (location.hash.includes('connect=')) handleConnectHash(); else { lastRoute = ''; render(); }
lastRoute = (r => r.name + '/' + r.id + '/' + r.sub)(route());
S.flush();
