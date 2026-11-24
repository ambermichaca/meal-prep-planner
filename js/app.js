const SLOTS = ["Breakfast", "Snack 1", "Lunch", "Snack 2", "Dinner", "Snack 3"];
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const SLOT_TO_MEALSLOT = {
  "Breakfast": "Breakfast", "Lunch": "Lunch", "Dinner": "Dinner",
  "Snack 1": "Snack", "Snack 2": "Snack", "Snack 3": "Snack"
};

const MEAL_PREP_CATEGORY = "Meal Prep";

let RECIPES = [];
let plan = loadJSON("mealprep.plan", {});
let extras = loadJSON("mealprep.extras", []); // array of recipe ids, duplicates allowed
let groceryChecked = loadJSON("mealprep.groceryChecked", {});
let grocerySort = loadJSON("mealprep.grocerySort", "section"); // "section" | "meal"
// Day highlights: recipes from This Week's Recipes dragged onto a day (e.g. a special
// dinner). { Monday: [recipeId, ...] }. Display-only — they don't change the macro
// totals or the grocery list (the recipe is already on the list via `extras`).
let highlights = loadJSON("mealprep.highlights", {});
// Checkbox filters: several boxes in one group = match ANY of them; across groups = match ALL.
const FILTER_GROUPS = [
  { key: "category", label: "Category" },
  { key: "mealSlot", label: "Meal" },
  { key: "dietDay", label: "Diet day" }
];
const filterSel = { category: new Set(), mealSlot: new Set(), dietDay: new Set() };

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) { return fallback; }
}
function saveJSON(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* ignore quota/private-mode errors */ }
}

async function init() {
  try {
    const res = await fetch("data/recipes.json");
    RECIPES = await res.json();
  } catch (e) {
    document.getElementById("recipe-grid").innerHTML =
      "<p>Couldn't load recipes.json. If you opened this file directly (file://), run a local server instead — e.g. <code>python3 -m http.server</code> in this folder, then visit localhost. GitHub Pages doesn't have this issue.</p>";
    return;
  }
  // Everything after this point touches specific element IDs — if a future edit
  // renames one on only one side (HTML vs JS), or a stale cached JS/CSS pair loads
  // (see the ?v= cache-buster on the <script>/<link> tags), fail loudly here
  // instead of silently leaving the page half-rendered like it did before.
  try {
    setupFilters();
    setupCategoryMenu();
    setupCategoryMenuTriggers();
    setupModeSwitch();
    setupExtras();
    setupHighlights();
    renderRecipes();
    renderPlanner();
    renderExtras();
    renderGrocery();
    setupAddRecipeDialog();
    setupRecipeView();
    document.getElementById("search").addEventListener("input", renderRecipes);
    document.getElementById("clear-week-btn").addEventListener("click", () => {
      if (confirm("Clear all meal-prep picks and day highlights for this week?")) {
        plan = {}; saveJSON("mealprep.plan", plan);
        highlights = {}; saveJSON("mealprep.highlights", highlights);
        renderPlanner(); renderGrocery();
      }
    });
    setupGroceryControls();
    document.getElementById("reset-checked-btn").addEventListener("click", () => {
      groceryChecked = {};
      saveJSON("mealprep.groceryChecked", groceryChecked);
      renderGrocery();
    });
  } catch (e) {
    document.body.insertAdjacentHTML("afterbegin",
      `<div style="background:#8f5a37;color:#fff;padding:14px 20px;font-family:sans-serif;font-size:0.85rem;">
        Something didn't load correctly (${esc(e.message)}). Try a hard refresh
        (Cmd+Shift+R / Ctrl+Shift+R) — GitHub Pages caches files for 10 minutes,
        so a normal reload can serve mismatched HTML/CSS/JS right after a deploy.
      </div>`);
    throw e;
  }
}

// ---------------- MODE SWITCH (Recipes / Weekly Planner / Grocery List, one nav bar) ----------------
function setupModeSwitch() {
  document.getElementById("planner-btn").addEventListener("click", () => switchMode("planner"));
  document.getElementById("grocery-btn").addEventListener("click", () => switchMode("grocery"));
  // recipes-btn is wired in setupCategoryMenuTriggers (it also owns the category dropdown)
}

function switchMode(name) {
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".mode-panel").forEach(p => p.classList.remove("active"));
  document.getElementById(name + "-btn").classList.add("active"); // recipes-btn / planner-btn / grocery-btn
  document.getElementById("mode-" + name).classList.add("active");
}

function setupFilters() {
  const box = document.getElementById("filter-checks");
  // Each group is a <details> dropdown holding a list of checkboxes.
  box.innerHTML = FILTER_GROUPS.map(g => {
    const counts = {};
    RECIPES.forEach(r => { counts[r[g.key]] = (counts[r[g.key]] || 0) + 1; });
    const values = Object.keys(counts).sort();
    return `<details class="check-dd" data-group="${g.key}">
      <summary><span class="check-dd-label">${g.label}</span><span class="check-dd-count"></span></summary>
      <fieldset class="check-panel">
        <legend class="sr-only">${g.label}</legend>
        ${values.map(v => `<label class="check-row">
          <input type="checkbox" data-group="${g.key}" value="${esc(v)}" />
          <span>${esc(v)}</span><span class="check-count">${counts[v]}</span>
        </label>`).join("")}
      </fieldset>
    </details>`;
  }).join("");
  // Only one dropdown open at a time; close on outside click or Escape.
  const dds = [...box.querySelectorAll(".check-dd")];
  dds.forEach(dd => dd.addEventListener("toggle", () => {
    if (dd.open) dds.forEach(o => { if (o !== dd) o.open = false; });
  }));
  document.addEventListener("click", e => {
    if (!box.contains(e.target)) dds.forEach(dd => dd.open = false);
  });
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    const open = dds.find(dd => dd.open);
    if (open) { open.open = false; open.querySelector("summary").focus(); }
  });
  box.addEventListener("change", e => {
    const cb = e.target;
    if (!cb.dataset.group) return;
    const set = filterSel[cb.dataset.group];
    cb.checked ? set.add(cb.value) : set.delete(cb.value);
    onFiltersChanged();
  });
  const cats = [...new Set(RECIPES.map(r => r.category))].sort();
  document.getElementById("category-list").innerHTML = cats.map(c => `<option value="${esc(c)}">`).join("");
}

