// Pure logic (no DOM): units, scaling, formatting, parsing, air-fryer conversion, expiry math.
import { DENSITY } from './data.js';

// ---------- text ----------
export const norm = s => String(s ?? '').toLowerCase().normalize('NFD')
  .replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/\s+/g, ' ').trim();
const hasWord = (text, w) => (' ' + text.replace(/[^a-z0-9]+/g, ' ') + ' ').includes(' ' + w + ' ');
const hasAny = (text, words) => words.some(w => hasWord(text, w));

// ---------- units ----------
// Exact by definition (1 gal = 231 in³, 1 in = 25.4 mm, 1 lb = 453.59237 g).
export const ML = { tsp: 4.92892159375, tbsp: 14.78676478125, floz: 29.5735295625, cup: 236.5882365,
  pint: 473.176473, quart: 946.352946, gallon: 3785.411784, ml: 1, l: 1000 };
export const G = { oz: 28.349523125, lb: 453.59237, g: 1, kg: 1000 };

const ALIAS = {
  tsp: ['tsp', 'tsps', 'teaspoon', 'teaspoons', 'muong ca phe', 'mcf', 'thia ca phe'],
  tbsp: ['tbsp', 'tbsps', 'tbs', 'tbl', 'tablespoon', 'tablespoons', 'muong canh', 'thia canh'],
  cup: ['cup', 'cups', 'c', 'chen'], floz: ['fl oz', 'floz', 'fl. oz', 'fluid ounce', 'fluid ounces'],
  pint: ['pint', 'pints', 'pt'], quart: ['quart', 'quarts', 'qt'], gallon: ['gallon', 'gallons', 'gal'],
  ml: ['ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres'], l: ['l', 'liter', 'liters', 'litre', 'litres', 'lit'],
  oz: ['oz', 'ounce', 'ounces'], lb: ['lb', 'lbs', 'pound', 'pounds'], g: ['g', 'gram', 'grams', 'gr', 'gam'],
  kg: ['kg', 'kgs', 'kilogram', 'kilograms', 'kilo', 'ky', 'ki lo'], pinch: ['pinch', 'pinches', 'nhum'], dash: ['dash', 'dashes'],
};
const UNIT_OF = {};
for (const [u, list] of Object.entries(ALIAS)) for (const a of list) UNIT_OF[a] = u;
const COUNT_WORDS = ['pc', 'pcs', 'piece', 'pieces', 'each', 'clove', 'cloves', 'tep', 'qua', 'trai', 'cu', 'cai', 'con',
  'bottle', 'bottles', 'can', 'cans', 'pack', 'packs', 'bunch', 'bunches', 'bo', 'slice', 'slices', 'lat', 'stalk', 'stalks',
  'cay', 'nhanh', 'leaf', 'leaves', 'la', 'sprig', 'sprigs', 'head', 'heads', 'bag', 'bags', 'box', 'boxes', 'goi', 'hop'];

/** Canonical unit key for measure units; count words and unknown text are returned trimmed as-is. */
export function canonUnit(u) {
  const raw = String(u ?? '').trim();
  if (raw === 'T') return 'tbsp';
  if (raw === 't') return 'tsp';
  return UNIT_OF[norm(raw).replace(/\.$/, '')] || raw;
}
export function dimOf(u) {
  const c = canonUnit(u);
  if (c in ML) return 'vol';
  if (c in G) return 'wt';
  if (c === 'pinch' || c === 'dash') return 'pinch';
  return 'count';
}
/** Quantity in base units: mL for volume, g for weight, the number itself otherwise. */
export function toBase(qty, u) {
  const c = canonUnit(u);
  return qty * (ML[c] ?? G[c] ?? 1);
}
export const fromBase = (v, u) => { const c = canonUnit(u); return v / (ML[c] ?? G[c] ?? 1); };

/** {gPerCup, liquid} for the longest alias contained in the name, or null. */
const DENS = DENSITY.flatMap(([aliases, g, liquid]) => aliases.map(a => [norm(a), g, !!liquid]))
  .sort((a, b) => b[0].length - a[0].length);
export function density(name) {
  const n = norm(name);
  if (hasWord(n, 'kosher') && !/diamond|morton/.test(n)) return null; // brands differ 2× by volume
  const hit = DENS.find(([a]) => hasWord(n, a) || (a.includes(' ') && n.includes(a)));
  return hit ? { gPerCup: hit[1], liquid: hit[2] } : null;
}

