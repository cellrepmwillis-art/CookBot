import { dayKey, nextReset, previousDay } from "./day.js";
import { streak, recap } from "./streak.js";
import { proteinTarget, calorieSuggestion, AIMS } from "./profile.js";
import { recommend, DIETS } from "./recommend.js";
import { loadFoods, addFoods, findFood, findByBarcode } from "./foods.js";
import { applyModifiers } from "./modifiers.js";
import { resolve, planItem } from "./resolve.js";
import { barcodeKeys, startScanner, decodePhoto, lookupOnline } from "./barcode.js";

// Shown at the bottom of Settings, to check which version a phone is running.
const VERSION = "2026-10-23 · 10:45 PM";
const STORAGE_KEY = "cookbot";
const KEEP_DAYS = 30;
const DEFAULT_GOAL = 2000;

const $ = (id) => document.getElementById(id);

// ---- Storage (everything lives in this browser's localStorage) ----

function load() {
  // myFoods: calories the user gave for something they typed (or corrected),
  // and products looked up online by barcode.
  // days: { eaten, goal } for every day with anything logged, kept for good
  // (entries are only kept 30 days), for the streak. lastDay: the day the app
  // was last open, for the morning recap.
  // profile: { sex, age, heightIn, weightLb, aim, diet } for the protein and
  // calorie goals and the Recommend line.
  const defaults = { goal: DEFAULT_GOAL, apiKey: "", entries: [], myFoods: [], days: {}, lastDay: null, profile: {} };
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

// Days logged before streaks existed: summarized from the 30-day log.
const logged = {};
for (const entry of state.entries) logged[entry.day] = (logged[entry.day] ?? 0) + entry.total;
for (const [day, eaten] of Object.entries(logged)) state.days[day] ??= { eaten, goal: state.goal };

const foodsReady = loadFoods().then((foods) => { addFoods(state.myFoods); return foods; }).catch(() => null);

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

  $("log").replaceChildren(...entries.slice().reverse().map(renderEntry));
  $("log-empty").hidden = entries.length > 0;
  $("log-tip").hidden = entries.length === 0;

  renderMacros(entries);
  renderSuggestion(entries, remaining);
  renderStreak(eaten);
}

// ---- Recommendation ----

// "Recommend: chicken breast and rice (~450 cal, 45 g protein): 70 g protein
// to go." Tapping it puts the food in the box, ready to Subtract.
function renderSuggestion(entries, remaining) {
  const eaten = sumMacros(entries) ?? { protein: 0, carbs: 0, fat: 0 };
  const { text, query } = recommend({
    remaining,
    hour: new Date().getHours(),
    eaten,
    proteinGoal: proteinTarget(state.profile),
    labels: entries.map((e) => e.label),
    aim: state.profile.aim,
    diet: state.profile.diet,
  });
  const label = document.createElement("b");
  label.textContent = "Recommend: ";
  $("suggest").replaceChildren(label, text.replace(/^Try /, ""));
  $("suggest").dataset.query = query ?? "";
  $("suggest").disabled = !query;
}

$("suggest").addEventListener("click", () => {
  const query = $("suggest").dataset.query;
  if (!query) return;
  $("search").value = query;
  $("search").focus();
  showEstimate();
});

// ---- Macros ----

// "Protein 85 / 100 g": red until the day's protein goal is reached, then green.
function renderMacros(entries) {
  const known = entries.filter((e) => e.macros);
  const target = proteinTarget(state.profile);
  $("macros").hidden = !known.length && !target;
  const sum = (key) => Math.round(known.reduce((total, e) => total + e.macros[key], 0));
  const protein = document.createElement("span");
  protein.textContent = target ? `Protein ${sum("protein")} / ${target} g` : `Protein ${sum("protein")} g`;
  if (target) protein.className = sum("protein") >= target ? "protein-met" : "protein-under";
  $("macros").replaceChildren(protein, ` · Carbs ${sum("carbs")} g · Fat ${sum("fat")} g`);
}