// Re-syncs everything that reflects the filter state: the checkboxes (the nav
// category menu can change them too), the nav menu highlight, the grid and the status line.
function onFiltersChanged() {
  document.querySelectorAll("#filter-checks input[type=checkbox]").forEach(cb => {
    cb.checked = filterSel[cb.dataset.group].has(cb.value);
  });
  document.querySelectorAll(".check-dd").forEach(dd => {
    const n = filterSel[dd.dataset.group].size;
    dd.classList.toggle("has-selection", n > 0);
    dd.querySelector(".check-dd-count").textContent = n ? n : "";
  });
  setupCategoryMenu();
  renderRecipes();
}

function clearFilters() {
  Object.values(filterSel).forEach(set => set.clear());
  document.getElementById("search").value = "";
  onFiltersChanged();
}

function closeCategoryMenu() {
  document.getElementById("category-menu").classList.remove("open");
  document.getElementById("recipes-btn").setAttribute("aria-expanded", "false");
}

function setupCategoryMenu() {
  const cats = [...new Set(RECIPES.map(r => r.category))].sort();
  const menu = document.getElementById("category-menu");
  const sel = filterSel.category;
  const allBtn = `<button role="menuitem" data-cat="" class="${sel.size === 0 ? "active" : ""}">All Categories</button>`;
  const catBtns = cats.map(c => `<button role="menuitem" data-cat="${esc(c)}" class="${sel.size === 1 && sel.has(c) ? "active" : ""}">${esc(c)}</button>`).join("");
  menu.innerHTML = allBtn + catBtns;

  menu.querySelectorAll("button").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      // The nav menu picks a single category (replacing any boxes ticked in that group).
      filterSel.category.clear();
      if (btn.dataset.cat) filterSel.category.add(btn.dataset.cat);
      switchMode("recipes");
      closeCategoryMenu();
      onFiltersChanged();
    });
  });
}

// One-time listeners: the trigger button and outside-click/Escape handling
// don't need to be re-bound every time setupCategoryMenu() redraws the menu items.
function setupCategoryMenuTriggers() {
  const menu = document.getElementById("category-menu");
  const recipesBtn = document.getElementById("recipes-btn");
  recipesBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (document.getElementById("mode-recipes").classList.contains("active")) {
      const willOpen = !menu.classList.contains("open");
      menu.classList.toggle("open");
      recipesBtn.setAttribute("aria-expanded", String(willOpen));
    } else {
      switchMode("recipes");
    }
  });
  document.addEventListener("click", closeCategoryMenu);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeCategoryMenu(); });
}

function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

// ---------------- RECIPES ----------------
function renderRecipes() {
  const q = document.getElementById("search").value.toLowerCase();

  const filtered = RECIPES.filter(r => {
    if (q && !r.name.toLowerCase().includes(q) && !r.ingredients.join(" ").toLowerCase().includes(q) && !r.category.toLowerCase().includes(q)) return false;
    for (const g of FILTER_GROUPS) {
      const set = filterSel[g.key];
      if (set.size && !set.has(r[g.key])) return false;
    }
    return true;
  });
  renderFilterStatus(filtered.length, q);

  const preferred = filtered.filter(r => r.preferred);
  const backlog = filtered.filter(r => !r.preferred);

  const grid = document.getElementById("recipe-grid");
  if (!filtered.length) {
    grid.innerHTML = "<p>No recipes match these filters.</p>";
    return;
  }
  let html = preferred.map(r => recipeCardHTML(r)).join("");
  if (backlog.length) {
    html += `<div class="backlog-divider"><span>Backlog</span></div>`;
    html += backlog.map(r => recipeCardHTML(r)).join("");
  }
  grid.innerHTML = html;
}

function renderFilterStatus(shown, q) {
  const active = q || Object.values(filterSel).some(set => set.size);
  const el = document.getElementById("filter-status");
  el.innerHTML = active
    ? `Showing ${shown} of ${RECIPES.length} recipes <button type="button" id="clear-filters">Clear filters</button>`
    : "";
  const btn = document.getElementById("clear-filters");
  if (btn) btn.addEventListener("click", clearFilters);
}

function macroLineText(r) {
  const m = r.macros;
  return m
    ? `${m.protein_g}g protein · ${m.fat_g}g fat · ${m.carb_g}g carb · ${m.fiber_g}g fiber · ${m.calories} kcal`
    : "Macros not yet calculated";
}

// ---------------- "ADD TO GROCERY LIST" BUTTONS ----------------
// Cards and the full recipe view toggle a recipe in This Week's Recipes (the `extras` list),
// which is what feeds the Grocery List.
function weekButtonHTML(id) {
  const on = extras.includes(id);
  return `<button type="button" class="week-btn${on ? " in-week" : ""}" data-week-id="${esc(id)}" aria-pressed="${on}">${on ? "✓ On grocery list" : "+ Grocery list"}</button>`;
}

function toggleWeek(id) {
  if (extras.includes(id)) extras = extras.filter(x => x !== id);
  else extras.push(id);
  saveJSON("mealprep.extras", extras);
  renderExtras();
  renderGrocery();
}

function refreshWeekButtons() {
  document.querySelectorAll(".week-btn").forEach(btn => {
    btn.outerHTML = weekButtonHTML(btn.dataset.weekId);
  });
}

function recipeCardHTML(r) {
  return `
    <div class="recipe-card" data-id="${esc(r.id)}">
      <h3>${esc(r.name)}</h3>
      <div class="badge-row">
        <span class="badge">${esc(r.category)}</span><span class="sep">·</span>
        <span class="badge">${esc(r.mealSlot)}</span><span class="sep">·</span>
        <span class="badge">${esc(r.dietDay)}</span>
        ${!r.preferred ? '<span class="sep">·</span><span class="badge backlog">Backlog</span>' : ""}
      </div>
      <div class="macro-line">${macroLineText(r)}</div>
      <div class="card-actions">
        <button type="button" class="view-recipe-btn" data-id="${esc(r.id)}">View recipe</button>
        ${weekButtonHTML(r.id)}
      </div>
      ${r.credit ? `<div class="recipe-credit">Original recipe: ${esc(r.credit)}</div>` : ""}
    </div>`;
}

// ---------------- FULL RECIPE VIEW ----------------
// Splits the instructions text into steps. Most recipes are "1. ...\n2. ..." —
// the leading numbers are stripped because the <ol> numbers them itself.
function recipeSteps(text) {
  return String(text || "")
    .split("\n")
    .map(s => s.replace(/^\s*\d+[.)]\s*/, "").trim())
    .filter(Boolean);
}