// ---------- classification ----------
// First match wins. Normalised (accent-free) words so "nuoc mam" and "nước mắm" both match.
const RULES = [
  ['ratio', ['curing salt', 'cure', 'prague powder', 'pink salt', 'nitrite', 'muoi diem']],
  ['normal', ['bell pepper', 'bell peppers', 'ot chuong', 'yeast', 'men no', 'men', 'eggplant', 'eggplants', 'egg noodle', 'egg noodles',
    'egg roll', 'egg rolls', 'egg roll wrappers', 'mi trung', 'ca hoi', 'salmon', 'coconut water', 'nuoc dua']],
  ['fixed', ['bay leaf', 'bay leaves', 'la nguyet que', 'cinnamon stick', 'cinnamon sticks', 'garnish', 'for garnish',
    'for frying', 'for deep frying', 'de chien', 'trang tri', 'star anise pod']],
  ['leavening', ['baking powder', 'baking soda', 'bicarbonate', 'bot no', 'muoi no']],
  ['egg', ['egg', 'eggs', 'trung', 'trung ga', 'trung vit', 'egg yolk', 'egg yolks', 'egg white', 'egg whites']],
  ['salt', ['salt', 'kosher salt', 'sea salt', 'table salt', 'fish sauce', 'soy sauce', 'msg', 'bouillon', 'oyster sauce',
    'muoi', 'nuoc mam', 'nuoc tuong', 'xi dau', 'bot ngot', 'hat nem', 'dau hao', 'mam tom', 'mam ruoc', 'mam nem']],
  ['hot', ['chili', 'chilis', 'chilies', 'chilli', 'chillies', 'chile', 'chiles', 'cayenne', 'sriracha', 'chili flakes',
    'red pepper flakes', 'jalapeno', 'hot sauce', 'ot', 'tuong ot', 'ot bot', 'sa te', 'sate']],
  ['spice', ['pepper', 'black pepper', 'white pepper', 'cumin', 'paprika', 'cinnamon', 'turmeric', 'curry', 'curry powder',
    'five spice', 'nutmeg', 'oregano', 'thyme', 'coriander', 'allspice', 'star anise', 'vinegar', 'lime juice', 'lemon juice',
    'vanilla', 'extract', 'tieu', 'hat tieu', 'que', 'bot que', 'hoa hoi', 'ca ri', 'bot ca ri', 'ngu vi huong', 'nghe', 'bot nghe',
    'giam', 'nuoc cot chanh', 'vani']],
  ['oil', ['oil', 'olive oil', 'vegetable oil', 'sesame oil', 'canola oil', 'dau an', 'dau o liu', 'dau me', 'dau thuc vat']],
  ['liquid', ['stock', 'broth', 'nuoc dung', 'nuoc ham', 'wine', 'ruou', 'ruou vang']],
];
export const CLASSES = ['normal', 'salt', 'spice', 'hot', 'leavening', 'oil', 'liquid', 'grainWater', 'egg', 'fixed', 'toTaste', 'ratio'];

export function classify(name, unit = '', qty = 1) {
  if (qty === null || qty === undefined || qty === '') return 'toTaste';
  if (dimOf(unit) === 'pinch') return 'fixed';
  const n = norm(name);
  for (const [cls, words] of RULES) if (hasAny(n, words)) return cls === 'egg' && dimOf(unit) !== 'count' ? 'normal' : cls;
  return 'normal';
}

// ---------- scaling ----------
const K = { salt: 0.75, spice: 0.75, hot: 0.6, leavening: 0.8, oil: 0.7 };
export const SUBLINEAR = new Set([...Object.keys(K), 'liquid']);

/**
 * Scaled quantity in the ingredient's own unit (null = to taste).
 * ctx.exact: every sub-linear class scales linearly (sauces, brines, cures).
 * ctx.grainMl: base volume (mL) of the grain anchor, needed by grainWater.
 */
export function scaleQty(ing, f, ctx = {}) {
  const { qty, unit } = ing;
  if (qty === null || qty === undefined || qty === '') return null;
  let c = ing.class || 'normal';
  if (c === 'fixed' || c === 'toTaste') return qty;
  if (ctx.exact && SUBLINEAR.has(c)) c = 'normal';
  if (c === 'grainWater') {
    // ATK rule: absorbed water scales, evaporation stays the same. E = water - grain volume.
    if (!ctx.grainMl || dimOf(unit) !== 'vol') return qty * f;
    const W = toBase(qty, unit), E = Math.max(0, W - ctx.grainMl);
    return fromBase((W - E) * f + E, unit);
  }
  if (f < 1) return qty * f;                       // scaling down: plain multiply, then taste
  if (K[c] !== undefined) return qty * f ** K[c];
  if (c === 'liquid') return qty * (0.75 * f + 0.25); // same pot: ~25% of the liquid is evaporation
  return qty * f;
}

