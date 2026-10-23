import { dayKey, nextReset } from "./day.js";
import { loadFoods, findFood, portionsFor, caloriesFor } from "./foods.js";
import { applyModifiers } from "./modifiers.js";
import { lookup } from "./lookup.js";

const STORAGE_KEY = "cookbot";
const KEEP_DAYS = 30;
const DEFAULT_GOAL = 2000;
const MAX_RECENT = 12;

const $ = (id) => document.getElementById(id);

// ---- Storage (everything lives in this browser's localStorage) ----

function load() {
  const defaults = { goal: DEFAULT_GOAL, apiKey: "", entries: [], recent: [] };
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (data) return { ...defaults, ...data };
  } catch {}
  return defaults;
}

function save() {
  const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
  state.entries = state.entries.filter((e) => e.ts >= cutoff);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage full: drop photo thumbnails from older days and retry.
    const today = dayKey();
    state.entries.forEach((e) => { if (e.day !== today) delete e.thumb; });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }
}

const state = load();
const isFirstRun = !localStorage.getItem(STORAGE_KEY);

// ---- Summary and log ----

function todaysEntries() {
  const today = dayKey();
  return state.entries.filter((e) => e.day === today);
}

function render() {
  const entries = todaysEntries();
  const eaten = entries.reduce((sum, e) => sum + e.total, 0);
  const remaining = state.goal - eaten;

  $("goal").textContent = state.goal.toLocaleString();
  $("eaten").textContent = eaten.toLocaleString();
  $("remaining").textContent = Math.abs(remaining).toLocaleString();
  $("remaining-label").textContent = remaining >= 0 ? "calories left" : "calories over";
  const ring = $("ring");
  ring.classList.toggle("over", remaining < 0);
  ring.style.setProperty("--pct", Math.min(100, (eaten / state.goal) * 100));

  const reset = nextReset();
  $("reset-info").textContent = `Resets ${reset.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} ${reset.toDateString() === new Date().toDateString() ? "today" : "tomorrow"}`;

  const log = $("log");
  log.replaceChildren(...entries.slice().reverse().map(renderEntry));
  $("log-empty").hidden = entries.length > 0;
}

function renderEntry(entry) {
  const li = document.createElement("li");

  let thumb;
  if (entry.thumb) {
    thumb = document.createElement("img");
    thumb.src = entry.thumb;
    thumb.alt = "";
  } else {
    thumb = document.createElement("div");
    thumb.className = "thumb-placeholder";
    thumb.textContent = "✎";
  }

  const desc = document.createElement("div");
  desc.className = "desc";
  const names = document.createElement("div");
  names.textContent = entry.items.map((i) => i.name).join(", ") || "Manual entry";
  const time = document.createElement("div");
  time.className = "muted small";
  time.textContent = new Date(entry.ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  desc.append(names, time);

  const cal = document.createElement("span");
  cal.className = "cal";
  cal.textContent = entry.total.toLocaleString();

  const remove = document.createElement("button");
  remove.className = "remove";
  remove.setAttribute("aria-label", "Remove entry");
  remove.textContent = "✕";
  remove.addEventListener("click", () => {
    if (!confirm(`Remove ${entry.total} calories from today?`)) return;
    state.entries = state.entries.filter((e) => e.id !== entry.id);
    save();
    render();
  });

  li.append(thumb, desc, cal, remove);
  return li;
}

// Re-render exactly at the 3am reset, and whenever the app comes back to the
// foreground (timers don't run while a phone is asleep).
function scheduleReset() {
  setTimeout(() => { render(); scheduleReset(); }, nextReset() - Date.now() + 1000);
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) render(); });

// ---- Food search ----

const foodsReady = loadFoods().catch(() => null);

// Portions offered for a plan (see modifiers.js), its default first.
const planPortions = (plan) => (plan.portion ? [plan.portion, ...portionsFor(plan.food)] : portionsFor(plan.food));

// Calories for `quantity` of what was ordered, e.g. 1 Big Mac, meat only.
function planCalories(plan, portion, units) {
  const adjustment = plan.adjustments.reduce((sum, a) => sum + a.calories, 0);
  return Math.max(0, caloriesFor(plan.food, portion.grams, units) + Math.round(adjustment * (units / plan.count)));
}

// What changed, e.g. "no bun −123 cal · Counted as 2 regular patties of beef".
const planDetails = (plan) => [
  ...plan.adjustments.map((a) => `${a.label} ${a.calories < 0 ? "−" : "+"}${Math.abs(a.calories)} cal`),
  ...plan.notes,
].join(" · ");

