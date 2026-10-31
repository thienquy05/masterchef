// Assert-based self-test. Run: `node core.test.js` or open test.html.
import * as C from './core.js';
import { D } from './i18n.js';
import { AIRFRYER, SHELF } from './data.js';

let pass = 0;
const fails = [];
const eq = (a, b, msg) => {
  const ok = typeof b === 'number' ? Math.abs(a - b) < 1e-3 : JSON.stringify(a) === JSON.stringify(b);
  ok ? pass++ : fails.push(`${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
};
const us = (q, u, o = {}) => C.fmtAmount(q, u, { system: 'us', ...o });
const met = (q, u, o = {}) => C.fmtAmount(q, u, { system: 'metric', ...o });
const sc = (qty, unit, cls, f, ctx) => C.scaleQty({ qty, unit, class: cls }, f, ctx);

// units
eq(C.toBase(3, 'tsp'), C.toBase(1, 'tbsp'), '3 tsp = 1 tbsp');
eq(C.toBase(1, 'cup'), 236.5882365, '1 cup mL');
eq(C.canonUnit('T'), 'tbsp', 'T'); eq(C.canonUnit('t'), 'tsp', 't'); eq(C.canonUnit('muỗng canh'), 'tbsp', 'muỗng canh');
eq(C.dimOf('fl oz'), 'vol', 'fl oz is volume'); eq(C.dimOf('oz'), 'wt', 'oz is weight');

// US volume formatting
eq(us(6, 'tsp'), '2 tbsp', '6 tsp');
eq(us(16, 'tbsp'), '1 cup', '16 tbsp');
eq(us(3, 'tbsp'), '3 tbsp', '3 tbsp');
eq(us(1.125, 'cup'), '1 cup + 2 tbsp', '1.125 cup');
eq(us(4 / 3, 'tbsp'), '1 tbsp + 1 tsp', '1.333 tbsp');
eq(us(0.1, 'tsp'), 'pinch', '0.1 tsp');
eq(us(3.5, 'cup'), '3½ cups', '3.5 cups');
eq(us(0.25, 'cup'), '¼ cup', '¼ cup'); eq(us(1 / 3, 'cup'), '⅓ cup', '⅓ cup'); eq(us(5 / 3, 'cup'), '1⅔ cups', '1⅔ cups');
eq(us(sc(3, 'tbsp', 'salt', 2), 'tbsp'), '⅓ cup', 'fish sauce 3 tbsp ×2 smart (5 tbsp) → ⅓ cup');

// scaling
eq(us(sc(1, 'tsp', 'salt', 2), 'tsp'), '1¾ tsp', 'salt ×2 smart');
eq(us(sc(1, 'tsp', 'salt', 4), 'tsp'), '2¾ tsp', 'salt ×4 smart');
eq(us(sc(1, 'tsp', 'salt', 2, { exact: true }), 'tsp'), '2 tsp', 'salt ×2 exact');
eq(us(sc(1, 'tsp', 'salt', 0.5), 'tsp'), '½ tsp', 'salt ×0.5');
eq(us(sc(1, 'pinch', 'fixed', 0.5), 'pinch'), 'pinch', 'pinch ×0.5');
eq(sc(2, '', 'fixed', 3), 2, 'bay leaf ×3');
eq(sc(null, '', 'toTaste', 3), null, 'to taste');
eq(us(sc(1, 'tsp', 'leavening', 2), 'tsp'), '1¾ tsp', 'leavening ×2');
eq(us(sc(2, 'cup', 'liquid', 2), 'cup'), '3½ cups', 'braise liquid ×2');
eq(sc(2, 'cup', 'liquid', 2, { exact: true }), 4, 'liquid ×2 exact');
eq(us(sc(2.25, 'cup', 'grainWater', 2, { grainMl: C.toBase(1.5, 'cup') }), 'cup'), '3¾ cups', 'rice water ×2 (ATK)');
eq(sc(2.25, 'cup', 'grainWater', 2), 4.5, 'grain water without anchor falls back to linear');
eq(sc(1, 'tsp', 'ratio', 3), 3, 'ratio is linear');
eq(us(1.2, 'tsp', { up: true }), '1¼ tsp', 'round up'); eq(us(1.2, 'tsp'), '1¼ tsp', 'nearest');

// eggs
eq(C.eggCount(3 * 1.5), { whole: 4, half: true }, 'eggs 3×1.5');
eq(C.eggCount(2 * 1.1), { whole: 2, half: false }, 'eggs 2×1.1');
eq(C.eggCount(2 * 1.4), { whole: 3, half: false }, 'eggs 2×1.4');
eq(C.eggCount(1 * 0.3), { whole: 1, half: false }, 'eggs 1×0.3');

// anchor
eq(C.anchorFactor({ qty: 1, unit: 'lb', name: 'chicken' }, 680, 'g'), 1.4991, 'anchor 1 lb → 680 g');
eq(C.anchorFactor({ qty: 1, unit: 'cup', name: 'flour' }, 240, 'g'), 2, 'anchor cup flour → grams via density');
eq(C.anchorFactor({ qty: 1, unit: 'cup', name: 'mystery' }, 240, 'g'), null, 'anchor without density');

// metric & weight
eq(met(1, 'cup', { name: 'all-purpose flour' }), '120 g', '1 cup flour metric');
eq(met(1, 'cup', { name: 'milk' }), '235 mL', '1 cup milk metric');
eq(met(7.3, 'g'), '7.5 g', '7.3 g'); eq(met(1234, 'g'), '1.23 kg', '1234 g');
eq(met(1, 'tsp', { name: 'salt' }), '1 tsp', 'small volumes stay spoons in metric');
eq(us(300, 'g'), '10½ oz', '300 g US'); eq(us(567, 'g'), '1 lb 4 oz', '567 g US'); eq(us(2, 'lb'), '2 lb', '2 lb');
eq(us(3, 'cloves'), '3 cloves', 'count unit'); eq(us(2.4, ''), '2½', 'count halves');

// parsing
eq(C.parseQty('1 1/2'), 1.5, '1 1/2'); eq(C.parseQty('1½'), 1.5, '1½'); eq(C.parseQty('0,5'), 0.5, '0,5');
eq(C.parseQty(''), null, 'empty'); eq(C.parseQty('2-3'), 2, 'range'); eq(C.parseQty('abc'), null, 'text');
eq(C.parseLine('2 tbsp fish sauce'), { qty: 2, unit: 'tbsp', name: 'fish sauce' }, 'parseLine tbsp');
eq(C.parseLine('1 1/2 cups flour'), { qty: 1.5, unit: 'cup', name: 'flour' }, 'parseLine mixed');
eq(C.parseLine('3 eggs'), { qty: 3, unit: '', name: 'eggs' }, 'parseLine count');
eq(C.parseLine('2 cloves garlic'), { qty: 2, unit: 'cloves', name: 'garlic' }, 'parseLine count word');
eq(C.parseLine('2 muỗng canh nước mắm'), { qty: 2, unit: 'tbsp', name: 'nước mắm' }, 'parseLine vi unit');
eq(C.parseLine('salt to taste'), { qty: null, unit: '', name: 'salt to taste' }, 'parseLine no qty');

// classify
eq(C.classify('Nước mắm', 'tbsp'), 'salt', 'nước mắm'); eq(C.classify('nuoc mam', 'tbsp'), 'salt', 'no accents');
eq(C.classify('ớt chuông', ''), 'normal', 'bell pepper vi'); eq(C.classify('red chili', ''), 'hot', 'chili');
eq(C.classify('baking powder', 'tsp'), 'leavening', 'baking powder'); eq(C.classify('cinnamon stick', ''), 'fixed', 'cinnamon stick');
eq(C.classify('yeast', 'tsp'), 'normal', 'yeast'); eq(C.classify('eggplant', ''), 'normal', 'eggplant');
eq(C.classify('eggs', ''), 'egg', 'eggs'); eq(C.classify('salt', 'pinch'), 'fixed', 'pinch unit');
eq(C.classify('salt', '', null), 'toTaste', 'no qty'); eq(C.classify('Prague powder #1', 'g'), 'ratio', 'curing salt');
eq(C.classify('unsalted butter', 'tbsp'), 'normal', 'unsalted butter'); eq(C.classify('peanut butter', 'tbsp'), 'normal', 'peanut butter');
eq(C.classify('chicken stock', 'cup'), 'liquid', 'stock'); eq(C.classify('olive oil', 'tbsp'), 'oil', 'oil');
eq(C.classify('oil for frying', 'cup'), 'fixed', 'frying oil');

// density
eq(C.density('peanut butter').gPerCup, 270, 'peanut butter beats butter');
eq(C.density('nước mắm').gPerCup, 288, 'nước mắm beats nước');

// safe temps & matching
eq(C.safeTempFor([{ name: 'boneless chicken thighs' }]), { tempF: 165, rest: false }, 'poultry');
eq(C.safeTempFor([{ name: 'pork belly' }]), { tempF: 145, rest: true }, 'pork');
eq(C.safeTempFor([{ name: 'ground beef' }]), { tempF: 160, rest: false }, 'ground');
eq(C.safeTempFor([{ name: 'bơ' }, { name: 'cà chua' }]), null, 'butter/tomato are not meat');
eq(C.safeTempFor([{ name: 'fish sauce', class: 'salt' }, { name: 'ground cumin', class: 'spice' }]), null, 'seasonings are not meat');
eq(C.safeTempFor([{ name: 'bò viên' }]), { tempF: 160, rest: false }, 'meatballs are ground');
eq(C.safeTempFor([{ name: 'salmon fillet' }]), { tempF: 145, rest: false }, 'fish: no rest');
eq(C.classify('cá hồi', 'lb'), 'normal', 'salmon vi is not star anise'); eq(C.classify('hoa hồi', ''), 'spice', 'star anise');
eq(C.classify('egg noodles', ''), 'normal', 'egg noodles'); eq(C.classify('hot sauce', 'tbsp'), 'hot', 'hot sauce');
eq(C.density('kosher salt'), null, 'unbranded kosher salt has no density');
eq(C.parseLine('500g chicken thighs'), { qty: 500, unit: 'g', name: 'chicken thighs' }, 'parseLine 500g');
eq(us(0.2, 'cloves'), '½ cloves', 'tiny count never shows 0');
eq(C.nameMatch('Red Boat fish sauce', 'fish sauce'), true, 'match contains');
eq(C.nameMatch('salted butter', 'salt'), false, 'no partial word');

// air fryer
eq(C.ovenToAirFryer({ temp: 400, min: 25 }), { temp: 375, min: 20, checkAt: 15 }, 'fresh °F');
eq(C.ovenToAirFryer({ temp: 425, min: 20, kind: 'frozenCooked' }), { temp: 425, min: 14, checkAt: 11 }, 'frozen cooked');
eq(C.ovenToAirFryer({ temp: 400, min: 20, kind: 'frozenRaw' }), { refuse: true }, 'frozen raw refuses');
eq(C.ovenToAirFryer({ temp: 200, min: 30, unit: 'C' }), { temp: 185, min: 24, checkAt: 18 }, 'fresh °C');

// expiry
const it = { expiry: '2026-11-10', openedAt: '2026-11-01', openedDays: 3 };
eq(C.effectiveExpiry(it), '2026-11-04', 'opened rule wins');
eq(C.effectiveExpiry({ expiry: '2026-11-02', openedAt: '2026-11-01', openedDays: 3 }), '2026-11-02', 'printed date wins');
eq(C.daysLeft('2026-11-04', '2026-11-02'), 2, 'days left');
eq(C.expiryStatus(it, '2026-11-02', 3).status, 'soon', 'soon');
eq(C.expiryStatus(it, '2026-11-05', 3).status, 'expired', 'expired');
eq(C.expiryStatus({}, '2026-11-05', 3).status, 'none', 'no date');
eq(C.addDays('2026-12-31', 1), '2027-01-01', 'year rollover');
eq(C.addDays('2026-03-07', 2), '2026-03-09', 'across US DST');

// data & i18n integrity
eq(Object.keys(D.en).sort(), Object.keys(D.vi).sort(), 'en/vi key parity');
eq(AIRFRYER.every(r => r.length === 10 && r[3] > 0 && r[4] <= r[5]), true, 'airfryer rows');
eq(SHELF.every(r => r.length === 8), true, 'shelf rows');

const out = `core tests: ${pass} passed, ${fails.length} failed` + (fails.length ? '\n' + fails.join('\n') : '');
if (typeof document !== 'undefined') document.body.textContent = out; // test.html
else { console.log(out); if (fails.length) process.exitCode = 1; }