function recipeViewHTML(r) {
  const m = r.macros;
  const tiles = m
    ? [["Protein", m.protein_g + "g"], ["Carbs", m.carb_g + "g"], ["Fat", m.fat_g + "g"], ["Fiber", m.fiber_g + "g"], ["Calories", m.calories]]
        .map(([k, v]) => `<div class="rv-tile"><span class="rv-tile-val">${esc(v)}</span><span class="rv-tile-key">${k}</span></div>`).join("")
    : `<p class="rv-nomacros">Macros not yet calculated</p>`;
  return `
    <div class="rv-head">
      <div>
        <div class="badge-row">
          <span class="badge">${esc(r.category)}</span><span class="sep">·</span>
          <span class="badge">${esc(r.mealSlot)}</span><span class="sep">·</span>
          <span class="badge">${esc(r.dietDay)}</span>
          ${r.servings ? `<span class="sep">·</span><span class="badge">${esc(r.servings)} servings</span>` : ""}
          ${!r.preferred ? '<span class="sep">·</span><span class="badge backlog">Backlog</span>' : ""}
        </div>
        <h2 id="rv-title">${esc(r.name)}</h2>
      </div>
      <div class="rv-head-actions">
        ${weekButtonHTML(r.id)}
        <button type="button" class="rv-close" aria-label="Close recipe">&times;</button>
      </div>
    </div>
    <div class="rv-macros">${tiles}</div>
    ${m ? `<p class="rv-per">Per serving</p>` : ""}
    <div class="rv-body">
      <section>
        <h3>Ingredients</h3>
        <ul class="rv-ingredients">${r.ingredients.map(i => `<li>${esc(i)}</li>`).join("")}</ul>
      </section>
      <section>
        <h3>Method</h3>
        <ol class="rv-steps">${recipeSteps(r.instructions).map(s => `<li>${esc(s)}</li>`).join("")}</ol>
      </section>
    </div>
    ${r.credit || r.notes ? `<div class="rv-foot">
      ${r.credit ? `<div class="recipe-credit">Original recipe: ${esc(r.credit)}</div>` : ""}
      ${r.notes ? `<div class="recipe-note">${esc(r.notes)}</div>` : ""}
    </div>` : ""}`;
}

function openRecipeView(id) {
  const r = RECIPES.find(x => x.id === id);
  if (!r) return;
  const dialog = document.getElementById("recipe-view-dialog");
  document.getElementById("recipe-view").innerHTML = recipeViewHTML(r);
  dialog.querySelector(".rv-close").addEventListener("click", () => dialog.close());
  dialog.showModal();
  dialog.scrollTop = 0;
}

function setupRecipeView() {
  const dialog = document.getElementById("recipe-view-dialog");
  // One delegated listener: the grid is re-rendered on every filter change.
  document.getElementById("recipe-grid").addEventListener("click", e => {
    const weekBtn = e.target.closest(".week-btn");
    if (weekBtn) { toggleWeek(weekBtn.dataset.weekId); return; } // don't also open the recipe
    const card = e.target.closest(".recipe-card");
    if (card) openRecipeView(card.dataset.id);
  });
  // Clicking the dimmed backdrop (the dialog element itself, outside its content) closes it.
  dialog.addEventListener("click", e => {
    const weekBtn = e.target.closest(".week-btn");
    if (weekBtn) { toggleWeek(weekBtn.dataset.weekId); return; }
    if (e.target === dialog) dialog.close();
  });
}

function tooltipHTML(r) {
  return `<span class="tt-name">${esc(r.name)}</span>
    <span class="tt-macros">${macroLineText(r)}</span>
    <ul>${r.ingredients.map(i => `<li>${esc(i)}</li>`).join("")}</ul>`;
}

// ---------------- PLANNER ----------------
function renderPlanner() {
  const grid = document.getElementById("planner-grid");
  grid.innerHTML = DAYS.map(day => dayCardHTML(day)).join("");
  DAYS.forEach(day => {
    SLOTS.forEach(slot => {
      const el = document.getElementById(selectId(day, slot));
      el.addEventListener("change", () => {
        plan[day] = plan[day] || {};
        plan[day][slot] = el.value || null;
        saveJSON("mealprep.plan", plan);
        renderPlanner();   // redraws info-tooltips + totals for the whole grid
        renderGrocery();   // grocery list stays in sync with the planner automatically
      });
    });
    updateDayTotals(day);
  });
  updateWeekTotals();
}

function selectId(day, slot) { return `sel-${day}-${slot.replace(/\s+/g, "")}`; }

function dayCardHTML(day) {
  const selections = plan[day] || {};
  return `
    <div class="day-card" data-day="${day}">
      <h4>${day}</h4>
      ${dayHighlightsHTML(day)}
      ${SLOTS.map(slot => {
        const options = RECIPES.filter(r => r.mealSlot === SLOT_TO_MEALSLOT[slot] && r.category === MEAL_PREP_CATEGORY);
        const current = selections[slot] || "";
        const currentRecipe = current ? RECIPES.find(r => r.id === current) : null;
        return `<label>${slot}
          <div class="slot-row">
            <select id="${selectId(day, slot)}">
              <option value="">—</option>
              ${options.map(r => `<option value="${r.id}" ${r.id === current ? "selected" : ""}>${esc(r.name)}</option>`).join("")}
            </select>
            ${currentRecipe ? `<span class="info-trigger" tabindex="0" aria-label="Full recipe breakdown for ${esc(currentRecipe.name)}">ⓘ<span class="tooltip-panel">${tooltipHTML(currentRecipe)}</span></span>` : ""}
          </div>
        </label>`;
      }).join("")}
      <div class="day-totals" id="daytotals-${day}"></div>
    </div>`;
}

function dayMacros(day) {
  const selections = plan[day] || {};
  const totals = { protein_g: 0, fat_g: 0, carb_g: 0, fiber_g: 0, calories: 0 };
  Object.values(selections).forEach(id => {
    if (!id) return;
    const r = RECIPES.find(x => x.id === id);
    if (r && r.macros) {
      totals.protein_g += r.macros.protein_g;
      totals.fat_g += r.macros.fat_g;
      totals.carb_g += r.macros.carb_g;
      totals.fiber_g += r.macros.fiber_g;
      totals.calories += r.macros.calories;
    }
  });
  return totals;
}