function resultButton(plan, quantity) {
  const li = document.createElement("li");
  const button = document.createElement("button");
  const name = document.createElement("span");
  name.className = "food-name";
  name.textContent = plan.name;
  const info = document.createElement("span");
  info.className = "muted small";
  const [portion] = planPortions(plan);
  const units = quantity * plan.count;
  const amount = units === 1 ? `per ${portion.label}` : `for ${units} × ${portion.label}`;
  info.textContent = [`${planCalories(plan, portion, units).toLocaleString()} cal ${amount}`, planDetails(plan)].filter(Boolean).join(" · ");
  button.append(name, info);
  button.addEventListener("click", () => {
    addFood(plan, quantity);
    $("search").value = "";
    showSearchResults();
    $("search").blur();
  });
  li.append(button);
  return li;
}

async function showSearchResults() {
  const query = $("search").value;
  const hint = $("search-hint");
  const list = $("search-results");

  if (!query.trim()) {
    // Empty box: offer recently logged foods for quick re-adding.
    const focused = document.activeElement === $("search");
    const recent = focused ? state.recent.map((food) => applyModifiers(food, [], findFood)) : [];
    list.replaceChildren(...recent.map((plan) => resultButton(plan, 1)));
    hint.hidden = !(focused && state.recent.length);
    hint.textContent = "Recent";
    return;
  }

  if (!(await foodsReady)) {
    hint.hidden = false;
    hint.textContent = "Couldn't load the food list. Check your connection and reload.";
    return;
  }
  if (query !== $("search").value) return; // a newer keystroke is already being handled

  const { results, quantity, unmatched } = lookup(query);
  list.replaceChildren(...results.map((plan) => resultButton(plan, quantity)));
  hint.hidden = results.length > 0 && !unmatched.length;
  hint.textContent = !results.length
    ? "No matches. Try a simpler word, like \"chicken\" or \"soda\", or tap \"Enter calories yourself\"."
    : `Didn't recognize ${unmatched.map((w) => `"${w}"`).join(", ")}, so these are the closest matches.`;
}

$("search").addEventListener("input", showSearchResults);
$("search").addEventListener("focus", showSearchResults);
$("search").addEventListener("blur", () => {
  // Let a tap on a recent item land before the list hides.
  setTimeout(() => { if (!$("search").value.trim()) showSearchResults(); }, 200);
});

function rememberRecent(food) {
  state.recent = [food, ...state.recent.filter((f) => f[0] !== food[0])].slice(0, MAX_RECENT);
}

// ---- Photo handling ----

let pending = null; // { image: {mediaType, base64}, thumb } while a photo is being reviewed

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Couldn't read that image.")); };
    img.src = url;
  });
}

function resizeToDataUrl(img, maxSide, quality) {
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

$("photo-btn").addEventListener("click", (event) => {
  if (state.apiKey) return; // the label opens the file picker
  event.preventDefault();
  alert("Photo estimates use your own Anthropic API key, which bills a few cents per photo. Add a key in Settings to use them. Searching foods is free.");
  openSettings();
});

$("photo-input").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  try {
    const img = await loadImage(file);
    const full = resizeToDataUrl(img, 1568, 0.85);
    pending = {
      image: { mediaType: "image/jpeg", base64: full.split(",")[1] },
      thumb: resizeToDataUrl(img, 160, 0.7),
    };
    $("preview").src = full;
    $("note").value = "";
    $("estimate-btn").disabled = false;
    setStatus("");
    $("photo-step").hidden = false;
    $("review").hidden = false;
    $("review").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    alert(err.message);
  }
});

function setStatus(text, isError = false) {
  $("status").textContent = text;
  $("status").classList.toggle("error", isError);
}

$("estimate-btn").addEventListener("click", async () => {
  const button = $("estimate-btn");
  button.disabled = true;
  setStatus("Looking at your photo… this can take a few seconds.");
  try {
    const { estimateCalories } = await import("./estimate.js");
    const result = await estimateCalories({ apiKey: state.apiKey, image: pending.image, note: $("note").value.trim() });
    if (!pending) return; // cancelled while waiting
    setStatus(result.items.length ? "" : "No food or drink found. Search or enter items manually.");
    result.items.forEach(addCustomItem);
    $("ai-notes").textContent = result.notes || "";
    showMeal();
  } catch (err) {
    setStatus(err.message || "Something went wrong. Please try again.", true);
  } finally {
    button.disabled = false;
  }
});

// ---- The meal being built ----

function showMeal() {
  $("review").hidden = false;
  $("result").hidden = false;
  updateTotal();
}

function closeMeal() {
  pending = null;
  $("review").hidden = true;
  $("result").hidden = true;
  $("photo-step").hidden = true;
  $("preview").removeAttribute("src");
  $("items").replaceChildren();
  $("ai-notes").textContent = "";
}

function removeButton(li) {
  const remove = document.createElement("button");
  remove.className = "remove";
  remove.setAttribute("aria-label", "Remove item");
  remove.textContent = "✕";
  remove.addEventListener("click", () => {
    li.remove();
    if (!$("items").children.length && !pending) closeMeal();
    else updateTotal();
  });
  return remove;
}

