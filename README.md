# Meal Prep Planner

A personal recipe book + weekly meal planner + grocery list generator. Plain HTML/CSS/JavaScript, no build tools, deployed via GitHub Pages.

## What's here

The app is two fully separate modes, switched via the header ("Meal Prep" / "Recipes") — there's no way into the recipe book except by clicking "Recipes":

- **Meal Prep** — the Weekly Planner and Grocery List, combined on one page (the grocery list is derived entirely from the planner, so splitting them into separate tabs never made sense). Pick a recipe for each of 6 slots (Breakfast, Snack 1, Lunch, Snack 2, Dinner, Snack 3) across all 7 days — on a wide/desktop viewport the 7 days lay out in a single row; narrower viewports wrap responsively. Hover (or focus, via keyboard) the ⓘ next to any picked meal for its full macro + ingredient breakdown without leaving the planner. Shows running macro totals per day and for the whole week. Below that, the grocery list auto-combines ingredient quantities across every selected recipe for the week (see "Grocery consolidation" below) and updates live as you change picks. Your selections and checked-off items are saved automatically in this browser (not synced across devices — see "Data storage" below).
- **Recipes** — the full recipe book. Filter by category via a dropdown menu under the "Recipes" heading itself (not a `<select>`), plus meal slot, diet day, search, with preferred recipes shown first and backlog recipes pushed below a divider line.

## Grocery list consolidation

Each ingredient line (e.g. "4 oz chicken breast") is parsed for a leading quantity + unit, then ingredients with the same name are summed **within matching units** across every recipe picked for the week — so "1 cup cottage cheese" in one recipe and "1/4 cup cottage cheese" in another combine into "1.25 cups." Volume units (tsp/tbsp/cup) convert into each other automatically.

This is an honest best-effort, not perfect unit math: weight (oz) is never auto-converted to volume (cup) since that depends on the ingredient's density and would risk being *wrong* rather than just imprecise — so if a recipe calls for "1/4 cup almonds" and another calls for "0.5 oz almonds," they'll show as two separate subtotals under the same ingredient rather than one guessed-at total. Lines with no parseable quantity (prep notes, "to taste", optional add-ins) still show up on the list, just without a summed amount.

## Project structure

```
meal-prep-planner/
├── index.html          # both modes live here, JS-switched
├── css/style.css
├── js/app.js            # all app logic: rendering, filtering, planner, grocery consolidation
├── data/recipes.json    # the recipe database — this is what you edit to add/remove recipes
└── README.md
```

## How to add a recipe

This is a static site with no backend, so "adding a recipe" means editing `data/recipes.json` directly and pushing the change — that's a deliberate choice (see the project's AskUserQuestion decision log) since it teaches a real git workflow instead of hiding it behind a form.

To make this easier, the app has a **+ Add Recipe** button in Recipes mode. Fill out the form and hit "Generate JSON" — it produces a ready-to-paste JSON object (with a trailing comma) that matches the schema below. Copy it into `data/recipes.json` (as a new entry in the array), save, then commit and push. For ingredients, start each line with a quantity + unit where you can (e.g. "4 oz chicken breast") so the grocery list can total it up — see "Grocery list consolidation" above.

### Recipe schema

```json
{
  "id": "kebab-case-unique-id",
  "name": "Display Name",
  "category": "Meal Prep",
  "mealSlot": "Breakfast",
  "dietDay": "Both",
  "preferred": true,
  "servings": 1,
  "ingredients": ["...", "..."],
  "instructions": "...",
  "macros": { "protein_g": 0, "fat_g": 0, "carb_g": 0, "fiber_g": 0, "calories": 0 },
  "source": "Trainer meal plan",
  "notes": "optional"
}
```

- `macros` can be `null` if you haven't calculated it yet — the recipe card will just show "Macros not yet calculated."
- `category` is free-form — type whatever you want in the Add Recipe form (Meal Prep, Bakery, Savory, or new ones as your recipe book grows). There's no fixed list to update in code.
- `preferred: false` recipes still show up in Recipes mode and are usable in the Planner — they're always visible, just sorted below a "Backlog" divider instead of being hidden.

## Running it locally

Because `js/app.js` loads `data/recipes.json` via `fetch()`, opening `index.html` directly in a browser (`file://...`) will fail — browsers block `fetch` for local files. Run a tiny local server instead, from this folder:

```
python3 -m http.server 8000
```

Then visit `http://localhost:8000`. This restriction doesn't apply once it's live on GitHub Pages (that's a real `https://` server).

## Deploying / updating

1. Commit and push changes to `main`.
2. GitHub Pages is configured to deploy automatically from `main` — the live site updates within a minute or two of a push.
3. **If the change touches `css/style.css` or `js/app.js`, bump the `?v=` query string on their `<link>`/`<script>` tags in `index.html`.** GitHub Pages serves everything with `cache-control: max-age=600` — without a changing version string, a browser that visited in the last 10 minutes can load fresh HTML alongside a stale cached CSS/JS pair (mismatched element IDs between old JS and new HTML caused exactly this once — broken layout, JS erroring out partway through, half the page not rendering). A plain content edit to `data/recipes.json` doesn't need a version bump.

## Data storage — what's saved where

- **Recipes** (`data/recipes.json`) — version-controlled in git. This is the durable source of truth.
- **This week's meal plan** and **grocery checklist state** — saved in the browser's `localStorage`, *not* committed to git. This is intentional: your weekly plan changes constantly and isn't something worth a commit every time, but it does mean it's tied to one browser/device and can be lost if you clear site data. If that becomes a problem, migrating this to a real database (Firebase/Supabase) is a natural next step — see below.

## Possible next steps

- **Migrate to React** — the plan from the start was to prototype in plain JS first, then rebuild in React once the app's shape is proven out. `data/recipes.json` and the schema above won't need to change for that migration.
- **Real backend for the weekly plan** — if cross-device sync matters, swap `localStorage` calls in `js/app.js` for calls to a small database (Firebase/Supabase are common beginner-friendly options).
- **Smarter grocery unit conversion** — weight-to-volume conversion (oz ↔ cup) per-ingredient would let almonds/cashews and similar items fully consolidate even when different recipes describe them differently; needs a small density lookup table per ingredient to do safely.
