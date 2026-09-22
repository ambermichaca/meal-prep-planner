const SLOTS = ["Breakfast", "Snack 1", "Lunch", "Snack 2", "Dinner", "Snack 3"];
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const SLOT_TO_MEALSLOT = {
  "Breakfast": "Breakfast", "Lunch": "Lunch", "Dinner": "Dinner",
  "Snack 1": "Snack", "Snack 2": "Snack", "Snack 3": "Snack"
};

let RECIPES = [];
let plan = loadJSON("mealprep.plan", {});
let groceryChecked = loadJSON("mealprep.groceryChecked", {});

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
  setupFilters();
  renderRecipes();
  renderPlanner();
  renderGrocery();
  setupTabs();
  setupAddRecipeDialog();
  document.getElementById("search").addEventListener("input", renderRecipes);
  document.getElementById("filter-category").addEventListener("change", renderRecipes);
  document.getElementById("filter-mealslot").addEventListener("change", renderRecipes);
  document.getElementById("filter-diet").addEventListener("change", renderRecipes);
  document.getElementById("filter-preferred").addEventListener("change", renderRecipes);
  document.getElementById("clear-week-btn").addEventListener("click", () => {
    if (confirm("Clear all meals selected for this week?")) {
      plan = {}; saveJSON("mealprep.plan", plan); renderPlanner(); renderGrocery();
    }
  });
  document.getElementById("regen-grocery-btn").addEventListener("click", renderGrocery);
}

function setupTabs() {
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
    });
  });
}

function setupFilters() {
  const cats = [...new Set(RECIPES.map(r => r.category))].sort();
  const slots = [...new Set(RECIPES.map(r => r.mealSlot))].sort();
  const diets = [...new Set(RECIPES.map(r => r.dietDay))].sort();
  fillSelect("filter-category", cats);
  fillSelect("filter-mealslot", slots);
  fillSelect("filter-diet", diets);
  document.getElementById("category-list").innerHTML = cats.map(c => `<option value="${esc(c)}">`).join("");
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

function renderRecipes() {
  const q = document.getElementById("search").value.toLowerCase();
  const cat = document.getElementById("filter-category").value;
  const slot = document.getElementById("filter-mealslot").value;
  const diet = document.getElementById("filter-diet").value;
  const prefOnly = document.getElementById("filter-preferred").checked;

  const filtered = RECIPES.filter(r => {
    if (q && !r.name.toLowerCase().includes(q) && !r.ingredients.join(" ").toLowerCase().includes(q)) return false;
    if (cat && r.category !== cat) return false;
    if (slot && r.mealSlot !== slot) return false;
    if (diet && r.dietDay !== diet) return false;
    if (prefOnly && !r.preferred) return false;
    return true;
  });

  const grid = document.getElementById("recipe-grid");
  grid.innerHTML = filtered.map(r => recipeCardHTML(r)).join("") || "<p>No recipes match these filters.</p>";
}

function recipeCardHTML(r) {
  const m = r.macros;
  const macroLine = m
    ? `${m.protein_g}g protein · ${m.fat_g}g fat · ${m.carb_g}g carb · ${m.fiber_g}g fiber · ${m.calories} kcal`
    : "Macros not yet calculated";
  return `
    <div class="recipe-card">
      <h3>${esc(r.name)}</h3>
      <div class="badge-row">
        <span class="badge">${esc(r.category)}</span>
        <span class="badge">${esc(r.mealSlot)}</span>
        <span class="badge">${esc(r.dietDay)}</span>
        ${!r.preferred ? '<span class="badge backlog">Backlog</span>' : ""}
      </div>
      <div class="macro-line">${macroLine}</div>
      <details>
        <summary>Ingredients &amp; method</summary>
        <ul>${r.ingredients.map(i => `<li>${esc(i)}</li>`).join("")}</ul>
        <p>${esc(r.instructions)}</p>
      </details>
      ${r.notes ? `<div class="recipe-note">${esc(r.notes)}</div>` : ""}
    </div>`;
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
        updateDayTotals(day);
        updateWeekTotals();
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
        return `<label>${slot}
          <select id="${selectId(day, slot)}">
            <option value="">—</option>
            ${options.map(r => `<option value="${r.id}" ${r.id === current ? "selected" : ""}>${esc(r.name)}</option>`).join("")}
          </select>
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

// ---------------- GROCERY LIST ----------------
function renderGrocery() {
  const counts = {}; // ingredient text -> [{recipeName, day, slot}]
  DAYS.forEach(day => {
    const selections = plan[day] || {};
    Object.entries(selections).forEach(([slot, id]) => {
      if (!id) return;
      const r = RECIPES.find(x => x.id === id);
      if (!r) return;
      r.ingredients.forEach(ing => {
        if (!counts[ing]) counts[ing] = [];
        counts[ing].push(`${r.name} (${day.slice(0,3)} ${slot})`);
      });
    });
  });

  const items = Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0]));
  const list = document.getElementById("grocery-list");
  if (!items.length) {
    list.innerHTML = "<p>Nothing planned yet — pick some meals in the Weekly Planner tab first.</p>";
    return;
  }
  list.innerHTML = items.map(([ing, sources]) => {
    const key = "gk-" + btoa(unescape(encodeURIComponent(ing))).replace(/[^a-zA-Z0-9]/g, "");
    const checked = groceryChecked[key] ? "checked" : "";
    return `<li class="${groceryChecked[key] ? "checked" : ""}" data-key="${key}">
      <input type="checkbox" ${checked} />
      <div><div class="item-name">${esc(ing)}</div>
      <div class="item-sources">Used in: ${sources.map(esc).join(", ")}</div></div>
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
    const hasMacros = ["protein_g","fat_g","carb_g","fiber_g","calories"].some(k => fd.get(k));
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
