# Aaj kya banega? (meal planner)

A weekly vegetarian meal planner for two that runs on localhost. It plans
breakfast, lunch and dinner, tracks the pantry and builds a daily grocery list.

## Run it

Needs Python 3.11+ and [uv](https://docs.astral.sh/uv/).

```bash
cd ~/personal-projects/meal-planner
uv sync
uv run uvicorn app.main:app --reload
```

Open http://127.0.0.1:8000.

Run the tests with `uv run pytest`.

## On your iPhone

1. Start the app so your phone can reach it over home Wi-Fi:
   ```bash
   uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
   ```
   If macOS asks whether to allow incoming connections for Python, click **Allow**.
2. Find your Mac's address with `ipconfig getifaddr en0` (something like `192.168.1.23`).
3. On the iPhone, open **Safari** and go to `http://192.168.1.23:8000` (your address).
4. Tap **Share → Add to Home Screen → Add**.

It opens full screen from the home-screen icon ("Kya Banega") and refreshes itself
whenever you switch back to it. The Mac has to be awake with the app running. If your
router gives the Mac a new address, delete the icon and add it again from the new
address (or give the Mac a fixed address in your router settings).

There's no login: anyone on your home Wi-Fi who has the address can open it.

## First steps

1. **Pantry tab:** tap what you already have at home. It moves from "Ran out" to "At home".
2. **Plan tab:** click **Plan this week** and watch the week shuffle into place.
3. **Groceries tab:** see what to order for tomorrow, or the next 7 days. Tick items as
   they arrive and they're marked as at home. **Copy list** copies it as text for
   Milkbasket notes or WhatsApp.

## How planning works

Rules apply within one meal type only, so a paneer breakfast never blocks a paneer lunch.

- A dish appears at most twice in a Monday–Sunday week, never on consecutive days.
- Dishes that share a perishable ingredient (bread, paneer, palak…) are never on consecutive days.
- A perishable opened earlier in the week, and still within its shelf life, makes
  dishes that use it again more likely. Aloo sandwich on Monday nudges paneer sandwich
  to later in the week, so the bread gets used up.
- If no dish fits every rule, the one that breaks the fewest is picked and tagged
  **Rule relaxed**. Open it to see which rule.
- **Plan this week** keeps cooked and skipped meals. Every other meal is planned again.

## Rules (pairings)

The Rules tab lets you link meals, for example:

> When lunch is anything tagged #dal, **prefer** Khichadi, Quinoa or Pulao for dinner the same day.

- **When** side: a meal, plus a dish, an ingredient or a tag.
- **Then** side: prefer or avoid dishes (by dish, ingredient or tag) for a later meal
  the same day, or any meal the next day.
- **Prefer** makes matching dishes about 10 times more likely. **Avoid** leaves matching
  dishes out unless nothing else fits.
- Rules never override the spacing rules above. If the only preferred dish would break
  one, something else is picked.
- Turn a rule off with its switch without deleting it.
- Tags are set per dish in the Dishes tab. Starting tags: #dal on Dal Dhokli, Idli sambhar
  and Khichadi; #rice on Pulao and Khichadi.

Your dal example is pre-loaded as the first rule.

## Using a meal

- **Hover a meal** for quick buttons: 🎲 something else, ✓ cooked, ⏭ skip.
- **Drag a meal** onto another one to swap them (same meal type only).
- **Click a meal**, in the week grid or in today's menu, to:
  - pick a different dish from a searchable list that shows which dishes fit, which a
    rule suggests (🔗) and which would break a rule;
  - tick **Made extra**, so the next meal becomes leftovers of this dish;
  - **Mark cooked**, then tick which ingredients are now finished (they go out of stock); or
  - **Mark skipped**.

Cooked and skipped meals are logged to `data/history.json` for the later AI features.

## Grocery list

It lists ingredients for planned meals that are out of stock in the pantry. Leftover,
cooked and skipped meals are left out. Staples (milk and curd by default) are never on
the list. They appear under **From your daily order** as a reminder when a meal needs
them. Mark an item as a staple from the Pantry tab.

## Data

All data is plain JSON in `data/`. The folder is created on first run with the
starting dish list.

| File | Holds |
|---|---|
| `dishes.json` | Dishes, their emoji, meal types, ingredients and tags |
| `ingredients.json` | Perishable flag and shelf life (default 7 days) per ingredient |
| `pantry.json` | In stock or out, per ingredient |
| `staples.json` | Items on your daily order |
| `plans.json` | Every planned meal, keyed by date |
| `history.json` | Cooked and skipped log |
| `rules.json` | Your pairing rules |

Delete `data/` to start over from the defaults.

### Defaults worth knowing

- Ingredients are typical ones for each dish. Salt, oil, water and everyday spices
  are left out so they don't fill the grocery list.
- Tomato, onion, coriander, green chilli, ginger, garlic and lemon are non-perishable by
  default. They're in almost every dish and would otherwise block most plans. Change
  this in the Pantry tab if you want.
- New ingredients typed into a dish start as non-perishable.
- Existing data from the first version is kept. Dishes get their emoji and starting tags
  the first time the new version runs.

## Project layout

```
app/
  main.py      FastAPI routes
  planner.py   spacing and pairing rules, leftovers, swaps
  storage.py   JSON read/write
  seed.py      starting dishes and ingredients
static/        browser UI (HTML, CSS, JS)
tests/
```

## Later

- Roti and rice sides, with atta and rice tracked in the pantry.
- Suggestions based on what you actually eat, and seasonal or cheaper grocery options.
