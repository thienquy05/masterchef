# MasterChef 🍳

A phone-friendly family kitchen app with no login and no build step.

- **Recipes**: smart scaling by servings *or* by how much of the main ingredient you have.
  - Gentler scaling for salt, spices and chili.
  - Exact mode for sauces, pickles and brines.
  - US ↔ metric conversion, with cup ↔ gram conversion for common ingredients.
  - Shows which ingredients you already have in Storage.
  - Adds missing ingredients to the shopping list.
- **Air fryer**: a searchable cheat sheet of 48 foods, an oven → air-fryer converter, and safe cooking temperatures.
- **Storage**: tracks food and anything else you keep around. Each item has a place (fridge, freezer, pantry and so on), a quantity and a category.
  - Expiry dates, plus an "opened, good for N days" rule.
  - Suggested shelf life from USDA FoodKeeper.
  - Warnings in the app, and a daily email digest.
- **Shopping**: a checklist. Checked items can be moved into Storage with a suggested expiry.
- **Family sharing**: data lives in **your own Google Sheet**. Anyone who scans the family QR code or opens the family link can see and edit it.
- **Languages and install**: English and Tiếng Việt. It installs to the home screen and works offline, syncing when the phone is back online.

Without a Sheet it still works: everything is saved on that phone only.

---

## 1. Put the website online (pick one)

**GitHub Pages**
1. Create a repository on GitHub and push this folder:
   `git remote add origin https://github.com/<you>/masterchef.git && git push -u origin main`
2. In the repository go to **Settings → Pages → Build and deployment**. Choose *Deploy from a branch*, branch `main`, folder `/ (root)`, and save.
3. After about a minute the site is at `https://<you>.github.io/masterchef/`.

**Netlify**
- Go to app.netlify.com → **Add new site → Deploy manually**, then drag this folder in. There is no build command, and the publish directory is the folder itself.

> **Every time you change the site:** open `sw.js` and bump `VERSION` (for example `mc-2026-11-02-1`). If you don't, phones keep showing the old cached version.

## 2. Create the family Sheet (one time, about 5 minutes, done by one person: the "owner")

1. Create a new Google Sheet, for example named "MasterChef data".
2. Open **Extensions → Apps Script**. Delete the sample code, paste the whole of [`apps-script/Code.gs`](apps-script/Code.gs) and save.
3. In **Project Settings** (gear icon), set **Time zone** to yours. The daily email uses it.
4. Back in the editor, pick the function **`install`** and press **Run**.
   - Google asks for permission. Choose your account → **Advanced → Go to project (unsafe) → Allow**. The warning appears because you wrote the script yourself; only you see it.
   - This creates the tabs `Recipes`, `Storage`, `Locations`, `Shopping` and `Settings`, a secret key, and the daily email trigger.
5. Click **Deploy → New deployment**. For type, choose **Web app**:
   - *Execute as:* **Me**
   - *Who has access:* **Anyone**

   Then click **Deploy** and copy the **Web app URL**. It ends in `/exec`.
6. Open the `Settings` tab in the Sheet. Copy the `activeKey` value.
   - Optional: put your website address in `siteUrl` so the email links to it.
   - Optional: put the addresses that should get the daily email in `digestEmails`, separated by commas. It defaults to you.
   - Optional: set `digestHour` (0–23) and `warnDays`. **After changing `digestHour`, run `install` again** (safe: data is kept).

## 3. Connect the app and share it

1. On your phone, open the website → **Settings → Family sharing → Set up a new family**.
2. Paste the Web app URL and the key, then tap **Connect**.
3. Settings now shows a **QR code**. Family members scan it with the phone camera and they're connected. You can also use **Copy family link** or **Share** and send the link in a chat.

**iPhone home-screen app.** iOS gives the installed app separate storage from Safari, so connect it once more:
1. In Safari, tap **Copy family link**.
2. Tap **Share → Add to Home Screen**.
3. Open the new icon and tap **Paste family link**.

**Android.** Use **Settings → Install app**, or Chrome's menu → *Install app*.

## Security: read this

- **The link is the key.** Anyone who has the QR code or link can view and change everything. Only share it with family.
- **If the link leaks:**
  1. In Apps Script, run **`rotateKey`**.
  2. Open the app, go to Settings → Disconnect, then set it up again with the new key from the Settings tab, and reshare the QR code.
  3. When everyone has reconnected, clear `previousKey` in the Settings tab. Old links stop working at that point.
- The API never reads or writes the `Settings` tab. Only data tables can be changed, values starting with `=` are stored as text, and the email escapes all content.