// Entries logged before macros were tracked: worked out again from the
// words typed, scaled to the calories logged.
async function fillInMacros() {
  if (!(await foodsReady)) return;
  let changed = false;
  for (const entry of todaysEntries()) {
    if (entry.macros !== undefined || !entry.typed || !entry.label) continue;
    const result = resolve(entry.label);
    const macros = result && sumMacros(result.items);
    entry.macros = macros && result.total ? scaleMacros(macros, entry.total / result.total) : null;
    changed = true;
  }
  if (changed) {
    save();
    render();
  }
}

// ---- Streak ----

function renderStreak(eaten) {
  const today = dayKey();
  // Today's summary follows today's log and goal; past days stay as they ended.
  const before = JSON.stringify(state.days[today] ?? null);
  if (eaten > 0) state.days[today] = { eaten, goal: state.goal };
  else delete state.days[today];
  showRecap(today);
  if (JSON.stringify(state.days[today] ?? null) !== before) save();

  const { current } = streak(state.days, today);
  $("streak").textContent = `🔥 ${current} ${current === 1 ? "day" : "days"} on track`;
}

// The first time the app opens on a new day: how the last day went.
function showRecap(today) {
  const last = state.lastDay;
  if (last === today) return;
  state.lastDay = today;
  save();
  if (!last) return;
  const r = recap(state.days, last);
  const when = last === previousDay(today) ? "Yesterday" : new Date(`${last}T12:00`).toLocaleDateString([], { weekday: "long" });
  const { current } = streak(state.days, today);
  let text;
  if (r.result === "under" && last !== previousDay(today)) text = "Welcome back! A day with nothing logged starts the count over today.";
  else if (r.result === "under") text = `${when} was on track ✓ 🔥 ${current} ${current === 1 ? "day" : "days"} in a row`;
  else if (r.result === "over") text = `${when} went over your goal, so the count starts over today.`;
  else if (Object.keys(state.days).length) text = `Nothing was logged ${when === "Yesterday" ? "yesterday" : `on ${when}`}, so the count starts over today.`;
  if (!text) return;
  $("recap-text").textContent = text;
  $("recap").classList.toggle("over", r.result !== "under");
  $("recap").hidden = false;
}

$("recap-close").addEventListener("click", () => { $("recap").hidden = true; });

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
  names.textContent = entry.label ?? entry.items.map((i) => i.name).join(", ");
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
  remove.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!confirm(`Remove ${entry.total} calories from today?`)) return;
    state.entries = state.entries.filter((e) => e.id !== entry.id);
    save();
    render();
  });

  li.addEventListener("click", () => editEntry(entry));
  li.append(thumb, desc, cal, remove);
  return li;
}

// Tapping an entry fixes its number, and the fix is remembered: typing the
// same words again uses it.
function editEntry(entry) {
  const answer = prompt(`Calories for "${entry.label ?? "this entry"}"`, entry.total);
  const total = Math.round(Number(answer));
  if (answer === null || answer.trim() === "" || !(total >= 0)) return;
  // The macros follow the new number.
  if (entry.macros) entry.macros = entry.total ? scaleMacros(entry.macros, total / entry.total) : null;
  entry.total = total;
  if (entry.typed) rememberCalories(entry.label, total);
  save();
  render();
}

// Protein, carbs and fat of some items, in grams, or null if none are known
// (typed numbers, photo estimates). A rough split, not label-exact.
function sumMacros(items) {
  const known = items.map((i) => i.macros).filter(Boolean);
  if (!known.length) return null;
  const sum = (key) => Math.round(known.reduce((total, m) => total + m[key], 0) * 10) / 10;
  return { protein: sum("protein"), carbs: sum("carbs"), fat: sum("fat") };
}

function scaleMacros(macros, factor) {
  return macros && { protein: macros.protein * factor, carbs: macros.carbs * factor, fat: macros.fat * factor };
}

