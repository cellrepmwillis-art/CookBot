import { dayKey, nextReset } from "./day.js";

const STORAGE_KEY = "cookbot";
const KEEP_DAYS = 30;
const DEFAULT_GOAL = 2000;

const $ = (id) => document.getElementById(id);

// ---- Storage (everything lives in this browser's localStorage) ----

function load() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (data) return { goal: DEFAULT_GOAL, apiKey: "", entries: [], ...data };
  } catch {}
  return { goal: DEFAULT_GOAL, apiKey: "", entries: [] };
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

// ---- Photo handling ----

let pending = null; // { image: {mediaType, base64}, thumb } or { manual: true }

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
    openReview(full);
  } catch (err) {
    alert(err.message);
  }
});

$("manual-add").addEventListener("click", () => {
  pending = { manual: true };
  openReview(null);
  showItems([{ name: "", portion: "", calories: 0 }], "");
  $("items").querySelector("input")?.focus();
});

function openReview(previewSrc) {
  $("review").hidden = false;
  $("preview").hidden = !previewSrc;
  if (previewSrc) $("preview").src = previewSrc;
  $("note").parentElement.hidden = !previewSrc;
  $("note").value = "";
  $("estimate-btn").hidden = !previewSrc;
  $("estimate-btn").disabled = false;
  setStatus("");
  $("result").hidden = true;
  $("review").scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeReview() {
  pending = null;
  $("review").hidden = true;
  $("preview").removeAttribute("src");
}

function setStatus(text, isError = false) {
  $("status").textContent = text;
  $("status").classList.toggle("error", isError);
}

$("estimate-btn").addEventListener("click", async () => {
  if (!state.apiKey) {
    setStatus("Add your Anthropic API key in Settings first.", true);
    openSettings();
    return;
  }
  const button = $("estimate-btn");
  button.disabled = true;
  $("result").hidden = true;
  setStatus("Looking at your photo… this can take a few seconds.");
  try {
    const { estimateCalories } = await import("./estimate.js");
    const result = await estimateCalories({ apiKey: state.apiKey, image: pending.image, note: $("note").value.trim() });
    if (!pending) return; // cancelled while waiting
    setStatus(result.items.length ? "" : "No food or drink found. Add items manually if needed.");
    showItems(result.items, result.notes);
  } catch (err) {
    setStatus(err.message || "Something went wrong. Please try again.", true);
  } finally {
    button.disabled = false;
  }
});

// ---- Editable estimate ----

function showItems(items, notes) {
  $("items").replaceChildren(...items.map(itemRow));
  $("ai-notes").textContent = notes || "";
  $("result").hidden = false;
  updateTotal();
}

function itemRow(item) {
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
    portion.className = "muted small";
    portion.textContent = item.portion;
    nameWrap.append(portion);
  }

  const cal = document.createElement("input");
  cal.type = "number";
  cal.className = "cal";
  cal.min = "0";
  cal.step = "1";
  cal.inputMode = "numeric";
  cal.value = item.calories;
  cal.setAttribute("aria-label", "Calories");
  cal.addEventListener("input", updateTotal);

  const remove = document.createElement("button");
  remove.className = "remove";
  remove.setAttribute("aria-label", "Remove item");
  remove.textContent = "✕";
  remove.addEventListener("click", () => { li.remove(); updateTotal(); });

  li.append(nameWrap, cal, remove);
  return li;
}

function readItems() {
  return [...$("items").children].map((li) => ({
    name: li.querySelector(".name").value.trim(),
    portion: li.querySelector(".small")?.textContent ?? "",
    calories: Math.max(0, Math.round(Number(li.querySelector(".cal").value) || 0)),
  }));
}

function updateTotal() {
  const total = readItems().reduce((sum, i) => sum + i.calories, 0);
  $("estimate-total").textContent = total.toLocaleString();
  $("confirm-btn").disabled = total <= 0;
}

$("add-item").addEventListener("click", () => {
  const row = itemRow({ name: "", portion: "", calories: 0 });
  $("items").append(row);
  row.querySelector("input").focus();
  updateTotal();
});

$("cancel-btn").addEventListener("click", closeReview);

$("confirm-btn").addEventListener("click", () => {
  const items = readItems().filter((i) => i.calories > 0 || i.name);
  const total = items.reduce((sum, i) => sum + i.calories, 0);
  if (total <= 0) return;
  const now = Date.now();
  state.entries.push({
    id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
    ts: now,
    day: dayKey(new Date(now)),
    items,
    total,
    thumb: pending?.thumb,
  });
  save();
  closeReview();
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