/** Factor from "I have haveQty haveUnit" of the anchor ingredient; null when units can't be compared. */
export function anchorFactor(anchor, haveQty, haveUnit) {
  if (!anchor || !(anchor.qty > 0) || !(haveQty > 0)) return null;
  const da = dimOf(anchor.unit), dh = dimOf(haveUnit);
  if (da === dh) {
    if (da === 'count' && norm(canonUnit(anchor.unit)) !== norm(canonUnit(haveUnit))) return null;
    return toBase(haveQty, haveUnit) / toBase(anchor.qty, anchor.unit);
  }
  const d = density(anchor.name);
  if (!d || da === 'count' || dh === 'count' || da === 'pinch' || dh === 'pinch') return null;
  const grams = (q, u) => dimOf(u) === 'wt' ? toBase(q, u) : toBase(q, u) / ML.cup * d.gPerCup;
  return grams(haveQty, haveUnit) / grams(anchor.qty, anchor.unit);
}

/** Whole eggs with the ½-egg rule: {whole, half}. */
export function eggCount(n) {
  if (n < 1) return { whole: 1, half: false };
  const w = Math.floor(n), fr = n - w;
  if (fr < 0.25) return { whole: w, half: false };
  if (fr >= 0.75) return { whole: w + 1, half: false };
  return { whole: w, half: true };
}

// ---------- formatting ----------
const GLYPH = { 0.125: '⅛', 0.25: '¼', 0.5: '½', 0.75: '¾' };
const glyph = fr => GLYPH[fr] ?? (Math.abs(fr - 1 / 3) < 1e-4 ? '⅓' : Math.abs(fr - 2 / 3) < 1e-4 ? '⅔' : '');
const FR = { cup: [0, 1 / 4, 1 / 3, 1 / 2, 2 / 3, 3 / 4, 1], tbsp: [0, 1 / 2, 1], tsp: [0, 1 / 8, 1 / 4, 1 / 2, 3 / 4, 1],
  q: [0, 1 / 4, 1 / 2, 3 / 4, 1], h: [0, 1 / 2, 1] };

/** Snap x to whole + nearest allowed fraction (ties go down); up=true takes the first fraction ≥ the remainder. */
export function snap(x, fr, up = false) {
  const w = Math.floor(x + 1e-9), r = x - w;
  let best = fr[0];
  if (up) best = fr.find(f => f >= r - 1e-9) ?? 1;
  else for (const f of fr) if (Math.abs(f - r) < Math.abs(best - r) - 1e-9) best = f;
  return w + best;
}
export function fracStr(v) {
  const w = Math.floor(v + 1e-9), g = glyph(Math.round((v - w) * 1e6) / 1e6);
  return w ? (g ? w + g : String(w)) : (g || '0');
}
const num = (v, lang, digits = 2) => new Intl.NumberFormat(lang || 'en', { maximumFractionDigits: digits }).format(v);

function usVolume(ml, up) {
  if (ml < ML.tsp / 8 - 1e-9) return 'pinch';
  if (ml >= ML.gallon) return fracStr(snap(ml / ML.gallon, FR.q, up)) + ' gal';
  if (ml >= ML.cup / 4 - 1e-6) {
    const x = ml / ML.cup, s = snap(x, FR.cup, up);
    if (Math.abs(s - x) / x <= 0.1) return fracStr(s) + (s > 1 ? ' cups' : ' cup');
    const w = Math.floor(x + 1e-9), tb = snap((x - w) * 16, FR.tbsp, up);
    if (tb >= 16) return (w + 1) + (w + 1 > 1 ? ' cups' : ' cup');
    return w ? `${w} ${w > 1 ? 'cups' : 'cup'} + ${fracStr(tb)} tbsp` : fracStr(tb) + ' tbsp';
  }
  if (ml >= ML.tbsp - 1e-6) {
    const x = ml / ML.tbsp, s = snap(x, FR.tbsp, up);
    if (Math.abs(s - x) / x <= 0.1) return fracStr(s) + ' tbsp';
    const w = Math.floor(x + 1e-9), ts = snap((x - w) * 3, FR.tsp, up);
    if (ts >= 3) return (w + 1) + ' tbsp';
    return ts ? `${w} tbsp + ${fracStr(ts)} tsp` : `${w} tbsp`;
  }
  return fracStr(snap(ml / ML.tsp, FR.tsp, up)) + ' tsp';
}
function metricGrams(g, lang) {
  if (g >= 1000) return num(g / 1000, lang) + ' kg';
  const step = g < 10 ? 0.5 : g < 100 ? 1 : 5;
  return num(Math.max(step, Math.round(g / step) * step), lang, 1) + ' g';
}
function usWeight(g, up, lang) {
  if (g < 7) return metricGrams(g, lang);          // tiny weights (yeast, saffron) read better in grams
  const oz = g / G.oz;
  if (oz < 16 - 0.125) return fracStr(snap(oz, FR.q, up)) + ' oz';
  let lb = Math.floor(oz / 16), r = Math.round(oz - lb * 16);
  if (r === 16) { lb++; r = 0; }
  return r ? `${lb} lb ${r} oz` : `${lb} lb`;
}