function logEntry({ label, items, total, thumb, typed = false }) {
  const now = Date.now();
  state.entries.push({
    id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
    ts: now,
    day: dayKey(new Date(now)),
    label,
    typed,
    items: items.map(({ food, macros, ...rest }) => rest),
    total,
    macros: sumMacros(items),
    thumb,
  });
  save();
  render();
}

// Re-render exactly at the 3am reset, and whenever the app comes back to the
// foreground (timers don't run while a phone is asleep).
function scheduleReset() {
  setTimeout(() => { render(); scheduleReset(); }, nextReset() - Date.now() + 1000);
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) render(); });

// ---- Typing: one box, one button ----

// "sheetz special" → 300: used for exactly these words from now on, and found
// when typing similar words.
function rememberCalories(label, calories) {
  const food = [label, calories, [["1 serving (as you entered it)", 100]], 1, "", "mine"];
  const key = label.toLowerCase();
  state.myFoods = [food, ...state.myFoods.filter((f) => f[0].toLowerCase() !== key)];
  addFoods([food]);
}

async function showEstimate() {
  const query = $("search").value;
  if (!query.trim()) {
    $("estimate").textContent = "";
    return;
  }
  if (!(await foodsReady) || query !== $("search").value) return;
  const result = resolve(query, state.myFoods);
  $("estimate").textContent = result ? `${result.exact ? "" : "≈ "}${result.total.toLocaleString()} cal` : "";
}

$("search").addEventListener("input", showEstimate);

$("add-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = $("search").value.trim();
  if (!query) return;
  await foodsReady;
  let result = resolve(query, state.myFoods);
  if (!result) {
    // Nothing at all matched: the one question the app ever asks.
    const answer = prompt(`About how many calories in "${query}"?`);
    const calories = Math.round(Number(answer));
    if (answer === null || answer.trim() === "" || !(calories >= 0)) return;
    result = { label: query, items: [{ name: query, portion: "", calories }], total: calories, exact: true };
  }
  const named = result.label !== "Calories"; // a bare "300" has no words to remember
  if (result.exact && named) rememberCalories(result.label, result.total);
  logEntry({ ...result, typed: named });
  $("search").value = "";
  $("estimate").textContent = "";
  $("search").blur();
});

// ---- Barcode scanning ----

let stopScanner = null;
let scannedCode = null;

function setScanStatus(text, isError = false) {
  $("scan-status").textContent = text;
  $("scan-status").classList.toggle("error", isError);
}

function stopScanning() {
  stopScanner?.();
  stopScanner = null;
}

function logFood(food) {
  const item = planItem(applyModifiers(food, [], findFood), 1);
  logEntry({ label: food[0], items: [item], total: item.calories });
}

async function openScanner() {
  scannedCode = null;
  $("scan-online").hidden = true;
  $("scan-view").hidden = false;
  $("scanner").showModal();
  setScanStatus("Point the camera at the barcode.");
  try {
    stopScanner = await startScanner($("scan-video"), handleBarcode);
  } catch {
    $("scan-view").hidden = true;
    setScanStatus("Couldn't open the camera. Allow camera access for this site, or take a photo of the barcode instead.", true);
  }
}

async function handleBarcode(code) {
  stopScanning();
  scannedCode = code;
  if (navigator.vibrate) navigator.vibrate(60);
  await foodsReady;
  const food = findByBarcode(barcodeKeys(code));
  if (food) {
    $("scanner").close();
    logFood(food);
    return;
  }
  $("scan-view").hidden = true;
  setScanStatus(`Barcode ${code} isn't in the built-in list. You can look it up on Open Food Facts, a free food database. This sends only the barcode number.`);
  $("scan-online").hidden = false;
}

$("scan-btn").addEventListener("click", openScanner);

$("scan-photo").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  stopScanning();
  setScanStatus("Reading the barcode…");
  const code = await decodePhoto(file).catch(() => null);
  if (code) handleBarcode(code);
  else setScanStatus("Couldn't find a barcode in that photo. Try again with the barcode filling more of the picture.", true);
});