function updateDayTotals(day) {
  const t = dayMacros(day);
  document.getElementById(`daytotals-${day}`).innerHTML =
    `${round1(t.protein_g)}g P · ${round1(t.fat_g)}g F · ${round1(t.carb_g)}g C · ${Math.round(t.calories)} kcal`;
}

function updateWeekTotals() {
  const totals = { protein_g: 0, fat_g: 0, carb_g: 0, fiber_g: 0, calories: 0 };
  DAYS.forEach(day => {
    const t = dayMacros(day);
    Object.keys(totals).forEach(k => totals[k] += t[k]);
  });
  const avg = Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, v / 7]));
  document.getElementById("week-totals").innerHTML = `
    <strong>Week total:</strong> ${round1(totals.protein_g)}g protein · ${round1(totals.fat_g)}g fat ·
    ${round1(totals.carb_g)}g carb · ${round1(totals.fiber_g)}g fiber · ${Math.round(totals.calories)} kcal
    &nbsp;|&nbsp; <strong>Daily avg:</strong> ${round1(avg.protein_g)}g protein · ${round1(avg.fat_g)}g fat ·
    ${round1(avg.carb_g)}g carb · ${Math.round(avg.calories)} kcal`;
}

function round1(n) { return Math.round(n * 10) / 10; }

// ---------------- DAY HIGHLIGHTS (drag from This Week's Recipes onto a day) ----------------
function dayHighlightsHTML(day) {
  const ids = highlights[day] || [];
  const chips = ids.map(id => {
    const r = RECIPES.find(x => x.id === id);
    if (!r) return "";
    return `<li class="hl-chip" draggable="true" data-id="${esc(id)}" data-day="${day}">
      <button type="button" class="hl-open" data-id="${esc(id)}" title="View recipe">${esc(r.name)}</button>
      <button type="button" class="hl-remove" data-id="${esc(id)}" data-day="${day}" aria-label="Remove ${esc(r.name)} from ${day}">×</button>
    </li>`;
  }).join("");
  return `<ul class="day-highlights" aria-label="${day} highlights">${chips}</ul>`;
}

function addHighlight(day, id, fromDay) {
  if (fromDay === day) return;
  if (fromDay) highlights[fromDay] = (highlights[fromDay] || []).filter(x => x !== id);
  highlights[day] = highlights[day] || [];
  if (!highlights[day].includes(id)) highlights[day].push(id);
  saveJSON("mealprep.highlights", highlights);
  renderPlanner();
}

function removeHighlight(day, id) {
  highlights[day] = (highlights[day] || []).filter(x => x !== id);
  saveJSON("mealprep.highlights", highlights);
  renderPlanner();
}

// A highlight only makes sense while its recipe is in This Week's Recipes —
// when a recipe leaves that list, its highlights go with it.
function pruneHighlights() {
  let changed = false;
  Object.keys(highlights).forEach(day => {
    const kept = highlights[day].filter(id => extras.includes(id));
    if (kept.length !== highlights[day].length) { highlights[day] = kept; changed = true; }
  });
  if (changed) { saveJSON("mealprep.highlights", highlights); renderPlanner(); }
}

// All listeners are delegated to containers that persist across re-renders.
function setupHighlights() {
  let drag = null; // { id, fromDay } for the drag in progress
  const grid = document.getElementById("planner-grid");
  const list = document.getElementById("extras-list");

  const start = (e, payload) => {
    drag = payload;
    e.dataTransfer.effectAllowed = payload.fromDay ? "move" : "copy";
    e.dataTransfer.setData("text/plain", payload.id); // Firefox won't start a drag without data
    document.body.classList.add("hl-dragging");
  };
  const end = () => {
    drag = null;
    document.body.classList.remove("hl-dragging");
    grid.querySelectorAll(".drop-over").forEach(c => c.classList.remove("drop-over"));
  };

  list.addEventListener("dragstart", e => {
    const li = e.target.closest("li[data-id]");
    if (li) start(e, { id: li.dataset.id, fromDay: null });
  });
  list.addEventListener("dragend", end);
  grid.addEventListener("dragstart", e => {
    const chip = e.target.closest(".hl-chip");
    if (chip) start(e, { id: chip.dataset.id, fromDay: chip.dataset.day });
  });
  grid.addEventListener("dragend", end);

  grid.addEventListener("dragover", e => {
    const card = e.target.closest(".day-card");
    if (!drag || !card) return;
    e.preventDefault(); // marks the card as a valid drop target
    e.dataTransfer.dropEffect = drag.fromDay ? "move" : "copy";
    card.classList.add("drop-over");
  });
  grid.addEventListener("dragleave", e => {
    const card = e.target.closest(".day-card");
    if (card && !card.contains(e.relatedTarget)) card.classList.remove("drop-over");
  });
  grid.addEventListener("drop", e => {
    const card = e.target.closest(".day-card");
    if (!drag || !card) return;
    e.preventDefault();
    const { id, fromDay } = drag;
    end();
    addHighlight(card.dataset.day, id, fromDay);
  });

  grid.addEventListener("click", e => {
    const rm = e.target.closest(".hl-remove");
    if (rm) { removeHighlight(rm.dataset.day, rm.dataset.id); return; }
    const open = e.target.closest(".hl-open");
    if (open) openRecipeView(open.dataset.id);
  });

  // Tap/keyboard alternative to dragging (phones don't reliably support drag and drop).
  list.addEventListener("change", e => {
    const sel = e.target.closest(".extra-day-select");
    if (!sel || !sel.value) return;
    addHighlight(sel.value, sel.dataset.id, null);
    sel.value = "";
  });
}

// ---------------- EXTRA SELECTIONS (any recipe, any category — outside the tracked plan) ----------------
function setupExtras() {
  const sel = document.getElementById("extras-select");
  const sorted = [...RECIPES].sort((a, b) => a.name.localeCompare(b.name));
  sel.innerHTML = sorted.map(r => `<option value="${r.id}">${esc(r.name)} — ${esc(r.category)}</option>`).join("");

  document.getElementById("extras-add-btn").addEventListener("click", () => {
    if (!sel.value) return;
    extras.push(sel.value);
    saveJSON("mealprep.extras", extras);
    renderExtras();
    renderGrocery();
  });
}