/**
 * Display an amount. opts: {system:'us'|'metric', name, up, lang}.
 * Volume stays volume in US; metric shows grams for solids with a known density. Weight never becomes volume.
 */
export function fmtAmount(qty, unit, opts = {}) {
  if (qty === null || qty === undefined) return '';
  const { system = 'us', name = '', up = false, lang = 'en' } = opts;
  const dim = dimOf(unit), c = canonUnit(unit);
  if (dim === 'pinch') return c;
  if (dim === 'count') {
    let v = qty >= 10 ? (up ? Math.ceil(qty - 1e-9) : Math.round(qty)) : snap(qty, FR.h, up);
    if (qty > 0 && v === 0) v = 0.5;
    return (fracStr(v) + ' ' + c).trim();
  }
  if (dim === 'vol') {
    const ml = toBase(qty, unit);
    if (system === 'us' || ml < ML.tbsp - 1e-6) return usVolume(ml, up);   // spoons are universal
    const d = density(name);
    if (d && !d.liquid) return metricGrams(ml / ML.cup * d.gPerCup, lang);
    if (ml >= 1000) return num(ml / 1000, lang) + ' L';
    return num(Math.round(ml / 5) * 5, lang) + ' mL';
  }
  const g = toBase(qty, unit);
  return system === 'us' ? usWeight(g, up, lang) : metricGrams(g, lang);
}

// ---------- parsing ----------
const UFRAC = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875 };
const QTY_TOKEN = /^(\d+([.,]\d+)?|\d+\/\d+|\d*[½¼¾⅓⅔⅛⅜⅝⅞]|\d+([.,]\d+)?-\d+([.,]\d+)?)$/;

/** "1 1/2", "1½", "1/2", "0,5", "2-3" (first number) → number; empty/invalid → null. */
export function parseQty(s) {
  const str = String(s ?? '').trim();
  if (!str) return null;
  let total = 0, any = false;
  for (let tok of str.split(/\s+/)) {
    tok = tok.split('-')[0];
    let m;
    if ((m = tok.match(/^(\d*)([½¼¾⅓⅔⅛⅜⅝⅞])$/))) { total += (+m[1] || 0) + UFRAC[m[2]]; any = true; }
    else if ((m = tok.match(/^(\d+)\/(\d+)$/)) && +m[2]) { total += m[1] / m[2]; any = true; }
    else if (/^\d+([.,]\d+)?$/.test(tok)) { total += parseFloat(tok.replace(',', '.')); any = true; }
    else return null;
  }
  return any ? total : null;
}

/** "2 tbsp fish sauce" → {qty:2, unit:'tbsp', name:'fish sauce'}. Unknown units stay part of the name. */
export function parseLine(line) {
  const toks = String(line ?? '').trim().replace(/^(\d+(?:[.,]\d+)?)(g|kg|ml|l|oz|lb|lbs)(?=\s|$)/i, '$1 $2').split(/\s+/).filter(Boolean);
  const q = [];
  while (toks.length && q.length < 2 && QTY_TOKEN.test(toks[0])) q.push(toks.shift());
  const qty = q.length ? parseQty(q.join(' ')) : null;
  let unit = '';
  if (qty !== null && toks.length > 1) {
    for (const n of [3, 2, 1]) {                       // "muỗng cà phê", "fl oz", "tbsp"
      if (toks.length <= n) continue;
      const cand = toks.slice(0, n).join(' ');
      if (UNIT_OF[norm(cand).replace(/\.$/, '')] || cand === 'T' || cand === 't') { unit = canonUnit(cand); toks.splice(0, n); break; }
      if (n === 1 && COUNT_WORDS.includes(norm(cand))) { unit = cand; toks.splice(0, 1); break; }
    }
  }
  const name = toks.join(' ').replace(/^of\s+/i, '');
  return { qty, unit, name };
}

