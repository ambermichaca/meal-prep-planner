# Meal Prep Planner

A personal recipe book + weekly meal planner + grocery list generator. Plain HTML/CSS/JavaScript, no build tools, deployed via GitHub Pages.

## What's here

- **Recipe Book** — every recipe, filterable by category, meal slot (Breakfast/Lunch/Dinner/Snack), and diet day (Low Carb/Medium Carb/Both), with a "Preferred only" toggle. Search box matches recipe name and ingredients.
- **Weekly Planner** — pick a recipe for each of 6 slots (Breakfast, Snack 1, Lunch, Snack 2, Dinner, Snack 3) across 7 days. Shows running macro totals per day and for the whole week. Your picks are saved automatically in this browser (not synced across devices — see "Data storage" below).
- **Grocery List** — auto-builds a checklist of every ingredient from whatever's currently in the Weekly Planner, grouped by ingredient with a note on which recipe(s) it came from. Checkboxes persist in this browser too.

## Project structure

```
meal-prep-planner/
├── index.html          # all three views live here, tab-switched via JS
├── css/style.css
├── js/app.js            # all app logic: rendering, filtering, planner, grocery list
├── data/recipes.json    # the recipe database — this is what you edit to add/remove recipes
└── README.md
```

## How to add a recipe

This is a static site with no backend, so "adding a recipe" means editing `data/recipes.json` directly and pushing the change — that's a deliberate choice (see the project's AskUserQuestion decision log) since it teaches a real git workflow instead of hiding it behind a form.

To make this easier, the app has a **+ Add Recipe** button in the Recipe Book tab. Fill out the form and hit "Generate JSON" — it produces a ready-to-paste JSON object (with a trailing comma) that matches the schema below. Copy it into `data/recipes.json` (as a new entry in the array), save, then commit and push.

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
- `preferred: false` recipes still show up in the Recipe Book and are usable in the Planner — they're just filtered out by the "Preferred only" checkbox and tagged with a "Backlog" badge.

## Running it locally

Because `js/app.js` loads `data/recipes.json` via `fetch()`, opening `index.html` directly in a browser (`file://...`) will fail — browsers block `fetch` for local files. Run a tiny local server instead, from this folder:

```
python3 -m http.server 8000
```

Then visit `http://localhost:8000`. This restriction doesn't apply once it's live on GitHub Pages (that's a real `https://` server).

## Deploying / updating

1. Commit and push changes to `main`.
2. GitHub Pages is configured to deploy automatically from `main` — the live site updates within a minute or two of a push.

## Data storage — what's saved where

- **Recipes** (`data/recipes.json`) — version-controlled in git. This is the durable source of truth.
- **This week's meal plan** and **grocery checklist state** — saved in the browser's `localStorage`, *not* committed to git. This is intentional: your weekly plan changes constantly and isn't something worth a commit every time, but it does mean it's tied to one browser/device and can be lost if you clear site data. If that becomes a problem, migrating this to a real database (Firebase/Supabase) is a natural next step — see below.

## Possible next steps

- **Migrate to React** — the plan from the start was to prototype in plain JS first, then rebuild in React once the app's shape is proven out. `data/recipes.json` and the schema above won't need to change for that migration.
- **Real backend for the weekly plan** — if cross-device sync matters, swap `localStorage` calls in `js/app.js` for calls to a small database (Firebase/Supabase are common beginner-friendly options).
- **Unit-aware grocery list consolidation** — right now the grocery list lists each ingredient occurrence separately when the same item appears with different quantities (e.g., "1 cup cottage cheese" and "1/4 cup cottage cheese" show as two entries under the same ingredient name rather than being summed to "1.25 cups"). Real unit math (cups/oz/tbsp conversions) is a good follow-up feature.