function renderExtras() {
  refreshWeekButtons(); // keep card / recipe-view buttons in sync with the list
  pruneHighlights();
  const list = document.getElementById("extras-list");
  if (!extras.length) {
    list.innerHTML = `<li class="extras-empty" style="list-style:none;border:none;box-shadow:none;padding:0;">Nothing added yet. Tap "+ Grocery list" on any recipe card, or pick one here.</li>`;
    return;
  }
  list.innerHTML = extras.map((id, i) => {
    const r = RECIPES.find(x => x.id === id);
    if (!r) return "";
    return `<li draggable="true" data-id="${esc(id)}" title="Drag onto a day below to highlight it">
      <span><span class="drag-grip" aria-hidden="true">⠿</span><span class="extra-name">${esc(r.name)}</span><span class="extra-meta">${esc(r.category)} · ${esc(r.mealSlot)}</span></span>
      <span class="extra-actions">
        <select class="extra-day-select" data-id="${esc(id)}" aria-label="Highlight ${esc(r.name)} on a day">
          <option value="">+ Day</option>
          ${DAYS.map(d => `<option value="${d}">${d}</option>`).join("")}
        </select>
        <button class="extra-remove" data-index="${i}" aria-label="Remove ${esc(r.name)}">×</button>
      </span>
    </li>`;
  }).join("");

  list.querySelectorAll(".extra-remove").forEach(btn => {
    btn.addEventListener("click", () => {
      extras.splice(parseInt(btn.dataset.index), 1);
      saveJSON("mealprep.extras", extras);
      renderExtras();
      renderGrocery();
    });
  });
}

// ---------------- INGREDIENT PARSING (for grocery consolidation) ----------------
// Best-effort: parses a leading "quantity + unit" off a free-text ingredient line
// (e.g. "4 oz chicken breast" -> qty 4, unit oz, item "chicken breast"). Lines that
// don't start with a recognizable quantity (side-dish references, "to taste", etc.)
// still get listed on the grocery list, just without a summed amount.
// Units are never converted: amounts are only added together when they share the
// exact unit the recipes used (cups with cups, tbsp with tbsp), so the grocery list
// reads in the same measurements as the recipes.
const UNIT_PATTERNS = [
  ["oz", /^(oz|ounces?)$/], ["lb", /^(lbs?|pounds?)$/], ["g", /^(g|grams?)$/], ["kg", /^(kg|kilograms?)$/],
  ["ml", /^(ml|milliliters?|millilitres?)$/], ["cup", /^cups?$/], ["tbsp", /^(tbsps?|tbs|tablespoons?)$/],
  ["tsp", /^(tsps?|teaspoons?)$/], ["slice", /^slices?$/], ["scoop", /^scoops?$/], ["serving", /^servings?$/],
  ["clove", /^cloves?$/], ["packet", /^packets?$/], ["stick", /^sticks?$/], ["can", /^cans?$/], ["jar", /^jars?$/],
  ["pint", /^pints?$/], ["quart", /^quarts?$/], ["package", /^(packages?|pkgs?)$/], ["bag", /^bags?$/],
  ["box", /^box(es)?$/], ["head", /^heads?$/], ["bunch", /^bunch(es)?$/], ["sprig", /^sprigs?$/],
  ["sheet", /^sheets?$/], ["block", /^blocks?$/], ["container", /^containers?$/], ["ear", /^ears?$/],
  ["piece", /^pieces?$/]
];
const UNIT_PLURAL = { cup: "cups", slice: "slices", scoop: "scoops", serving: "servings", clove: "cloves",
  packet: "packets", stick: "sticks", can: "cans", jar: "jars", pint: "pints", quart: "quarts",
  package: "packages", bag: "bags", box: "boxes", head: "heads", bunch: "bunches", sprig: "sprigs",
  sheet: "sheets", block: "blocks", container: "containers", ear: "ears", piece: "pieces" };
function unitLabel(u, n) { return n > 1 && UNIT_PLURAL[u] ? UNIT_PLURAL[u] : u; }

function parseQtyToken(tok) {
  tok = tok.trim();
  const mixed = tok.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return parseInt(mixed[1]) + parseInt(mixed[2]) / parseInt(mixed[3]);
  const frac = tok.match(/^(\d+)\/(\d+)$/);
  if (frac) return parseInt(frac[1]) / parseInt(frac[2]);
  const num = parseFloat(tok);
  return isNaN(num) ? null : num;
}

function canonicalUnit(u) {
  u = u.toLowerCase().replace(/\.$/, "");
  const hit = UNIT_PATTERNS.find(([, re]) => re.test(u));
  return hit ? hit[0] : null; // "whole" and unrecognized units fall back to unitless counting
}

// The ingredient is the part before the first comma ("carrots, peeled"), unless that
// part is only prep words ("melted, cooled butter") — then keep reading past the commas.
function itemName(text) {
  const parts = text.toLowerCase().split(",").map(p => p.trim());
  let i = 0;
  while (i < parts.length - 1 && !parts[i].replace(PREP_WORDS, "").trim()) i++;
  return parts[i];
}

function parseIngredientLine(rawText) {
  const text = rawText.replace(/\([^)]*\)/g, "").trim();
  const numTok = "(?:\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+(?:\\.\\d+)?)";
  const qtyRegex = new RegExp(`^(${numTok})(\\s*-\\s*(${numTok}))?\\s*`);
  const m = text.match(qtyRegex);
  if (!m) {
    const item = itemName(text || rawText);
    return { qty: null, unit: null, item: item || rawText.toLowerCase(), display: rawText };
  }
  let qty = parseQtyToken(m[1]);
  if (m[3]) {
    const hi = parseQtyToken(m[3]);
    if (hi != null) qty = hi; // "3-4 cups": shop for the high end
  }
  const rest = text.slice(m[0].length);
  // Allows a size word before the unit: "2 small cans crushed pineapple".
  const um = rest.match(/^(?:(?:large|medium|small)\s+)?([a-z]+)\.?\s+/i);
  let unit = null, itemPart = rest;
  if (um) {
    const c = canonicalUnit(um[1]);
    if (c) { unit = c; itemPart = rest.slice(um[0].length).replace(/^of\s+/i, ""); }
  }
  return { qty, unit, item: itemName(itemPart || rest) || rawText.toLowerCase(), display: rawText };
}