$("scan-online").addEventListener("click", async () => {
  const button = $("scan-online");
  button.disabled = true;
  setScanStatus("Looking it up…");
  try {
    const food = await lookupOnline(scannedCode);
    if (!food) {
      setScanStatus("Open Food Facts doesn't have this product. Close this and type it instead.", true);
      return;
    }
    // Keep it, so it's found offline next time.
    state.myFoods = [food, ...state.myFoods.filter((f) => f[0] !== food[0])];
    addFoods([food]);
    $("scanner").close();
    logFood(food);
  } catch {
    setScanStatus("Couldn't reach Open Food Facts. Check your connection, or close this and type it instead.", true);
  } finally {
    button.disabled = false;
  }
});

$("scan-close").addEventListener("click", () => $("scanner").close());
$("scanner").addEventListener("close", stopScanning);

// ---- Optional photo estimates ----

let pending = null; // { image: {mediaType, base64}, thumb } while a photo is waiting

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

function setStatus(text, isError = false) {
  $("status").textContent = text;
  $("status").classList.toggle("error", isError);
}

function closePhoto() {
  pending = null;
  $("review").hidden = true;
  $("preview").removeAttribute("src");
}

$("photo-btn").addEventListener("click", (event) => {
  if (state.apiKey) return; // the label opens the file picker
  event.preventDefault();
  alert("Photo estimates use your own Anthropic API key, which bills a few cents per photo. Add a key in Settings to use them. Typing what you ate is free.");
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
    $("review").hidden = false;
    $("review").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    alert(err.message);
  }
});

$("photo-cancel").addEventListener("click", closePhoto);

