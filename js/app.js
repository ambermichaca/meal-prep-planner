const SLOTS = ["Breakfast", "Snack 1", "Lunch", "Snack 2", "Dinner", "Snack 3"];
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const SLOT_TO_MEALSLOT = {
  "Breakfast": "Breakfast", "Lunch": "Lunch", "Dinner": "Dinner",
  "Snack 1": "Snack", "Snack 2": "Snack", "Snack 3": "Snack"
};

let RECIPES = [];
let plan = loadJSON("mealprep.plan", {});
let groceryChecked = loadJSON("mealprep.groceryChecked", {});
let currentCategory = "";

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
    renderRecipes();
    renderPlanner();
    renderGrocery();
    setupAddRecipeDialog();
    document.getElementById("search").addEventListener("input", renderRecipes);
    document.getElementById("filter-mealslot").addEventListener("change", renderRecipes);
    document.getElementById("filter-diet").addEventListener("change", renderRecipes);
    document.getElementById("clear-week-btn").addEventListener("click", () => {
      if (confirm("Clear all meals selected for this week?")) {
        plan = {}; saveJSON("mealprep.plan", plan); renderPlanner(); renderGrocery();
      }
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

// ---------------- MODE SWITCH (Meal Prep vs Recipes — two fully separate views) ----------------
function setupModeSwitch() {
  document.getElementById("mealprep-btn").addEventListener("click", () => switchMode("mealprep"));
  // recipes-btn is wired in setupCategoryMenuTriggers (it also owns the category dropdown)
}

function switchMode(name) {
  document.querySelectorAll(".mode-heading").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".mode-panel").forEach(p => p.classList.remove("active"));
  document.getElementById(name === "mealprep" ? "mealprep-btn" : "recipes-btn").classList.add("active");
  document.getElementById("mode-" + name).classList.add("active");
}

function setupFilters() {
  const slots = [...new Set(RECIPES.map(r => r.mealSlot))].sort();
  const diets = [...new Set(RECIPES.map(r => r.dietDay))].sort();
  fillSelect("filter-mealslot", slots);
  fillSelect("filter-diet", diets);
  const cats = [...new Set(RECIPES.map(r => r.category))].sort();
  document.getElementById("category-list").innerHTML = cats.map(c => `<option value="${esc(c)}">`).join("");
}

function closeCategoryMenu() {
  document.getElementById("category-menu").classList.remove("open");
  document.getElementById("recipes-btn").setAttribute("aria-expanded", "false");
}

function setupCategoryMenu() {
  const cats = [...new Set(RECIPES.map(r => r.category))].sort();
  const menu = document.getElementById("category-menu");
  const allBtn = `<button role="menuitem" data-cat="" class="${currentCategory === "" ? "active" : ""}">All Categories</button>`;
  const catBtns = cats.map(c => `<button role="menuitem" data-cat="${esc(c)}" class="${currentCategory === c ? "active" : ""}">${esc(c)}</button>`).join("");
  menu.innerHTML = allBtn + catBtns;

  menu.querySelectorAll("button").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      currentCategory = btn.dataset.cat;
      switchMode("recipes");
      setupCategoryMenu();
      renderRecipes();
      renderActiveCategoryTag();
      closeCategoryMenu();
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

function renderActiveCategoryTag() {
  const tag = document.getElementById("active-category-tag");
  tag.innerHTML = currentCategory
    ? `Category: ${esc(currentCategory)} <button id="clear-category">Clear</button>`
    : "";
  const clearBtn = document.getElementById("clear-category");
  if (clearBtn) clearBtn.addEventListener("click", () => {
    currentCategory = "";
    setupCategoryMenu();
    renderRecipes();
    renderActiveCategoryTag();
  });
}

function fillSelect(id, values) {
  const sel = document.getElementById(id);
  values.forEach(v => {
    const opt = document.createElement("option");
    opt.value = v; opt.textContent = v;
    sel.appendChild(opt);
  });
}

function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

// ---------------- RECIPES ----------------
function renderRecipes() {
  const q = document.getElementById("search").value.toLowerCase();
  const slot = document.getElementById("filter-mealslot").value;
  const diet = document.getElementById("filter-diet").value;

  const filtered = RECIPES.filter(r => {
    if (q && !r.name.toLowerCase().includes(q) && !r.ingredients.join(" ").toLowerCase().includes(q)) return false;
    if (currentCategory && r.category !== currentCategory) return false;
    if (slot && r.mealSlot !== slot) return false;
    if (diet && r.dietDay !== diet) return false;
    return true;
  });

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

function macroLineText(r) {
  const m = r.macros;
  return m
    ? `${m.protein_g}g protein · ${m.fat_g}g fat · ${m.carb_g}g carb · ${m.fiber_g}g fiber · ${m.calories} kcal`
    : "Macros not yet calculated";
}

function recipeCardHTML(r) {
  return `
    <div class="recipe-card">
      <h3>${esc(r.name)}</h3>
      <div class="badge-row">
        <span class="badge">${esc(r.category)}</span><span class="sep">·</span>
        <span class="badge">${esc(r.mealSlot)}</span><span class="sep">·</span>
        <span class="badge">${esc(r.dietDay)}</span>
        ${!r.preferred ? '<span class="sep">·</span><span class="badge backlog">Backlog</span>' : ""}
      </div>
      <div class="macro-line">${macroLineText(r)}</div>
      <details>
        <summary>Ingredients &amp; Method</summary>
        <ul>${r.ingredients.map(i => `<li>${esc(i)}</li>`).join("")}</ul>
        <p>${esc(r.instructions)}</p>
      </details>
      ${r.notes ? `<div class="recipe-note">${esc(r.notes)}</div>` : ""}
    </div>`;
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
    <div class="day-card">
      <h4>${day}</h4>
      ${SLOTS.map(slot => {
        const options = RECIPES.filter(r => r.mealSlot === SLOT_TO_MEALSLOT[slot]);
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

// ---------------- INGREDIENT PARSING (for grocery consolidation) ----------------
// Best-effort: parses a leading "quantity + unit" off a free-text ingredient line
// (e.g. "4 oz chicken breast" -> qty 4, unit oz, item "chicken breast"). Lines that
// don't start with a recognizable quantity (side-dish references, "to taste", etc.)
// still get listed on the grocery list, just without a summed amount.
const VOLUME_TO_TBSP = { tsp: 1 / 3, tbsp: 1, cup: 16 };
const UNIT_LABEL = {
  oz: n => "oz", cup: n => n === 1 ? "cup" : "cups", tbsp: n => "tbsp", tsp: n => "tsp",
  slice: n => n === 1 ? "slice" : "slices", scoop: n => n === 1 ? "scoop" : "scoops",
  serving: n => n === 1 ? "serving" : "servings", clove: n => n === 1 ? "clove" : "cloves",
  packet: n => n === 1 ? "packet" : "packets"
};

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
  if (/^oz|ounce/.test(u)) return "oz";
  if (/^cup/.test(u)) return "cup";
  if (/^tbsp|tablespoon/.test(u)) return "tbsp";
  if (/^tsp|teaspoon/.test(u)) return "tsp";
  if (/^slice/.test(u)) return "slice";
  if (/^scoop/.test(u)) return "scoop";
  if (/^serving/.test(u)) return "serving";
  if (/^clove/.test(u)) return "clove";
  if (/^packet/.test(u)) return "packet";
  return null; // "whole" and unrecognized units fall back to unitless counting
}

function parseIngredientLine(rawText) {
  const text = rawText.replace(/\([^)]*\)/g, "").trim();
  const numTok = "(?:\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+(?:\\.\\d+)?)";
  const qtyRegex = new RegExp(`^(${numTok})(\\s*-\\s*(${numTok}))?\\s*`);
  const m = text.match(qtyRegex);
  if (!m) {
    const item = (text || rawText).split(",")[0].trim().toLowerCase();
    return { qty: null, unit: null, item: item || rawText.toLowerCase(), display: rawText };
  }
  let qty = parseQtyToken(m[1]);
  if (m[3]) {
    const hi = parseQtyToken(m[3]);
    if (hi != null) qty = (qty + hi) / 2;
  }
  const rest = text.slice(m[0].length);
  const unitRegex = /^([a-z]+)\.?\s*/i;
  const um = rest.match(unitRegex);
  let unit = null, itemPart = rest;
  if (um) {
    const c = canonicalUnit(um[1]);
    if (c) { unit = c; itemPart = rest.slice(um[0].length); }
  }
  const item = (itemPart || rest).split(",")[0].trim().toLowerCase() || rawText.toLowerCase();
  return { qty, unit, item, display: rawText };
}

function formatQty(n) {
  const r = Math.round(n * 100) / 100;
  return String(r);
}

function formatVolumeTbsp(totalTbsp) {
  const cups = Math.floor(totalTbsp / 16 + 1e-9);
  const remTbsp = totalTbsp - cups * 16;
  const parts = [];
  if (cups > 0) parts.push(`${formatQty(cups)} ${UNIT_LABEL.cup(cups)}`);
  if (remTbsp > 0.01) parts.push(`${formatQty(remTbsp)} tbsp`);
  return parts.join(" ");
}

// ---------------- GROCERY LIST ----------------
function renderGrocery() {
  const groups = {}; // normalized item -> { displayName, entries:[{qty,unit,source}], noQty:[{source}] }

  DAYS.forEach(day => {
    const selections = plan[day] || {};
    Object.entries(selections).forEach(([slot, id]) => {
      if (!id) return;
      const r = RECIPES.find(x => x.id === id);
      if (!r) return;
      const source = `${r.name} (${day.slice(0, 3)} ${slot})`;
      r.ingredients.forEach(rawLine => {
        const parsed = parseIngredientLine(rawLine);
        if (!groups[parsed.item]) groups[parsed.item] = { displayName: parsed.item, entries: [], noQty: [] };
        if (parsed.qty != null) {
          groups[parsed.item].entries.push({ qty: parsed.qty, unit: parsed.unit, source });
        } else {
          groups[parsed.item].noQty.push({ source, display: rawLine });
        }
      });
    });
  });

  const keys = Object.keys(groups).sort();
  const list = document.getElementById("grocery-list");
  if (!keys.length) {
    list.innerHTML = "<p>Nothing planned yet — pick some meals above and this list fills in automatically.</p>";
    return;
  }

  list.innerHTML = keys.map(key => {
    const g = groups[key];
    let volumeTotal = 0;
    const otherBuckets = {}; // unit (or "×" for unitless count) -> total
    g.entries.forEach(e => {
      if (e.unit && VOLUME_TO_TBSP[e.unit] != null) {
        volumeTotal += e.qty * VOLUME_TO_TBSP[e.unit];
      } else if (e.unit) {
        otherBuckets[e.unit] = (otherBuckets[e.unit] || 0) + e.qty;
      } else {
        otherBuckets["×"] = (otherBuckets["×"] || 0) + e.qty;
      }
    });

    const qtyParts = [];
    if (volumeTotal > 0.01) qtyParts.push(formatVolumeTbsp(volumeTotal));
    Object.entries(otherBuckets).forEach(([u, total]) => {
      qtyParts.push(u === "×" ? formatQty(total) : `${formatQty(total)} ${UNIT_LABEL[u] ? UNIT_LABEL[u](total) : u}`);
    });
    const qtyLabel = qtyParts.length ? qtyParts.join(" + ") + " — " : "";

    const allSources = [...g.entries.map(e => e.source), ...g.noQty.map(e => e.source)];
    const unspecifiedNote = g.noQty.length
      ? `<br>Also needed (amount not specified): ${g.noQty.map(e => esc(e.display)).join("; ")}`
      : "";

    const displayName = key.charAt(0).toUpperCase() + key.slice(1);
    const keyHash = "gk-" + btoa(unescape(encodeURIComponent(key))).replace(/[^a-zA-Z0-9]/g, "");
    const checked = groceryChecked[keyHash] ? "checked" : "";

    return `<li class="${groceryChecked[keyHash] ? "checked" : ""}" data-key="${keyHash}">
      <label>
        <input type="checkbox" ${checked} />
        <span>
          <span class="item-name">${esc(displayName)}${qtyLabel ? ` <span class="item-qty">— ${esc(qtyLabel.replace(/ — $/, ""))}</span>` : ""}</span>
          <span class="item-sources">Used in: ${allSources.map(esc).join(", ")}${unspecifiedNote}</span>
        </span>
      </label>
    </li>`;
  }).join("");

  list.querySelectorAll("li").forEach(li => {
    const key = li.dataset.key;
    li.querySelector("input").addEventListener("change", e => {
      groceryChecked[key] = e.target.checked;
      saveJSON("mealprep.groceryChecked", groceryChecked);
      li.classList.toggle("checked", e.target.checked);
    });
  });
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