// ---- Folding similar ingredients into one grocery line ----
// "grated carrots", "diced carrots" and "2 large carrots" are all just carrots;
// "flour", "AP flour" and "all purpose flour" are all all-purpose flour. Prep, size
// and temperature words are dropped and plurals made singular to build a shared key.
// Words that change what you actually buy (unsalted, dark brown, bread flour,
// smoked, kosher…) are kept, so those stay separate lines.
const PREP_WORDS = /\b(grated|diced|chopped|cubed|minced|sliced|shredded|julienned|finely|roughly|coarsely|thinly|freshly|fresh|peeled|trimmed|halved|quartered|extra-large|large|medium|small|ripe|packed|loosely|lightly|heaped|heaping|cold|chilled|melted|cooled|softened|room temp(erature)?|warm|lukewarm|cooked|raw|to taste|optional:?)\b/g;
const ITEM_SYNONYMS = {
  "flour": "all-purpose flour", "all purpose flour": "all-purpose flour", "ap flour": "all-purpose flour",
  "confectioners' sugar": "powdered sugar", "icing sugar": "powdered sugar",
  "granulated sugar": "sugar", "white sugar": "sugar",
  "scallion": "green onion", "spring onion": "green onion",
  "evoo": "extra-virgin olive oil", "bread crumb": "breadcrumb", "panko bread crumb": "panko",
  "bicarbonate of soda": "baking soda", "heavy whipping cream": "heavy cream", "whipping cream": "heavy cream",
  "mayo": "mayonnaise", "chicken stock": "chicken broth", "whole egg": "egg", "egg white": "egg white",
  "garlic clove": "garlic", "clove garlic": "garlic", "cilantro leave": "cilantro"
};
// Plain "flour" means all-purpose; any named flour type stays its own line.
const OTHER_FLOURS = /bread|cake|pastry|almond|coconut|self|rice|oat|wheat|tortilla|corn|chickpea|\b00\b|seasoned/;

function singularWord(w) {
  if (/(ss|us|is)$/.test(w)) return w;
  if (/ies$/.test(w)) return w.slice(0, -3) + "y";
  if (/(tomato|potato)es$/.test(w)) return w.slice(0, -2);
  if (/(ch|sh|x)es$/.test(w)) return w.slice(0, -2);
  if (/s$/.test(w)) return w.slice(0, -1);
  return w;
}

// Returns { key, name, unit } — key groups lines together, name is what the list shows.
function canonicalIngredient(parsed) {
  const raw = parsed.item;
  let unit = parsed.unit;
  // Canned goods stay their own line ("canned diced tomatoes" ≠ fresh tomatoes).
  if (unit === "can") {
    const words = raw.replace(/\s+/g, " ").trim().split(" ");
    words[words.length - 1] = singularWord(words[words.length - 1]);
    return { key: "canned " + words.join(" "), name: "Canned " + raw.replace(/\s+/g, " ").trim(), unit };
  }
  let name = raw.replace(PREP_WORDS, " ")
    .replace(/^\s*(?:tiny\s+)?(?:pinch|dash|sprinkle|splash|drizzle)(?:\s+of)?\s+/, "")
    // "ground cinnamon" = cinnamon, but ground ginger/mustard/coriander are different from fresh/prepared.
    .replace(/\bground\s+(?=(cinnamon|cumin|cardamom|nutmeg|turmeric|allspice|paprika)\b)/, "")
    .replace(/\s+/g, " ").trim();
  if (!name) name = raw.trim();
  // Fresh woody herbs aren't interchangeable with the dried jar, so keep "fresh" on those.
  if (/\bfresh\b/.test(raw) && /^(thyme|oregano|rosemary|sage)$/.test(name)) name = "fresh " + name;
  // Fresh/chopped coriander is cilantro (the leaves), not the coriander spice.
  if (/\b(fresh|chopped)\b/.test(raw) && name === "coriander") name = "cilantro";
  const words = name.split(" ");
  words[words.length - 1] = singularWord(words[words.length - 1]);
  let key = words.join(" ");
  if (/^(garlic cloves?|cloves? (of )?garlic)$/.test(name) && !unit) unit = "clove";
  if (/\bflour\b/.test(key) && !OTHER_FLOURS.test(key) && !/[+&/]| or /.test(key)) key = "all-purpose flour";
  if (ITEM_SYNONYMS[key]) key = ITEM_SYNONYMS[key];
  if (key !== words.join(" ")) name = key; // renamed by a rule: show the canonical name
  return { key, name: name.charAt(0).toUpperCase() + name.slice(1), unit };
}

// 0.5 -> "½", 4.5 -> "4½", 1.25 -> "1¼"; anything that isn't a common fraction stays decimal.
function formatQty(n) {
  const whole = Math.floor(n + 1e-9);
  const frac = n - whole;
  if (frac < 0.01) return String(whole);
  const FR = [[1 / 8, "⅛"], [1 / 6, "⅙"], [1 / 4, "¼"], [1 / 3, "⅓"], [3 / 8, "⅜"], [1 / 2, "½"], [5 / 8, "⅝"], [2 / 3, "⅔"], [3 / 4, "¾"], [5 / 6, "⅚"], [7 / 8, "⅞"]];
  const f = FR.find(([v]) => Math.abs(v - frac) < 0.01);
  return f ? (whole ? whole : "") + f[1] : String(Math.round(n * 100) / 100);
}

// ---------------- STORE SECTIONS (for the "Store section" grocery sort) ----------------
// Best-effort keyword match on the ingredient name; the first rule that matches wins,
// so the order matters (e.g. "garlic powder" must hit Spices before "garlic" hits Produce,
// "chicken broth" must hit Pantry before "chicken" hits Meat). Anything unmatched → Other.
const STORE_SECTIONS = ["Produce", "Bakery & Bread", "Meat & Seafood", "Dairy & Eggs", "Frozen",
  "Pantry", "Baking", "Spices & Seasonings", "Wine & Spirits", "Other"];
