# Phone-size browser test. Setup: python3 -m venv .venv && .venv/bin/pip install playwright && PLAYWRIGHT_BROWSERS_PATH=.venv/ms-playwright .venv/bin/python -m playwright install chromium
# Run: python3 -m http.server 8765 &  then  PLAYWRIGHT_BROWSERS_PATH=.venv/ms-playwright .venv/bin/python tests/e2e.py /tmp
import sys, re
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:8765/'
SHOT = sys.argv[1] if len(sys.argv) > 1 else '.'
errors, fails = [], []

def check(cond, msg):
    (None if cond else fails.append(msg))
    print(('PASS ' if cond else 'FAIL ') + msg)

def no_hscroll(page, where):
    w = page.evaluate('document.documentElement.scrollWidth')
    check(w <= 360, f'no horizontal scroll on {where} (scrollWidth={w})')

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 360, 'height': 800}, is_mobile=True, has_touch=True, device_scale_factor=2)
    page = ctx.new_page()
    page.on('console', lambda m: m.type == 'error' and errors.append(m.text))
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('dialog', lambda d: d.accept())

    page.goto(BASE + 'test.html'); page.wait_for_timeout(800)
    check('0 failed' in page.inner_text('body'), 'test.html self-test: ' + page.inner_text('body')[:60])

    page.goto(BASE); page.wait_for_selector('text=Add 4 sample recipes')
    page.screenshot(path=f'{SHOT}/01-empty.png'); no_hscroll(page, 'recipes empty')
    page.click('text=Add 4 sample recipes'); page.wait_for_selector('text=Steamed jasmine rice')
    page.screenshot(path=f'{SHOT}/02-recipes.png'); no_hscroll(page, 'recipes list')

    # nước chấm: exact ×2
    page.click('a.card:has-text("Nước chấm")'); page.wait_for_selector('#svout')
    for _ in range(6): page.click('[data-act="sv+"]')
    check(page.inner_text('#svout') == '12', 'servings 6 → 12')
    ings = page.inner_text('#scaled')
    check('6 tbsp' in ings and 'fish sauce' in ings, 'nước chấm ×2 exact: fish sauce 6 tbsp')
    page.screenshot(path=f'{SHOT}/03-nuoc-cham-x2.png', full_page=True); no_hscroll(page, 'recipe view')

    # thịt kho: smart scaling ×2 → fish sauce 3 tbsp × 1.68 = 5 tbsp, eggs 12, coconut water 3½ cups
    page.goto(BASE + '#/recipes'); page.click('a.card:has-text("Thịt kho trứng")'); page.wait_for_selector('#svout')
    for _ in range(4): page.click('[data-act="sv+"]')
    s = page.inner_text('#scaled')
    check('3½ cups' in s, 'braise liquid 2 cups ×2 → 3½ cups'); check('12' in s, 'eggs 6 ×2 → 12')
    check('⅓ cup' in s, 'fish sauce 3 tbsp ×2 smart → ⅓ cup (5 tbsp): ' + re.sub(r'\s+', ' ', s)[:200])
    check('Seasoning was increased' in s, 'seasoning warning shown')
    check('145°F' in s, 'pork safe temp 145°F')
    page.click('[data-act="smart"][data-v="0"]')
    check('6 tbsp' in page.inner_text('#scaled'), 'Exact toggle → fish sauce 6 tbsp')
    # anchor: I have 3 lb pork → ×1.5
    page.click('[data-act="sv-reset"]'); page.fill('#haveQty', '3')
    check(page.inner_text('#svout').startswith('≈ 6'), 'anchor 3 lb of 2 lb → ≈ 6 servings: ' + page.inner_text('#svout'))
    check('9' in page.inner_text('#scaled'), 'eggs 6×1.5 = 9')
    page.screenshot(path=f'{SHOT}/04-thit-kho-anchor.png', full_page=True)

    # rice ATK rule
    page.goto(BASE + '#/recipes'); page.click('a.card:has-text("Steamed jasmine rice")'); page.wait_for_selector('#svout')
    for _ in range(4): page.click('[data-act="sv+"]')
    check('3¾ cups' in page.inner_text('#scaled'), 'rice ×2 water → 3¾ cups')
    # metric toggle
    page.click('#units'); page.wait_for_timeout(100)
    s = page.inner_text('#scaled')
    check(' g' in s and 'mL' in s, 'metric: rice grams + water mL: ' + re.sub(r'\s+', ' ', s)[:120])
    page.click('#units')

    # missing → shopping
    page.click('[data-act="to-shop"]'); page.wait_for_timeout(100)
    page.goto(BASE + '#/shopping'); page.wait_for_timeout(100)
    check('jasmine rice' in page.inner_text('#view'), 'missing rice added to shopping')
    page.screenshot(path=f'{SHOT}/05-shopping.png'); no_hscroll(page, 'shopping')
    page.fill('#shopName', 'Milk'); page.fill('#shopQty', '1'); page.fill('#shopUnit', 'gallon'); page.click('form[data-form="shop"] button')
    page.wait_for_selector('text=Milk')
    page.locator('.shop', has_text='Milk').locator('input[type=checkbox]').check(); page.wait_for_timeout(100)
    page.click('[data-act="shop-move"]'); page.wait_for_timeout(150)
    page.goto(BASE + '#/storage'); page.wait_for_timeout(100)
    v = page.inner_text('#view')
    check('Milk' in v and 'Fridge' in v, 'milk moved to Storage, in Fridge')
    check('7d' in v, 'milk gets USDA 7 days: ' + re.sub(r'\s+', ' ', v)[:160])

    # new item via editor + opened rule
    page.click('.fab'); page.wait_for_selector('#iedit')
    page.fill('[data-f="name"]', 'Mayonnaise (commercial)'); page.wait_for_timeout(150)
    page.screenshot(path=f'{SHOT}/06-item-editor.png', full_page=True); no_hscroll(page, 'item editor')
    check(page.input_value('[data-f="locationId"]') == 'loc-pantry', 'mayo auto → Pantry')
    page.click('[data-act="open-now"]'); page.wait_for_timeout(150)  # dialog auto-accepts → move to fridge
    check(page.input_value('[data-f="locationId"]') == 'loc-fridge', 'opened mayo → moved to Fridge')
    check(page.input_value('[data-f="openedDays"]') == '60', 'mayo opened → 60 days')
    page.click('#iedit button[type=submit]'); page.wait_for_timeout(150)
    # expired item
    page.click('.fab'); page.wait_for_selector('#iedit')
    page.fill('[data-f="name"]', 'Old yogurt'); page.fill('[data-f="expiry"]', '2026-10-01')
    page.click('#iedit button[type=submit]'); page.wait_for_timeout(150)
    v = page.inner_text('#view')
    check('EXPIRED' in v.upper() and 'expired' in v, 'expired group shown')
    check(page.inner_text('#badge') == '1', 'storage badge counts 1 expired: ' + page.inner_text('#badge'))
    page.screenshot(path=f'{SHOT}/07-storage.png', full_page=True); no_hscroll(page, 'storage')
    # qty stepper to zero
    row = page.locator('.item', has_text='Old yogurt')
    row.locator('[data-act="q-"]').click(); page.wait_for_timeout(100)
    check(page.locator('.zero-actions').count() == 1, 'qty 0 → used-up actions')
    page.click('[data-act="z-remove"]'); page.wait_for_timeout(100)
    check('Old yogurt' not in page.inner_text('#view'), 'removed used-up item')

    # recipe editor: new recipe with paste lines
    page.goto(BASE + '#/recipe/new/edit'); page.wait_for_selector('#redit')
    page.fill('[data-f="name"]', 'Test <b>bold</b> soup')
    page.click('text=Paste a list of ingredients')
    page.fill('#paste', '2 tbsp fish sauce\n1 1/2 cups chicken stock\n1 pinch salt\nsalt to taste\n3 eggs\n500 g chicken thighs')
    page.click('[data-act="ing-paste"]'); page.wait_for_timeout(100)
    classes = page.eval_on_selector_all('[data-k="class"]', 'els => els.map(e => e.value)')
    check(classes == ['salt', 'liquid', 'fixed', 'toTaste', 'egg', 'normal'], f'paste classified: {classes}')
    page.locator('.ingrow').nth(5).locator('[data-k="isAnchor"]').check()
    page.screenshot(path=f'{SHOT}/08-editor.png', full_page=True); no_hscroll(page, 'recipe editor')
    page.click('#redit button[type=submit]'); page.wait_for_selector('#svout')
    check(page.locator('h2').inner_text() == 'Test <b>bold</b> soup', 'name escaped (no XSS)')
    check('165°F' in page.inner_text('#scaled'), 'chicken → 165°F')
    page.fill('#haveQty', '1'); page.select_option('[data-in="haveUnit"]', 'kg')
    check(page.inner_text('#svout').startswith('≈ 8'), 'anchor 500 g → 1 kg doubles servings 4 → ≈ 8: ' + page.inner_text('#svout'))

    # air fryer
    page.goto(BASE + '#/airfryer'); page.wait_for_selector('#conv')
    check('375°F' in page.inner_text('#conv'), 'converter default 400/25 → 375°F')
    page.select_option('[data-in="cvK"]', 'frozenRaw')
    check('Follow the package' in page.inner_text('#conv'), 'frozen raw refuses')
    page.fill('[data-in="afQ"]', 'wings'); page.wait_for_timeout(100)
    check(page.locator('.af-row').count() == 1, 'search wings → 1 row')
    page.fill('[data-in="afQ"]', ''); page.wait_for_timeout(50)
    page.screenshot(path=f'{SHOT}/09-airfryer.png'); no_hscroll(page, 'air fryer')

    # review fixes
    page.goto(BASE + '#/shopping'); page.wait_for_selector('#shopName')
    page.fill('#shopName', 'Bread'); page.press('#shopName', 'Enter'); page.wait_for_timeout(150)
    check(page.input_value('#shopName') == '' and 'Bread' in page.inner_text('#view'), 'Enter adds item, clears input, list updates')
    page.goto(BASE + '#/item/new'); page.wait_for_selector('#iedit')
    page.type('[data-f="name"]', 'chicken broth', delay=20); page.wait_for_timeout(150)
    check(page.input_value('[data-f="category"]') in ('leftovers', 'pantry'), 'chicken broth → a broth row, not condiments/meat: ' + page.input_value('[data-f="category"]'))
    page.fill('[data-f="name"]', ''); page.type('[data-f="name"]', 'bread', delay=20); page.wait_for_timeout(150)
    check(page.input_value('[data-f="locationId"]') == 'loc-pantry' and '+14' in page.inner_text('#sugg'), 'bread → Pantry shown + 14-day chip')
    page.goto(BASE + '#/recipe/new/edit'); page.wait_for_selector('#redit')
    page.fill('[data-f="name"]', 'Cure test'); page.fill('[data-f="tags"]', 'pickle, side')
    page.click('text=Paste a list of ingredients'); page.fill('#paste', '10 g prague powder\n2 cups vinegar\n1 lb cá hồi'); page.click('[data-act="ing-paste"]')
    page.click('#redit button[type=submit]'); page.wait_for_selector('#svout')
    check('Exact ratios' in page.inner_text('#view'), 'tag "pickle" (not last) auto-enables Exact')
    for _ in range(2): page.click('[data-act="sv+"]')
    s = page.inner_text('#scaled')
    check('15 g' in s, 'curing salt ×1.5 → exactly 15 g: ' + s[:120])
    check('3 cups' in s, 'vinegar exact ×1.5 → 3 cups'); check('1 lb 8 oz' in s, 'cá hồi scales normally → 1 lb 8 oz')

    # settings + vietnamese
    page.goto(BASE + '#/settings'); page.wait_for_timeout(100)
    page.screenshot(path=f'{SHOT}/10-settings.png', full_page=True); no_hscroll(page, 'settings')
    page.select_option('[data-in="lang"]', 'vi'); page.wait_for_timeout(100)
    check('Cài đặt' in page.inner_text('header'), 'Vietnamese header')
    for r in ['#/recipes', '#/storage', '#/shopping', '#/airfryer', '#/safety']:
        page.goto(BASE + r); page.wait_for_timeout(120)
        txt = page.inner_text('body')
        raw = re.findall(r'\b[a-z]+_[a-z_]+\b', txt)
        check(not raw, f'vi {r}: no raw keys {raw[:5]}')
    page.goto(BASE + '#/storage'); page.screenshot(path=f'{SHOT}/11-storage-vi.png', full_page=True)
    page.select_option if False else None
    page.evaluate("localStorage.setItem('mc_lang','\"en\"')")

    # bad connect link
    page.goto(BASE + '#connect=abc'); page.wait_for_timeout(150)
    check(not page.is_hidden('#toast'), 'bad connect link → toast')
    # crafted link pointing to another host must be rejected
    import base64, json
    evil = base64.urlsafe_b64encode(json.dumps({'u': 'https://evil.example.com/macros/s/x/exec', 'k': 'k' * 32}).encode()).decode().rstrip('=')
    page.goto(BASE + '#connect=' + evil); page.wait_for_timeout(150)
    check(page.evaluate("localStorage.getItem('mc_conn')") is None, 'evil host link rejected')

    # offline reload via service worker
    page.goto(BASE + '#/recipes'); page.wait_for_timeout(1500)
    ctx.set_offline(True)
    page.reload(); page.wait_for_timeout(800)
    check('Steamed jasmine rice' in page.inner_text('#view'), 'offline reload shows cached app + data')
    ctx.set_offline(False)

    # dark mode screenshot
    page.emulate_media(color_scheme='dark'); page.goto(BASE + '#/recipes'); page.wait_for_timeout(200)
    page.screenshot(path=f'{SHOT}/12-dark.png')
    b.close()

print('\nconsole/page errors:', errors)
print(f'{len(fails)} FAILED' if fails else 'ALL PASSED')
sys.exit(1 if fails or errors else 0)