## Updating the backend code later

Use **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy**.

**Never** choose "New deployment" again. That creates a *new URL*, and every phone stops syncing.

## How the smart scaling works

| Ingredient type (auto-detected from the name, editable) | When scaling up ×f | Why |
|---|---|---|
| Normal (meat, veg, flour, sugar…) | ×f | proportional |
| Salt, fish sauce, soy sauce, bouillon | ×f^0.75 (×2 → 1.68) | saltiness builds; "1.5× when doubling, then taste" |
| Spices, pepper, vinegar, lime juice, vanilla | ×f^0.75 | same guideline |
| Chili / hot sauce | ×f^0.6 | heat builds fastest |
| Baking powder / soda | ×f^0.8 (×2 → 1.75) | common baking guidance; bake in several pans above ×2 |
| Sauté oil | ×f^0.7 | pan area grows more slowly than the food |
| Braising liquid (stock, broth, wine; pick it for coconut water in a braise) | ×(0.75f + 0.25) | the same pot loses about the same amount to evaporation |
| Rice / grain water | ATK rule: water = absorbed × f + evaporation | 1½ cups rice + 2¼ cups water → 3 cups rice + 3¾ cups water |
| Eggs | whole eggs, with a "+ ½ beaten egg" step | you can't add 0.4 eggs |
| Pinch, bay leaf, frying oil, garnish | never changes | — |
| To taste (no quantity) | never changes | — |
| Brine / curing salt ("exact ratio") | exactly ×f, rounded **up** | food safety |

- **Scaling down** always uses plain ×f. Recipes tagged sauce, nước chấm, pickle, brine or cure are automatically set to **Exact**, and any recipe can be switched to Exact from its page.
- Amounts are rounded to kitchen measures: ⅛, ¼, ⅓, ½, ⅔, ¾ cup or tsp, or "1 cup + 2 tbsp".
- In metric mode, solids with a known density show grams (1 cup flour = 120 g, from the King Arthur weight chart).
- Whenever a recipe is scaled, the app reminds you that **cooking times don't scale**. It shows the USDA safe internal temperature for the meat in the recipe.

## Checklist for the first real test

- [ ] `curl -sL "<exec URL>"` → `{"ok":true,"app":"masterchef"}`
- [ ] `curl -sL -H 'Content-Type: text/plain' -d '{"key":"wrong-key-wrong-key-123","action":"sync"}' "<exec URL>"` → `unauthorized`
- [ ] In the app, add an item and check that it appears in the Sheet within a few seconds. In the browser DevTools Network tab there must be **no OPTIONS request**.
- [ ] Add a Storage item named `=1+1`. It shows as text in the Sheet.
- [ ] Turn on airplane mode, add 2 items, turn it off. The sync dot goes green and the rows appear in the Sheet.
- [ ] In Apps Script, run `sendDigest` with an item expiring tomorrow. You get the email.

## Files

| File | What it is |
|---|---|
| `index.html`, `style.css` | page shell and mobile styles (light and dark) |
| `app.js` | screens and routing |
| `core.js` | scaling, units, parsing, expiry math (pure functions) |
| `store.js` | offline cache, sync queue, family link |
| `data.js` | air-fryer chart, shelf-life table, ingredient densities, sample recipes |
| `i18n.js` | English and Vietnamese text |
| `sw.js`, `manifest.webmanifest`, `icons/` | offline app and installability |
| `apps-script/Code.gs` | the Google Sheet backend |
| `core.test.js`, `test.html` | self-test. Run `node core.test.js`, or open `test.html` |
| `tests/backend.test.mjs` | runs `Code.gs` against an in-memory Sheet: `node tests/backend.test.mjs` |
| `tests/e2e.py` | phone-size browser test (Playwright in a local `.venv`; setup in the file header) |

## Data sources

- Safe temperatures: FoodSafety.gov / USDA FSIS safe minimum internal temperature chart.
- Shelf life: USDA FoodKeeper, using the shorter, safer end of each range, and the FSIS/FDA cold-storage chart.
- Densities: King Arthur Baking ingredient weight chart.
- Scaling: America's Test Kitchen (rice, pans), Cooklang scaling guide, USDA alcohol retention table.
- Air fryer: Blue Jean Chef air-fryer chart and common recipe sites. Rows marked *estimate* are less certain.
- The raw-filled chả giò time is an estimate. Always check that the center reaches 160°F / 71°C.

Seasoning exponents are guidelines, not lab-tested values. Always taste.