const SECTION_RULES = [
  ["Frozen", /\bfrozen\b|ice cream|\bfries\b/],
  ["Baking", /pudding mix|cake mix/],
  ["Pantry", /\bcans?\b|\bcanned\b|\bjar\b|\bbox(es)?\b|in adobo|sauce|broth|stock|bouillon|knorr|vinegar|soy\b|hoisin|mirin|sriracha|sambal|salsa|marinara|(tomato|miso|curry|chili|pepper|garlic|ginger) paste|peanut butter|almond butter|coconut (milk|cream)|almond milk|dairy-free milk|condensed milk|evaporated milk|noodles?|pasta|spaghetti|bucatini|fusilli|macaroni|lasagna|ramen|udon|bread ?crumbs|panko|protein|whey|\boil\b|evoo|spray|mayo|tea bag|tortilla chips/],
  ["Wine & Spirits", /\bwine\b|vodka|\brum\b|bourbon|liqueur|\bsake\b|framboise/],
  ["Spices & Seasonings", /\bdried\b|sazón|granulated garlic/],
  ["Produce", /\bfresh\b|cilantro|parsley|\bmint\b|\bdill\b|culantro|epazote|basil|coriander leaves|chopped coriander|\bsprigs?\b|lettuce/],
  ["Meat & Seafood", /chicken|beef|steak|turkey|pork|lamb|bacon|shrimp|salmon|\bcod\b|\bfish\b|tuna|sausage|cold cuts/],
  ["Dairy & Eggs", /\beggs?\b|egg (white|yolk)|yolks?\b|milk|butter|cream|cheese|cheddar|mozzarella|parmesan|pecorino|gouda|colby|monterey|ricotta|feta|queso|yogurt|cottage|mascarpone|gruyere/],
  ["Bakery & Bread", /tortilla/],
  ["Baking", /flour|baking|bicarbonate|yeast|sugar|splenda|stevia|swerve|cocoa|cacao|chocolate|extract|vanilla|cake mix|pudding mix|cornstarch|corn ?meal|maseca|food gel|frosting|pie crust|puff pastry|crescent|wafers|ladyfingers|oreo|m&m|shredded coconut|flaked coconut|crisco|caramel\b/],
  ["Spices & Seasonings", /salt|^pepper$|black pepper|white pepper|cracked|pepper flakes|chili flakes|cayenne|paprika|cumin|cinnamon|nutmeg|cardamom|allspice|spice|turmeric|garam masala|powder|oregano|thyme|bay lea|rosemary|seasoning|sazón|adobo|\bmsg\b|ground cloves|pinch clove|^cloves$|coriander|sesame seeds|aleppo|pul biber|citric acid|chiles|\bground\b|italian/],
  ["Bakery & Bread", /bread|tortilla|\bbuns?\b|pitas?\b|bagel|baguette|brioche|challah|croissant|flatbread|tostadas?|wrap|focaccia/],
  ["Produce", /onion|garlic|ginger|shallot|scallion|lemon|lime|orange|apple|banana|berr|kiwi|mango|melon|pineapple|grape|pear|avocado|tomato|tomatillo|cucumber|carrot|celery|potato|zucchini|squash|pepper|jalapeño|chile|chili|broccoli|cauliflower|cabbage|slaw|kale|spinach|arugula|greens|romaine|mushroom|corn|green beans|peas|asparagus|sprouts|veg|salad|radish|beet/],
  ["Pantry", /rice|quinoa|oat|lentil|beans?\b|chickpea|honey|syrup|nuts?\b|almond|cashew|pecan|walnut|peanut|seeds|tahini|mayo|mustard|ketchup|cheerios|chips|pretzel|coffee|\btea\b|olive|vinaigrette|maple|tuna|dijon|miso|pumpkin|chia/]
];
function storeSection(item) {
  const hit = SECTION_RULES.find(([, re]) => re.test(item));
  return hit ? hit[0] : "Other";
}

// ---------------- GROCERY LIST ----------------
// Lists every meal currently contributing to the grocery list (day-by-day picks +
// This Week's Recipes), each with a one-click remove so you don't have to jump back
// to the Planner tab just to drop a dish and its ingredients.
function renderGroceryMeals() {
  const list = document.getElementById("grocery-meals-list");
  const items = [];
  DAYS.forEach(day => {
    const selections = plan[day] || {};
    Object.entries(selections).forEach(([slot, id]) => {
      if (!id) return;
      const r = RECIPES.find(x => x.id === id);
      if (!r) return;
      items.push({ label: r.name, meta: `${day.slice(0, 3)} ${slot}`, type: "plan", day, slot });
    });
  });
  extras.forEach((id, i) => {
    const r = RECIPES.find(x => x.id === id);
    if (!r) return;
    items.push({ label: r.name, meta: "this week", type: "extra", index: i });
  });

  if (!items.length) {
    list.innerHTML = `<li class="extras-empty" style="list-style:none;border:none;box-shadow:none;padding:0;">Nothing on the list yet — add a meal from Recipes or the Weekly Planner.</li>`;
    return;
  }

  list.innerHTML = items.map((it, i) => `
    <li>
      <span><span class="extra-name">${esc(it.label)}</span><span class="extra-meta">${esc(it.meta)}</span></span>
      <button class="extra-remove" data-index="${i}" aria-label="Remove ${esc(it.label)} and its ingredients">×</button>
    </li>`).join("");

  list.querySelectorAll(".extra-remove").forEach(btn => {
    const it = items[parseInt(btn.dataset.index)];
    btn.addEventListener("click", () => {
      if (it.type === "extra") {
        extras.splice(it.index, 1);
        saveJSON("mealprep.extras", extras);
        renderExtras();
      } else {
        plan[it.day][it.slot] = null;
        saveJSON("mealprep.plan", plan);
        renderPlanner();
      }
      renderGrocery();
    });
  });
}