function calorieInput(value) {
  const cal = document.createElement("input");
  cal.type = "number";
  cal.className = "cal";
  cal.min = "0";
  cal.step = "1";
  cal.inputMode = "numeric";
  cal.value = value;
  cal.setAttribute("aria-label", "Calories");
  cal.addEventListener("input", updateTotal);
  return cal;
}

// A food from the USDA list: pick how many and which portion, calories follow.
function addFood(plan, quantity = 1) {
  const li = document.createElement("li");
  li.plan = plan;
  const portions = planPortions(plan);

  const nameWrap = document.createElement("div");
  nameWrap.className = "name-wrap";
  const label = document.createElement("div");
  label.className = "food-label";
  label.textContent = plan.name;

  const amount = document.createElement("div");
  amount.className = "amount";
  const qty = document.createElement("input");
  qty.type = "number";
  qty.className = "qty";
  qty.min = "0";
  qty.step = "any";
  qty.inputMode = "decimal";
  qty.value = quantity * plan.count;
  qty.setAttribute("aria-label", "How many");
  const select = document.createElement("select");
  select.setAttribute("aria-label", "Portion");
  portions.forEach((p, i) => select.add(new Option(p.label, i)));
  amount.append(qty, select);
  nameWrap.append(label);
  const details = planDetails(plan);
  if (details) {
    const note = document.createElement("div");
    note.className = "muted small";
    note.textContent = details;
    nameWrap.append(note);
  }

  const cal = calorieInput(0);
  const recalc = () => {
    cal.value = planCalories(plan, portions[select.value], Number(qty.value) || 0);
    updateTotal();
  };
  qty.addEventListener("input", recalc);
  select.addEventListener("change", recalc);

  li.append(nameWrap, cal, removeButton(li), amount);
  $("items").append(li);
  recalc();
  showMeal();
}

// A free-form item: from a photo estimate, or typed in by hand.
function addCustomItem(item) {
  const li = document.createElement("li");

  const nameWrap = document.createElement("div");
  nameWrap.className = "name-wrap";
  const name = document.createElement("input");
  name.type = "text";
  name.className = "name";
  name.value = item.name;
  name.placeholder = "Food or drink";
  nameWrap.append(name);
  if (item.portion) {
    const portion = document.createElement("span");
    portion.className = "muted small portion";
    portion.textContent = item.portion;
    nameWrap.append(portion);
  }

  li.append(nameWrap, calorieInput(item.calories), removeButton(li));
  $("items").append(li);
  showMeal();
  return li;
}

function readItems() {
  return [...$("items").children].map((li) => {
    const calories = Math.max(0, Math.round(Number(li.querySelector(".cal").value) || 0));
    if (li.plan) {
      const select = li.querySelector("select");
      return {
        name: li.plan.name,
        portion: `${li.querySelector(".qty").value} × ${select.options[select.selectedIndex].text}`,
        calories,
        food: li.plan.source,
      };
    }
    return {
      name: li.querySelector(".name").value.trim(),
      portion: li.querySelector(".portion")?.textContent ?? "",
      calories,
    };
  });
}

function updateTotal() {
  const total = readItems().reduce((sum, i) => sum + i.calories, 0);
  $("estimate-total").textContent = total.toLocaleString();
  $("confirm-btn").disabled = total <= 0;
}

$("manual-add").addEventListener("click", () => {
  addCustomItem({ name: "", portion: "", calories: "" }).querySelector("input").focus();
});

$("add-item").addEventListener("click", () => {
  addCustomItem({ name: "", portion: "", calories: "" }).querySelector("input").focus();
});

$("cancel-btn").addEventListener("click", closeMeal);

$("confirm-btn").addEventListener("click", () => {
  const items = readItems().filter((i) => i.calories > 0 || i.name);
  const total = items.reduce((sum, i) => sum + i.calories, 0);
  if (total <= 0) return;
  items.filter((i) => i.food).forEach((i) => rememberRecent(i.food));
  const now = Date.now();
  state.entries.push({
    id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
    ts: now,
    day: dayKey(new Date(now)),
    items: items.map(({ food, ...rest }) => rest),
    total,
    thumb: pending?.thumb,
  });
  save();
  closeMeal();
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
});

// ---- Settings ----

function openSettings() {
  $("goal-input").value = state.goal;
  $("key-input").value = state.apiKey;
  $("settings").showModal();
}

$("open-settings").addEventListener("click", openSettings);

$("settings").addEventListener("close", () => {
  if ($("settings").returnValue !== "save") return;
  const goal = Math.round(Number($("goal-input").value));
  if (goal > 0) state.goal = goal;
  state.apiKey = $("key-input").value.trim();
  save();
  render();
});

// ---- Start ----

render();
scheduleReset();
if (isFirstRun) openSettings();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