$("estimate-btn").addEventListener("click", async () => {
  const button = $("estimate-btn");
  button.disabled = true;
  setStatus("Looking at your photo… this can take a few seconds.");
  const photo = pending;
  try {
    const { estimateCalories } = await import("./estimate.js");
    const result = await estimateCalories({ apiKey: state.apiKey, image: photo.image, note: $("note").value.trim() });
    if (pending !== photo) return; // cancelled while waiting
    if (!result.items.length) {
      setStatus("No food or drink found in that photo. Type what you had instead.", true);
      return;
    }
    const total = result.items.reduce((sum, i) => sum + i.calories, 0);
    logEntry({ label: result.items.map((i) => i.name).join(", "), items: result.items, total, thumb: photo.thumb });
    closePhoto();
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (err) {
    setStatus(err.message || "Something went wrong. Please try again.", true);
  } finally {
    button.disabled = false;
  }
});

// ---- Settings ----

$("version").textContent = `Version ${VERSION}`;

for (const [value, { label }] of Object.entries(AIMS)) $("aim-input").add(new Option(label, value));

for (const [value, { label }] of Object.entries(DIETS)) $("diet-input").add(new Option(label, value));

// Aims from before gain / maintain / cut.
const OLD_AIMS = { muscle: "gain", general: "maintain", active: "maintain" };

// The profile as typed in Settings.
function profileFromForm() {
  const feet = Number($("feet-input").value);
  const inches = Number($("inches-input").value);
  return {
    sex: $("sex-input").value,
    age: Number($("age-input").value) || null,
    heightIn: feet || inches ? feet * 12 + inches : null,
    weightLb: Number($("weight-input").value) || null,
    aim: $("aim-input").value,
    diet: $("diet-input").value,
  };
}

function showGoals() {
  const profile = profileFromForm();
  const target = proteinTarget(profile);
  $("protein-goal").textContent = target ? `Daily protein goal: ${target} g` : "Add your weight to get a daily protein goal.";
  const calories = calorieSuggestion(profile);
  $("calorie-suggestion").hidden = !calories;
  if (!calories) return;
  const change = calories.goal - calories.maintenance;
  const how = change ? ` (maintenance ${calories.maintenance.toLocaleString()} ${change > 0 ? "+" : "−"} ${Math.abs(change)})` : "";
  $("calorie-text").textContent = `Suggested calorie goal: ${calories.goal.toLocaleString()}${how}.`;
  $("use-calories").hidden = Number($("goal-input").value) === calories.goal;
}

$("settings-form").addEventListener("input", showGoals);

$("use-calories").addEventListener("click", () => {
  const calories = calorieSuggestion(profileFromForm());
  if (calories) $("goal-input").value = calories.goal;
  showGoals();
});

function openSettings() {
  const p = state.profile;
  $("goal-input").value = state.goal;
  $("key-input").value = state.apiKey;
  $("sex-input").value = p.sex ?? "";
  $("age-input").value = p.age ?? "";
  $("feet-input").value = p.heightIn ? Math.floor(p.heightIn / 12) : "";
  $("inches-input").value = p.heightIn ? p.heightIn % 12 : "";
  $("weight-input").value = p.weightLb ?? "";
  $("aim-input").value = OLD_AIMS[p.aim] ?? p.aim ?? "maintain";
  if (!$("aim-input").value) $("aim-input").value = "maintain"; // an unknown aim selects nothing
  $("diet-input").value = DIETS[p.diet] ? p.diet : "standard";
  showGoals();
  $("settings").showModal();
}

$("open-settings").addEventListener("click", openSettings);

$("settings").addEventListener("close", () => {
  if ($("settings").returnValue !== "save") return;
  const goal = Math.round(Number($("goal-input").value));
  if (goal > 0) state.goal = goal;
  state.apiKey = $("key-input").value.trim();
  state.profile = profileFromForm();
  save();
  render();
});

// ---- Backup and restore ----
// A JSON file of everything except the API key, saved to the phone or handed
// to the share sheet (Google Drive, Docs, email...). Nothing is uploaded by
// the app itself.

const BACKUP_APP = "cookbot";

function backupFile() {
  const { apiKey, ...data } = state;
  const json = JSON.stringify({ app: BACKUP_APP, savedAt: new Date().toISOString(), data });
  return new File([json], `cookbot-backup-${dayKey()}.json`, { type: "application/json" });
}

const backupStatus = (text) => { $("backup-status").textContent = text; };

$("backup-btn").addEventListener("click", () => {
  save();
  $("backup-where").hidden = !$("backup-where").hidden;
  // Without a share sheet (most desktops), saving to the phone is the only choice.
  $("backup-share").hidden = !navigator.canShare?.({ files: [backupFile()] });
});

$("backup-phone").addEventListener("click", () => {
  const file = backupFile();
  const link = document.createElement("a");
  link.href = URL.createObjectURL(file);
  link.download = file.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 10000);
  $("backup-where").hidden = true;
  backupStatus(`Saved ${file.name} to your Downloads.`);
});

$("backup-share").addEventListener("click", async () => {
  const file = backupFile();
  try {
    await navigator.share({ files: [file], title: "CookBot backup" });
    $("backup-where").hidden = true;
    backupStatus(`Sent ${file.name}.`);
  } catch (error) {
    if (error.name !== "AbortError") backupStatus("Couldn't share the backup. Try Save to this phone.");
  }
});

$("restore-btn").addEventListener("click", () => $("restore-input").click());

$("restore-input").addEventListener("change", async () => {
  const file = $("restore-input").files[0];
  $("restore-input").value = "";
  if (!file) return;
  let backup;
  try {
    backup = JSON.parse(await file.text());
  } catch {}
  const data = backup?.app === BACKUP_APP ? backup.data : null;
  if (!data || typeof data.goal !== "number" || !Array.isArray(data.entries)) {
    backupStatus("That file isn't a CookBot backup.");
    return;
  }
  const when = new Date(backup.savedAt).toLocaleDateString();
  if (!confirm(`Replace everything on this phone with the backup from ${when}?`)) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...data, apiKey: state.apiKey }));
  location.reload();
});

// ---- Start ----

render();
scheduleReset();
fillInMacros();
if (isFirstRun) openSettings();

if ("serviceWorker" in navigator) {
  // updateViaCache: check sw.js itself for changes on every open, too.
  navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).catch(() => {});
}