function renderGrocery() {
  renderGroceryMeals();
  const groups = {}; // canonical ingredient key -> { name, entries: [{ qty, unit, source, display }] }
  const mealOrder = new Set(); // every meal source, in planner order (days first, then this week's recipes)
  const addLine = (rawLine, source) => {
    const parsed = parseIngredientLine(rawLine);
    const c = canonicalIngredient(parsed);
    if (!groups[c.key]) groups[c.key] = { name: c.name, entries: [] };
    groups[c.key].entries.push({ qty: parsed.qty, unit: c.unit, source, display: rawLine });
  };

  DAYS.forEach(day => {
    const selections = plan[day] || {};
    Object.entries(selections).forEach(([slot, id]) => {
      if (!id) return;
      const r = RECIPES.find(x => x.id === id);
      if (!r) return;
      const source = `${r.name} (${day.slice(0, 3)} ${slot})`;
      mealOrder.add(source);
      r.ingredients.forEach(rawLine => addLine(rawLine, source));
    });
  });

  extras.forEach(id => {
    const r = RECIPES.find(x => x.id === id);
    if (!r) return;
    const source = `${r.name} (this week)`;
    mealOrder.add(source);
    r.ingredients.forEach(rawLine => addLine(rawLine, source));
  });

  const keys = Object.keys(groups).sort((a, b) => groups[a].name.localeCompare(groups[b].name));
  const list = document.getElementById("grocery-list");
  if (!keys.length) {
    list.innerHTML = "<p>Nothing planned yet — pick some meals above and this list fills in automatically.</p>";
    return;
  }

  const items = keys.map(key => {
    const g = groups[key];
    // Total per unit exactly as the recipes wrote it — no cup/tbsp conversion.
    const totals = new Map(); // unit ("" = plain count) -> sum
    g.entries.forEach(e => {
      if (e.qty == null) return;
      const u = e.unit || "";
      totals.set(u, (totals.get(u) || 0) + e.qty);
    });
    const qtyLabel = [...totals].map(([u, n]) => u ? `${formatQty(n)} ${unitLabel(u, n)}` : formatQty(n)).join(" + ");

    const allSources = g.entries.map(e => e.source);
    const meals = [...new Set(allSources)];
    // Each recipe's own line, word for word, under the total.
    const breakdown = g.entries.map(e =>
      `<span class="bd-row"><span class="bd-amt">${esc(e.display)}</span> <span class="bd-src">· ${esc(e.source)}</span></span>`).join("");
    const displayName = g.name;
    const keyHash = "gk-" + btoa(unescape(encodeURIComponent(key))).replace(/[^a-zA-Z0-9]/g, "");
    const checked = !!groceryChecked[keyHash];

    const html = `<li class="${checked ? "checked" : ""}" data-key="${keyHash}">
      <label>
        <input type="checkbox" ${checked ? "checked" : ""} />
        <span>
          <span class="item-name">${esc(displayName)}${qtyLabel ? ` <span class="item-qty">— ${esc(qtyLabel)}</span>` : ""}</span>
          <span class="item-sources item-breakdown">${breakdown}</span>
        </span>
      </label>
    </li>`;
    return { keyHash, checked, html, meals, section: storeSection(g.name.toLowerCase()) };
  });

  // Unchecked items are grouped by store section or by meal; everything already
  // checked off sinks into one "In your cart" group at the very bottom.
  const SHARED = "Used in more than one meal";
  const order = grocerySort === "meal" ? [...mealOrder, SHARED] : STORE_SECTIONS;
  const buckets = new Map(order.map(name => [name, []]));
  const cart = [];
  items.forEach(it => {
    if (it.checked) { cart.push(it); return; }
    const name = grocerySort === "meal" ? (it.meals.length === 1 ? it.meals[0] : SHARED) : it.section;
    buckets.get(name).push(it);
  });

  const groupHTML = (title, its, extraClass = "") => `
    <section class="grocery-group ${extraClass}">
      <h3 class="grocery-group-heading">${title} <span class="grocery-group-count">${its.length}</span></h3>
      <ul class="grocery-list">${its.map(it => it.html).join("")}</ul>
    </section>`;
  // "Pound Cake (Bundt) (Wed Dinner)" -> name + muted "Wed Dinner"
  const mealTitle = src => {
    const m = src.match(/^(.*) \((.*)\)$/);
    return m ? `${esc(m[1])} <span class="grocery-group-meta">${esc(m[2])}</span>` : esc(src);
  };

  let html = "";
  buckets.forEach((its, name) => {
    if (its.length) html += groupHTML(grocerySort === "meal" && name !== SHARED ? mealTitle(name) : esc(name), its);
  });
  if (!html) html = `<p class="extras-empty">Everything's in your cart. 🎉</p>`;
  if (cart.length) html += groupHTML("In your cart", cart, "grocery-group-cart");
  list.innerHTML = html;
}

// One-time listeners on containers that survive re-renders.
function setupGroceryControls() {
  const list = document.getElementById("grocery-list");
  list.addEventListener("change", e => {
    const li = e.target.closest("li[data-key]");
    if (!li || e.target.type !== "checkbox") return;
    const key = li.dataset.key;
    if (e.target.checked) groceryChecked[key] = true; else delete groceryChecked[key];
    saveJSON("mealprep.groceryChecked", groceryChecked);
    renderGrocery(); // moves the item into / out of "In your cart"
    // Keep keyboard focus on the same item after it moves.
    const moved = list.querySelector(`li[data-key="${key}"] input`);
    if (moved) moved.focus({ preventScroll: true });
  });

  const toggle = document.getElementById("grocery-sort");
  const syncToggle = () => toggle.querySelectorAll("button").forEach(b =>
    b.setAttribute("aria-pressed", String(b.dataset.sort === grocerySort)));
  toggle.addEventListener("click", e => {
    const btn = e.target.closest("button[data-sort]");
    if (!btn) return;
    grocerySort = btn.dataset.sort;
    saveJSON("mealprep.grocerySort", grocerySort);
    syncToggle();
    renderGrocery();
  });
  syncToggle();
}

// ---------------- ADD RECIPE DIALOG ----------------
function setupAddRecipeDialog() {
  const dialog = document.getElementById("add-recipe-dialog");
  document.getElementById("add-recipe-btn").addEventListener("click", () => dialog.showModal());
  document.getElementById("add-recipe-cancel").addEventListener("click", () => dialog.close());
  document.getElementById("add-recipe-form").addEventListener("submit", e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const hasMacros = ["protein_g", "fat_g", "carb_g", "fiber_g", "calories"].some(k => fd.get(k));
    const macros = hasMacros ? {
      protein_g: parseFloat(fd.get("protein_g")) || 0,
      fat_g: parseFloat(fd.get("fat_g")) || 0,
      carb_g: parseFloat(fd.get("carb_g")) || 0,
      fiber_g: parseFloat(fd.get("fiber_g")) || 0,
      calories: parseFloat(fd.get("calories")) || 0
    } : null;
    const name = fd.get("name");
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const recipe = {
      id, name, category: fd.get("category"), mealSlot: fd.get("mealSlot"),
      dietDay: fd.get("dietDay"), preferred: fd.get("preferred") === "on", servings: parseInt(fd.get("servings")) || 1,
      ingredients: fd.get("ingredients").split("\n").map(s => s.trim()).filter(Boolean),
      instructions: fd.get("instructions"), macros, source: "User added"
    };
    document.getElementById("add-recipe-output").value = JSON.stringify(recipe, null, 2) + ",";
  });
}

init();