// ---------- recipe helpers ----------
const SAFE_WORDS = {
  poultry: ['chicken', 'turkey', 'duck', 'poultry', 'ga', 'thit ga', 'canh ga', 'dui ga', 'uc ga', 'vit'],
  ground: ['ground', 'minced', 'mince', 'sausage', 'meatball', 'meatballs', 'xay', 'thit xay', 'thit bam', 'bo vien', 'thit vien', 'xuc xich'],
  whole: ['beef', 'steak', 'pork', 'lamb', 'veal', 'thit bo', 'heo', 'thit heo', 'lon', 'suon', 'ba roi', 'thit cuu'],
  fish: ['fish', 'salmon', 'tuna', 'cod', 'tilapia', 'catfish', 'ca hoi', 'ca basa', 'ca thu', 'ca ngu', 'ca loc', 'ca kho'],
};
const NOT_MEAT = /(^| )(sauce|stock|broth|powder|bouillon|paste|nuoc mam|nuoc dung|mam|hat nem|bot)( |$)/;
/** USDA minimum (°F) for the meat/fish in a recipe: {tempF, rest}; null if none. Seasonings ("fish sauce", "ground cumin") are ignored. */
export function safeTempFor(ingredients) {
  const names = ingredients.filter(i => !i.class || i.class === 'normal' || i.class === 'egg').map(i => norm(i.name)).filter(n => !NOT_MEAT.test(n));
  const has = k => names.some(n => hasAny(n, SAFE_WORDS[k]));
  if (has('poultry')) return { tempF: 165, rest: false };
  if (has('ground')) return { tempF: 160, rest: false };
  if (has('whole')) return { tempF: 145, rest: true };
  if (has('fish')) return { tempF: 145, rest: false };
  return null;
}

/** Does a Storage item name match an ingredient name (accent-insensitive, whole words either way)? */
export function nameMatch(a, b) {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  return x === y || hasWord(x, y) || hasWord(y, x);
}

// ---------- temperatures & air fryer ----------
export const fToC = f => (f - 32) * 5 / 9;
export const cToF = c => c * 9 / 5 + 32;

/** Oven → air fryer. kind: fresh | frozenCooked | frozenRaw. Always computed in °F so both systems agree. */
export function ovenToAirFryer({ temp, min, unit = 'F', kind = 'fresh' }) {
  if (kind === 'frozenRaw') return { refuse: true };
  const tF = unit === 'C' ? cToF(temp) : temp;
  const outF = kind === 'fresh' ? tF - 25 : tF;
  const outMin = Math.round(min * (kind === 'fresh' ? 0.8 : 0.7));
  const t = unit === 'C' ? Math.round(fToC(outF) / 5) * 5 : Math.round(outF / 5) * 5;
  return { temp: t, min: outMin, checkAt: Math.round(outMin * 0.75) };
}

// ---------- dates & expiry ----------
const DAY = 86400000;
const utc = d => { const [y, m, dd] = String(d).split('-').map(Number); return Date.UTC(y, m - 1, dd); };
export const todayStr = (now = new Date()) =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
export const addDays = (d, n) => new Date(utc(d) + n * DAY).toISOString().slice(0, 10);
export const daysLeft = (date, today) => Math.round((utc(date) - utc(today)) / DAY);
const isDate = d => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));

/** The earlier of the printed date and openedAt + openedDays; '' when neither is known. */
export function effectiveExpiry(item) {
  let e = isDate(item.expiry) ? item.expiry : '';
  if (isDate(item.openedAt) && Number(item.openedDays) > 0) {
    const o = addDays(item.openedAt, Number(item.openedDays));
    if (!e || o < e) e = o;
  }
  return e;
}
export function expiryStatus(item, today, warnDays = 3) {
  const e = effectiveExpiry(item);
  if (!e) return { status: 'none', date: '', days: null };
  const d = daysLeft(e, today);
  return { status: d < 0 ? 'expired' : d <= warnDays ? 'soon' : 'ok', date: e, days: d };
}
