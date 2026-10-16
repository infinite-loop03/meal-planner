"use strict";

const MEALS = ["breakfast", "lunch", "dinner"];
const MEAL_LABEL = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner" };
const TYPE_LABEL = { dish: "dish", ingredient: "ingredient", tag: "tag" };
const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const state = {
  week: null,
  weekStart: null,
  todayDay: null,
  dishes: [],
  ingredients: [],
  rules: [],
  groceryRange: "tomorrow",
  grocery: null,
  bought: new Set(),
  pantryView: "stock",
  pantryQuery: "",
  dishQuery: "",
};

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const dishById = (id) => state.dishes.find((d) => d.id === id);
const dishesFor = (meal) => state.dishes.filter((d) => d.meal_types.includes(meal));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- api ----------
async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    let msg = `Something went wrong (${res.status})`;
    try {
      const j = await res.json();
      if (typeof j.detail === "string") msg = j.detail;
      else if (Array.isArray(j.detail) && j.detail[0]?.msg) msg = j.detail[0].msg;
    } catch {}
    throw new Error(msg);
  }
  return res.status === 204 ? null : res.json();
}

async function ensureDishes(force = false) {
  if (force || !state.dishes.length) state.dishes = await api("/api/dishes");
}
async function ensureIngredients(force = false) {
  if (force || !state.ingredients.length) state.ingredients = await api("/api/ingredients");
}

// ---------- dates ----------
const parseDate = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const toIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fmtDay = (s, opts) => parseDate(s).toLocaleDateString("en-IN", opts);
const shortDay = (s) => fmtDay(s, { weekday: "short" });
const addDays = (s, n) => { const d = parseDate(s); d.setDate(d.getDate() + n); return toIso(d); };

function weekLabel(start) {
  const a = parseDate(start), b = parseDate(addDays(start, 6));
  const left = a.toLocaleDateString("en-IN", a.getMonth() === b.getMonth() ? { day: "numeric" } : { day: "numeric", month: "short" });
  return `${left} – ${b.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`;
}
const slotLabel = (key) => { const [d, m] = key.split("|"); return `${shortDay(d)} ${m}`; };

// ---------- toast ----------
let toastTimer;
function toast(msg, isError = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.toggle("error", isError);
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}
async function run(fn, okMsg) {
  try {
    const r = await fn();
    if (okMsg) toast(okMsg);
    return r;
  } catch (e) {
    toast(e.message, true);
    throw e;
  }
}

// ---------- routing ----------
const TABS = ["plan", "grocery", "dishes", "pantry", "rules"];
function route() {
  const tab = TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "plan";
  $$(".view").forEach((v) => (v.hidden = v.id !== `view-${tab}`));
  $$(".tabs a").forEach((a) => (a.dataset.tab === tab ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  closeDrawer(false);
  ({ plan: () => loadWeek(state.weekStart), grocery: loadGrocery, dishes: loadDishes, pantry: loadPantry, rules: loadRules })[tab]();
}

// =====================================================================
// PLAN
// =====================================================================
async function loadWeek(start) {
  await ensureDishes();
  const week = await api(`/api/week${start ? `?start=${start}` : ""}`);
  await setWeek(week);
}

async function setWeek(week, { animate = false } = {}) {
  const prev = state.week;
  state.week = week;
  state.weekStart = week.start;
  const inWeek = week.days.find((d) => d.date === week.today);
  const prevToday = state.todayDay;
  state.todayDay = inWeek || state.todayDay || (await api(`/api/week?start=${week.today}`)).days.find((d) => d.date === week.today);
  renderToday();
  renderWeek();
  if (animate && !REDUCED) {
    rollChanged(prev);
    rollToday(prevToday);
  }
}

function findSlot(date, meal) {
  const day = state.week?.days.find((d) => d.date === date);
  return day ? day.meals[meal] : null;
}

// ---------- today ----------
function renderToday() {
  const el = $("#today");
  const day = state.todayDay;
  const today = state.week.today;
  const when = `<p class="when">${esc(fmtDay(today, { weekday: "long", day: "numeric", month: "long" }))}</p>`;
  if (!day || !MEALS.some((m) => day.meals[m].dish_id)) {
    el.innerHTML = `${when}<div class="empty"><p>Nothing on the menu for today yet.</p>
      <button class="primary" id="heroPlan">🎲 Plan this week</button></div>`;
    $("#heroPlan").onclick = () => { if (state.weekStart !== mondayOf(today)) loadWeek(today).then(generate); else generate(); };
    return;
  }
  el.innerHTML = `${when}<h2>Today's menu</h2><div class="menu">${MEALS.map((m) => {
    const s = day.meals[m];
    const sub = [];
    if (s.leftover) sub.push(`Leftovers from ${esc(slotLabel(s.leftover_from))}`);
    if (s.status === "cooked") sub.push("Cooked ✓");
    if (s.status === "skipped") sub.push("Skipped");
    if (s.staple_hints.length) sub.push(`Needs ${esc(s.staple_hints.join(", "))}`);
    const canAct = s.dish_id && s.status === "planned";
    return `<div class="course m-${m}${s.status !== "planned" ? " done" : ""}" data-meal="${m}">
      <button class="plate" data-open="${m}" aria-label="Open ${MEAL_LABEL[m]}">${esc(s.emoji || "🍽️")}</button>
      <div class="meal">${MEAL_LABEL[m]}</div>
      <button class="dish" data-open="${m}">${esc(s.dish_name || "Not planned")}</button>
      ${sub.length ? `<div class="sub">${sub.join(" · ")}</div>` : ""}
      ${canAct ? `<div class="quick">
        <button class="pill" data-cook="${m}">✓ Cooked</button>
        <button class="pill" data-shuffle="${m}">🎲 Another</button></div>` : ""}
    </div>`;
  }).join("")}</div>`;
  $$("[data-open]", el).forEach((b) => (b.onclick = () => openSlot(day.date, b.dataset.open)));
  $$("[data-cook]", el).forEach((b) => (b.onclick = () => openSlot(day.date, b.dataset.cook, "cooked")));
  $$("[data-shuffle]", el).forEach((b) => (b.onclick = () => regenerate(day.date, b.dataset.shuffle)));
}

function mondayOf(iso) {
  const d = parseDate(iso);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return toIso(d);
}

// ---------- week grid ----------
function renderWeek() {
  const w = state.week;
  $("#weekLabel").textContent = weekLabel(w.start);
  $("#thisWeek").hidden = w.start === mondayOf(w.today);
  let html = `<div class="corner" style="grid-column:1;grid-row:1"></div>`;
  MEALS.forEach((m, j) => (html += `<div class="rowhead m-${m}" style="grid-column:1;grid-row:${j + 2}">${MEAL_LABEL[m]}</div>`));
  w.days.forEach((day, i) => {
    const isToday = day.date === w.today;
    html += `<div class="colhead${isToday ? " is-today" : ""}" style="grid-column:${i + 2};grid-row:1">
      <strong>${esc(shortDay(day.date))}</strong>${esc(fmtDay(day.date, { day: "numeric", month: "short" }))}</div>`;
    MEALS.forEach((m, j) => (html += tileHtml(day.date, m, day.meals[m], isToday, i + 2, j + 2)));
  });
  const grid = $("#grid");
  grid.innerHTML = html;
  $$(".tile", grid).forEach(wireTile);
}

function tileHtml(date, meal, s, isToday, col, row) {
  const cls = ["tile", `m-${meal}`];
  if (isToday) cls.push("is-today");
  if (!s.dish_id) cls.push("is-empty");
  if (s.status === "cooked") cls.push("is-cooked");
  if (s.status === "skipped") cls.push("is-skipped");
  const tags = [];
  if (s.status === "cooked") tags.push(`<span class="tag done">✓ Cooked</span>`);
  if (s.status === "skipped") tags.push(`<span class="tag">Skipped</span>`);
  if (s.leftover) tags.push(`<span class="tag left">Leftovers</span>`);
  if (s.made_extra) tags.push(`<span class="tag left">Made extra</span>`);
  if (s.rule_notes.some((n) => n.effect === "prefer" && n.followed)) tags.push(`<span class="tag pair">🔗 Paired</span>`);
  if (s.flags.length || s.rule_notes.some((n) => !n.followed && n.effect === "avoid"))
    tags.push(`<span class="tag flag" title="${esc(s.flags.join("; "))}">Rule relaxed</span>`);
  const movable = s.dish_id && s.status === "planned" && !s.leftover;
  const actions = s.dish_id && s.status === "planned"
    ? `<span class="actions">
        <button data-act="shuffle" aria-label="Pick something else" title="Something else">🎲</button>
        <button data-act="cooked" aria-label="Mark cooked" title="Mark cooked">✓</button>
        <button data-act="skip" aria-label="Mark skipped" title="Skip">⏭</button></span>` : "";
  return `<div class="${cls.join(" ")}" role="button" tabindex="0" style="grid-column:${col};grid-row:${row}"
      data-date="${date}" data-slot="${meal}" ${movable ? 'draggable="true"' : ""}
      aria-label="${esc(`${shortDay(date)} ${MEAL_LABEL[meal]}: ${s.dish_name || "not planned"}`)}">
      <span class="emoji" aria-hidden="true">${esc(s.emoji || (s.dish_id ? "🍽️" : "➕"))}</span>
      <span class="name">${esc(s.dish_name || "Not planned")}</span>
      ${tags.length ? `<span class="meta">${tags.join("")}</span>` : ""}
      ${actions}
    </div>`;
}

let dragSrc = null;
function wireTile(t) {
  const { date, slot } = t.dataset;
  t.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "shuffle") return regenerate(date, slot);
    if (act === "cooked") return openSlot(date, slot, "cooked");
    if (act === "skip") return setStatus(date, slot, "skipped", "Skipped");
    openSlot(date, slot);
  });
  t.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target === t) { e.preventDefault(); openSlot(date, slot); }
  });
  t.addEventListener("dragstart", (e) => {
    dragSrc = { date, meal: slot };
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", `${date}|${slot}`);
    t.classList.add("dragging");
  });
  t.addEventListener("dragend", () => {
    dragSrc = null;
    $$(".tile.dragging, .tile.drop-ok").forEach((x) => x.classList.remove("dragging", "drop-ok"));
  });
  t.addEventListener("dragover", (e) => {
    if (!dragSrc || t.getAttribute("draggable") !== "true") return;
    if (dragSrc.date === date && dragSrc.meal === slot) return;
    e.preventDefault();
    t.classList.add("drop-ok");
  });
  t.addEventListener("dragleave", () => t.classList.remove("drop-ok"));
  t.addEventListener("drop", async (e) => {
    e.preventDefault();
    t.classList.remove("drop-ok");
    if (!dragSrc) return;
    const a = dragSrc;
    dragSrc = null;
    const w = await run(() => api("/api/swap", { method: "POST", body: { a, b: { date, meal: slot } } }), "Swapped");
    await setWeek(w, { animate: true });
  });
}

// ---------- shuffle animation ----------
function rollTile(el, meal, finalName, finalEmoji, delay) {
  const nameEl = $(".name", el), emojiEl = $(".emoji", el);
  const pool = dishesFor(meal);
  if (!pool.length || !nameEl) return;
  el.classList.add("rolling");
  const tick = setInterval(() => {
    const d = pool[Math.floor(Math.random() * pool.length)];
    nameEl.textContent = d.name;
    emojiEl.textContent = d.emoji || "🍽️";
  }, 70);
  setTimeout(() => {
    clearInterval(tick);
    nameEl.textContent = finalName;
    emojiEl.textContent = finalEmoji;
    el.classList.remove("rolling");
    el.classList.add("settle");
    el.addEventListener("animationend", () => el.classList.remove("settle"), { once: true });
  }, delay);
}

function rollChanged(prev) {
  const w = state.week;
  w.days.forEach((day, i) => MEALS.forEach((m, j) => {
    const before = prev?.days.find((d) => d.date === day.date)?.meals[m];
    const now = day.meals[m];
    if (!now.dish_id || before?.dish_id === now.dish_id) return;
    const el = $(`.tile[data-date="${day.date}"][data-slot="${m}"]`);
    if (el) rollTile(el, m, now.dish_name, now.emoji || "🍽️", 380 + i * 90 + j * 50);
  }));
}

function rollToday(prevDay) {
  const day = state.todayDay;
  if (!day) return;
  MEALS.forEach((m, j) => {
    const now = day.meals[m];
    if (!now.dish_id || prevDay?.meals[m]?.dish_id === now.dish_id) return;
    const plate = $(`#today .course[data-meal="${m}"] .plate`);
    const name = $(`#today .course[data-meal="${m}"] .dish`);
    if (!plate || !name) return;
    const pool = dishesFor(m);
    plate.classList.add("rolling");
    const tick = setInterval(() => {
      const d = pool[Math.floor(Math.random() * pool.length)];
      plate.textContent = d.emoji || "🍽️";
      name.textContent = d.name;
    }, 80);
    setTimeout(() => {
      clearInterval(tick);
      plate.classList.remove("rolling");
      plate.textContent = now.emoji || "🍽️";
      name.textContent = now.dish_name;
    }, 650 + j * 220);
  });
}

// ---------- plan actions ----------
async function generate() {
  const btn = $("#generate");
  btn.disabled = true;
  try {
    const w = await run(() => api("/api/week/generate", { method: "POST", body: { start: state.weekStart } }));
    await setWeek(w, { animate: true });
    if (!REDUCED) await sleep(900);
    toast("Week planned");
  } finally {
    btn.disabled = false;
  }
}

async function regenerate(date, meal) {
  const w = await run(() => api(`/api/slot/${date}/${meal}/regenerate`, { method: "POST" }));
  await setWeek(w, { animate: true });
  return w;
}

async function setStatus(date, meal, status, msg) {
  const w = await run(() => api(`/api/slot/${date}/${meal}/status`, { method: "PUT", body: { status } }), msg);
  await setWeek(w);
}

// =====================================================================
// DRAWER
// =====================================================================
let lastFocus = null;
function openDrawer(html, mealClass = "") {
  const d = $("#drawer");
  if (!d.classList.contains("open")) lastFocus = document.activeElement;
  d.className = `drawer ${mealClass}`;
  $("#drawerBody").innerHTML = html;
  $("#scrim").hidden = false;
  d.setAttribute("aria-hidden", "false");
  requestAnimationFrame(() => d.classList.add("open"));
  d.focus();
}
function closeDrawer(restoreFocus = true) {
  const d = $("#drawer");
  if (!d.classList.contains("open")) return;
  d.classList.remove("open");
  d.setAttribute("aria-hidden", "true");
  $("#scrim").hidden = true;
  if (restoreFocus && lastFocus?.isConnected) lastFocus.focus();
}

const ingredientMeta = (name) => state.ingredients.find((i) => i.name === name);

async function openSlot(date, meal, mode = "view") {
  if (!findSlot(date, meal)) await setWeek(await api(`/api/week?start=${date}`));
  await ensureIngredients(true);
  renderSlot(date, meal, mode);
}

function slotHead(date, meal, s) {
  const when = `${fmtDay(date, { weekday: "long", day: "numeric", month: "short" })} · ${MEAL_LABEL[meal]}`;
  return `<div class="slothead"><div class="bigemoji" aria-hidden="true">${esc(s.emoji || "🍽️")}</div>
    <div><div class="slotwhen">${esc(when)}</div><h3>${esc(s.dish_name || "Not planned")}</h3></div></div>`;
}

function renderSlot(date, meal, mode = "view") {
  const s = findSlot(date, meal);
  const dish = dishById(s.dish_id);

  if (mode === "cooked") {
    const items = (dish?.ingredients || []).filter((n) => !ingredientMeta(n)?.staple);
    openDrawer(`${slotHead(date, meal, s)}
      <p class="current" style="margin-top:18px">Anything finished? Ticked items move to "Ran out" in your pantry.</p>
      <form id="cookedForm">
        ${items.map((n) => `<label class="check"><input type="checkbox" name="finished" value="${esc(n)}"><span>${esc(n)}</span></label>`).join("") || `<p class="current">This dish has no tracked ingredients.</p>`}
        <div class="formactions">
          <button class="primary" type="submit">✓ Save as cooked</button>
          <button class="secondary" type="button" id="cancelCooked">Back</button>
        </div>
      </form>`, `m-${meal}`);
    $("#cancelCooked").onclick = () => renderSlot(date, meal);
    $("#cookedForm").onsubmit = async (e) => {
      e.preventDefault();
      const finished = $$("input:checked", e.target).map((i) => i.value);
      const w = await run(() => api(`/api/slot/${date}/${meal}/status`, { method: "PUT", body: { status: "cooked", finished } }), "Saved as cooked");
      await setWeek(w);
      await ensureIngredients(true);
      renderSlot(date, meal);
    };
    return;
  }

  const chips = (dish?.ingredients || []).map((n) => {
    const meta = ingredientMeta(n);
    const cls = meta?.staple ? "chip staple" : meta && !meta.in_stock ? "chip out" : "chip";
    return `<span class="${cls}">${esc(n)}</span>`;
  }).join("");
  const status = { cooked: "Cooked", skipped: "Skipped", planned: "Planned" }[s.status];

  const notes = s.rule_notes.map((n) => `<li>🔗 ${esc(n.text)} — ${n.followed ? `<span class="ok">followed</span>` : `<span class="miss">not followed</span>`}</li>`).join("");

  openDrawer(`${slotHead(date, meal, s)}
    ${s.leftover ? `<p class="current" style="margin-top:14px">Leftovers from ${esc(slotLabel(s.leftover_from))}. Pick a dish below to cook something fresh instead.</p>` : ""}
    ${s.flags.length ? `<ul class="callout flags">${s.flags.map((f) => `<li>⚠ ${esc(f)}</li>`).join("")}</ul>` : ""}
    ${notes ? `<ul class="callout rules">${notes}</ul>` : ""}

    ${dish ? `<h4>Ingredients</h4><div class="chips">${chips}</div>
      <p class="legend">Red outline: ran out. Light outline: on your daily order.</p>` : ""}

    <h4>${s.dish_id ? "Change dish" : "Pick a dish"}</h4>
    <div class="picker">
      <div class="row">
        <input type="search" id="optSearch" placeholder="Search ${MEAL_LABEL[meal].toLowerCase()} dishes" aria-label="Search dishes" style="flex:1">
        <button class="secondary" id="regen">🎲 Surprise me</button>
      </div>
      <div class="options" id="options"><p class="current">Loading…</p></div>
    </div>

    ${s.dish_id && !s.leftover ? `<h4>Leftovers</h4>
      <label class="check"><input type="checkbox" id="extra"${s.made_extra ? " checked" : ""}>
        <span>Made extra<small>The next meal becomes leftovers of this dish.</small></span></label>` : ""}

    ${s.dish_id ? `<h4>Status</h4>
      <p class="current">Now: ${status}</p>
      <div class="statusrow">
        ${s.status !== "cooked" ? `<button class="primary" id="markCooked">✓ Mark cooked</button>` : ""}
        ${s.status !== "skipped" ? `<button class="secondary" id="markSkipped">⏭ Mark skipped</button>` : ""}
        ${s.status !== "planned" ? `<button class="secondary" id="markPlanned">Back to planned</button>` : ""}
      </div>` : ""}
  `, `m-${meal}`);

  const after = async (p, msg) => {
    const w = await run(p, msg);
    await setWeek(w, { animate: true });
    renderSlot(date, meal);
  };
  loadOptions(date, meal, s.dish_id, (id) => after(() => api(`/api/slot/${date}/${meal}/dish`, { method: "PUT", body: { dish_id: id } }), "Dish changed"));
  $("#regen").onclick = () => after(() => api(`/api/slot/${date}/${meal}/regenerate`, { method: "POST" }));
  const ex = $("#extra");
  if (ex) ex.onchange = () => after(() => api(`/api/slot/${date}/${meal}/extra`, { method: "PUT", body: { made_extra: ex.checked } }),
    ex.checked ? "Next meal set to leftovers" : "Next meal planned fresh");
  const mc = $("#markCooked"); if (mc) mc.onclick = () => renderSlot(date, meal, "cooked");
  const ms = $("#markSkipped"); if (ms) ms.onclick = () => after(() => api(`/api/slot/${date}/${meal}/status`, { method: "PUT", body: { status: "skipped" } }), "Marked skipped");
  const mp = $("#markPlanned"); if (mp) mp.onclick = () => after(() => api(`/api/slot/${date}/${meal}/status`, { method: "PUT", body: { status: "planned" } }), "Back to planned");
}

async function loadOptions(date, meal, currentId, onPick) {
  let opts;
  try { opts = await api(`/api/slot/${date}/${meal}/options`); } catch (e) { $("#options").innerHTML = `<p class="current">${esc(e.message)}</p>`; return; }
  const box = $("#options");
  if (!box) return;
  const render = (q) => {
    const list = opts.filter((o) => o.name.toLowerCase().includes(q.toLowerCase()));
    box.innerHTML = list.map((o) => {
      const badge = o.rule === "prefer" ? `<span class="obadge prefer">🔗 Suggested</span>`
        : o.rule === "avoid" ? `<span class="obadge avoid">Rule says avoid</span>`
        : o.violations.length ? "" : `<span class="obadge fits">Fits</span>`;
      return `<button class="option${o.id === currentId ? " current" : ""}" data-id="${esc(o.id)}">
        <span class="oemoji" aria-hidden="true">${esc(o.emoji || "🍽️")}</span>
        <span><span class="oname">${esc(o.name)}</span>${o.violations.length ? `<span class="oreason">${esc(o.violations[0])}</span>` : ""}</span>
        ${badge}</button>`;
    }).join("") || `<p class="current">No dishes match.</p>`;
    $$(".option", box).forEach((b) => (b.onclick = () => { if (b.dataset.id !== currentId) onPick(b.dataset.id); }));
  };
  render("");
  $("#optSearch").oninput = (e) => render(e.target.value);
}

// =====================================================================
// GROCERY
// =====================================================================
async function loadGrocery() {
  await ensureDishes();
  const g = await api(`/api/grocery?range=${state.groceryRange}`);
  state.grocery = g;
  state.bought = new Set();
  renderGrocery();
}

function forText(list) {
  return esc([...new Set(list.map((f) => `${f.dish} (${shortDay(f.date)} ${f.meal})`))].join(", "));
}

function renderGrocery() {
  const g = state.grocery;
  const first = g.dates[0], last = g.dates[g.dates.length - 1];
  $("#groceryNote").textContent = g.dates.length === 1
    ? `What to order for ${fmtDay(first, { weekday: "long", day: "numeric", month: "short" })}. Tick items as they arrive.`
    : `What to order for ${fmtDay(first, { day: "numeric", month: "short" })} to ${fmtDay(last, { day: "numeric", month: "short" })}. Tick items as they arrive.`;
  let html = "";
  if (!g.items.length) {
    html += `<div class="emptystate"><div class="big">🧺</div><h2>Nothing to order</h2>
      <p>Everything these meals need is at home, or nothing is planned yet. Plan the week from the Plan tab.</p></div>`;
  } else {
    html += `<div class="gcard"><ul class="glist">${g.items.map((i) => {
      const b = state.bought.has(i.name);
      return `<li><label class="gitem${b ? " bought" : ""}"><input type="checkbox" data-name="${esc(i.name)}"${b ? " checked" : ""}>
        <span><span class="gname">${esc(i.name)}</span><span class="gfor">${forText(i.for)}</span></span></label></li>`;
    }).join("")}</ul></div>`;
  }
  if (g.staple_hints.length) {
    html += `<h2 class="gsection">From your daily order</h2><p class="note">Staples aren't on the list. Make sure there's enough for these meals.</p>
      <div class="staplelist">${g.staple_hints.map((i) => `<div class="staple-card"><strong>${esc(i.name)}</strong><span>${forText(i.for)}</span></div>`).join("")}</div>`;
  }
  $("#groceryBody").innerHTML = html;
  $$("#groceryBody input[type=checkbox]").forEach((cb) => (cb.onchange = async () => {
    const name = cb.dataset.name;
    try {
      await api(`/api/ingredients/${encodeURIComponent(name)}`, { method: "PUT", body: { in_stock: cb.checked } });
    } catch (e) { cb.checked = !cb.checked; return toast(e.message, true); }
    cb.checked ? state.bought.add(name) : state.bought.delete(name);
    cb.closest(".gitem").classList.toggle("bought", cb.checked);
    toast(cb.checked ? `${name} is now at home` : `${name} back on the list`);
  }));
}

async function copyList() {
  const g = state.grocery;
  if (!g) return;
  const left = g.items.filter((i) => !state.bought.has(i.name)).map((i) => `• ${i.name}`);
  if (!left.length) return toast("Nothing left to order");
  const title = g.dates.length === 1 ? `Groceries for ${fmtDay(g.dates[0], { weekday: "short", day: "numeric", month: "short" })}` : "Groceries for the week";
  const text = `${title}\n${left.join("\n")}`;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text; document.body.append(ta); ta.select(); document.execCommand("copy"); ta.remove();
  }
  toast(`Copied ${left.length} item${left.length > 1 ? "s" : ""}`);
}

// =====================================================================
// DISHES
// =====================================================================
async function loadDishes() {
  await ensureDishes(true);
  renderDishes();
}

function renderDishes() {
  const q = state.dishQuery.trim().toLowerCase();
  const hit = (d) => !q || d.name.toLowerCase().includes(q) || d.ingredients.some((i) => i.includes(q)) || (d.tags || []).some((t) => t.includes(q));
  $("#dishCols").innerHTML = MEALS.map((m) => {
    const list = dishesFor(m).filter(hit).sort((a, b) => a.name.localeCompare(b.name));
    return `<div class="dishcol m-${m}">
      <h2>${MEAL_LABEL[m]} <span>${list.length}</span></h2>
      <ul>${list.map((d) => `<li><button class="dishcard" data-id="${esc(d.id)}">
        <span class="demoji" aria-hidden="true">${esc(d.emoji || "🍽️")}</span>
        <span><span class="dname">${esc(d.name)}</span>
          <span class="dings">${esc(d.ingredients.join(", ") || "No ingredients yet")}</span>
          ${(d.tags || []).length ? `<span class="dtags">${d.tags.map((t) => `<span class="tag">#${esc(t)}</span>`).join("")}</span>` : ""}
        </span></button></li>`).join("") || `<li class="current">No dishes match.</li>`}</ul>
    </div>`;
  }).join("");
  $$("#dishCols .dishcard").forEach((b) => (b.onclick = () => dishForm(dishById(b.dataset.id))));
}

function dishForm(dish) {
  const isNew = !dish;
  const d = dish || { name: "", emoji: "", meal_types: [], ingredients: [], tags: [] };
  openDrawer(`
    <h3>${isNew ? "Add dish" : "Edit dish"}</h3>
    <form id="dishForm">
      <div class="field"><span class="label">Name</span>
        <div class="emojirow">
          <input type="text" id="dEmoji" value="${esc(d.emoji)}" placeholder="🍽️" aria-label="Emoji" maxlength="8">
          <input type="text" id="dName" required value="${esc(d.name)}" aria-label="Dish name" placeholder="e.g. Thepla">
        </div>
        <div class="hint">Pick any emoji for the dish (on Mac press Ctrl + Cmd + Space).</div>
      </div>
      <div class="field"><span class="label">Meal</span>
        ${MEALS.map((m) => `<label class="check"><input type="checkbox" name="meal" value="${m}"${d.meal_types.includes(m) ? " checked" : ""}><span>${MEAL_LABEL[m]}</span></label>`).join("")}
      </div>
      <div class="field"><label for="dIngs">Ingredients</label>
        <textarea id="dIngs">${esc(d.ingredients.join(", "))}</textarea>
        <div class="hint">Separate with commas. New ingredients start as non-perishable; change that in Pantry → Settings.</div>
      </div>
      <div class="field"><label for="dTags">Tags</label>
        <input type="text" id="dTags" value="${esc((d.tags || []).join(", "))}" placeholder="e.g. dal, light, rice">
        <div class="hint">Optional. Use tags in Rules, e.g. "when lunch is tagged dal".</div>
      </div>
      <div class="formactions">
        <button class="primary" type="submit">${isNew ? "Add dish" : "Save changes"}</button>
        ${isNew ? "" : `<button class="secondary danger" type="button" id="delDish">Delete dish</button>`}
      </div>
    </form>`);
  $("#dishForm").onsubmit = async (e) => {
    e.preventDefault();
    const meal_types = $$("input[name=meal]:checked", e.target).map((i) => i.value);
    if (!meal_types.length) return toast("Pick at least one meal", true);
    const body = {
      name: $("#dName").value.trim(),
      emoji: $("#dEmoji").value.trim(),
      meal_types,
      ingredients: $("#dIngs").value.split(","),
      tags: $("#dTags").value.split(","),
    };
    if (isNew) await run(() => api("/api/dishes", { method: "POST", body }), "Dish added");
    else await run(() => api(`/api/dishes/${dish.id}`, { method: "PUT", body }), "Changes saved");
    state.ingredients = [];
    closeDrawer();
    loadDishes();
  };
  const del = $("#delDish");
  if (del) {
    let armed = false;
    del.onclick = async () => {
      if (!armed) { armed = true; del.textContent = "Click again to delete"; return; }
      await run(() => api(`/api/dishes/${dish.id}`, { method: "DELETE" }), "Dish deleted");
      closeDrawer();
      loadDishes();
    };
  }
}

// =====================================================================
// PANTRY
// =====================================================================
async function loadPantry() {
  await ensureIngredients(true);
  renderPantry();
}

function renderPantry() {
  $("#pantryStock").hidden = state.pantryView !== "stock";
  $("#pantrySettings").hidden = state.pantryView !== "settings";
  $("#pantryNote").textContent = state.pantryView === "stock"
    ? 'Tap an item to move it between "Ran out" and "At home".'
    : "Perishables are kept apart on back-to-back days. Staples never go on the grocery list.";
  const q = state.pantryQuery.trim().toLowerCase();
  const list = state.ingredients.filter((i) => !q || i.name.includes(q));
  if (state.pantryView === "stock") renderStock(list);
  else renderSettings(list);
}

function renderStock(list) {
  const chip = (i) => `<button class="pchip ${i.in_stock ? "in" : "out"}" data-name="${esc(i.name)}"
      aria-pressed="${i.in_stock}" title="${i.perishable ? `Perishable · ${i.shelf_life_days} days` : ""}">
      ${i.perishable ? `<span class="dot" aria-hidden="true"></span>` : ""}${esc(i.name)}</button>`;
  const out = list.filter((i) => !i.in_stock && !i.staple);
  const home = list.filter((i) => i.in_stock && !i.staple);
  const staples = list.filter((i) => i.staple);
  $("#pantryStock").innerHTML = `<div class="pgroups">
    <div class="pgroup"><h2>🫙 Ran out <span>${out.length}</span></h2><div class="pchips">${out.map(chip).join("") || `<p class="current">Nothing has run out.</p>`}</div></div>
    <div class="pgroup"><h2>🏠 At home <span>${home.length}</span></h2><div class="pchips">${home.map(chip).join("") || `<p class="current">Tap items on the left that you have at home.</p>`}</div></div>
  </div>
  <p class="plegend"><span class="dot"></span>Perishable${staples.length ? ` · On your daily order: ${esc(staples.map((s) => s.name).join(", "))}` : ""}</p>`;
  $$("#pantryStock .pchip").forEach((b) => (b.onclick = async () => {
    const i = state.ingredients.find((x) => x.name === b.dataset.name);
    const next = !i.in_stock;
    await run(() => api(`/api/ingredients/${encodeURIComponent(i.name)}`, { method: "PUT", body: { in_stock: next } }));
    i.in_stock = next;
    renderPantry();
    const moved = $(`#pantryStock .pchip[data-name="${CSS.escape(i.name)}"]`);
    if (moved) { moved.classList.add("pop"); moved.focus(); }
  }));
}

function renderSettings(list) {
  const sw = (name, field, on, label) =>
    `<label class="switch"><input type="checkbox" data-name="${esc(name)}" data-field="${field}"${on ? " checked" : ""} aria-label="${esc(label)}"><span></span></label>`;
  $("#pantryBody").innerHTML = list.length ? list.map((i) => `<tr>
      <td>${esc(i.name)}<small>${i.used_in ? `In ${i.used_in} dish${i.used_in > 1 ? "es" : ""}` : "Not used in any dish"}</small></td>
      <td>${sw(i.name, "perishable", i.perishable, `${i.name} perishable`)}</td>
      <td>${i.perishable ? `<input type="number" min="1" max="365" value="${i.shelf_life_days}" data-name="${esc(i.name)}" data-field="shelf_life_days" aria-label="${esc(i.name)} shelf life in days"><span class="days">days</span>` : `<span class="days">—</span>`}</td>
      <td>${sw(i.name, "staple", i.staple, `${i.name} is a staple`)}</td>
    </tr>`).join("") : `<tr><td colspan="4" class="current">No ingredients match.</td></tr>`;
}

async function updateIngredient(name, field, value) {
  await run(() => api(`/api/ingredients/${encodeURIComponent(name)}`, { method: "PUT", body: { [field]: value } }), "Saved");
  const i = state.ingredients.find((x) => x.name === name);
  if (i) i[field] = value;
  if (field === "perishable") renderPantry();
}

// =====================================================================
// RULES
// =====================================================================
async function loadRules() {
  await Promise.all([ensureDishes(true), ensureIngredients()]);
  state.rules = await api("/api/rules");
  renderRules();
}

function valueLabel(type, v) {
  if (type === "dish") { const d = dishById(v); return d ? `${d.emoji || ""} ${d.name}`.trim() : v; }
  return type === "tag" ? `#${v}` : v;
}

function valuesHtml(match) {
  const parts = match.values.map((v) => `<span class="valchip">${esc(valueLabel(match.type, v))}</span>`);
  if (parts.length <= 1) return parts.join("");
  return parts.slice(0, -1).join(", ") + " or " + parts[parts.length - 1];
}

function ruleSentence(r) {
  const w = r.when, t = r.then;
  const whenWhat = w.match.type === "dish" ? valuesHtml(w.match) : w.match.type === "ingredient" ? `anything with ${valuesHtml(w.match)}` : `anything tagged ${valuesHtml(w.match)}`;
  const thenWhat = t.match.type === "dish" ? valuesHtml(t.match) : t.match.type === "ingredient" ? `dishes with ${valuesHtml(t.match)}` : `dishes tagged ${valuesHtml(t.match)}`;
  const day = t.day_offset ? "the next day" : "the same day";
  return `When <span class="mealword m-${w.meal}">${MEAL_LABEL[w.meal].toLowerCase()}</span> is ${whenWhat},
    <span class="effect ${t.effect}">${t.effect}</span> ${thenWhat} for <span class="mealword m-${t.meal}">${MEAL_LABEL[t.meal].toLowerCase()}</span> ${day}.`;
}

function renderRules() {
  const box = $("#rulesList");
  if (!state.rules.length) {
    box.innerHTML = `<div class="emptystate"><div class="big">🔗</div><h2>No rules yet</h2>
      <p>Add one like "when lunch is tagged dal, prefer khichadi for dinner".</p></div>`;
    return;
  }
  box.innerHTML = state.rules.map((r) => `<div class="rule${r.enabled ? "" : " off"}">
      <div class="sentence">${ruleSentence(r)}</div>
      <div class="ractions">
        <label class="switch" title="${r.enabled ? "On" : "Off"}"><input type="checkbox" data-toggle="${esc(r.id)}"${r.enabled ? " checked" : ""} aria-label="Rule on"><span></span></label>
        <button class="secondary" data-edit="${esc(r.id)}">Edit</button>
      </div>
    </div>`).join("");
  $$("[data-toggle]", box).forEach((cb) => (cb.onchange = async () => {
    const r = state.rules.find((x) => x.id === cb.dataset.toggle);
    const body = { ...r, enabled: cb.checked };
    const saved = await run(() => api(`/api/rules/${r.id}`, { method: "PUT", body }), cb.checked ? "Rule on" : "Rule off");
    Object.assign(r, saved);
    renderRules();
  }));
  $$("[data-edit]", box).forEach((b) => (b.onclick = () => ruleForm(state.rules.find((x) => x.id === b.dataset.edit))));
}

function blankRule() {
  return {
    enabled: true,
    when: { meal: "lunch", match: { type: "tag", values: [] } },
    then: { meal: "dinner", day_offset: 0, effect: "prefer", match: { type: "dish", values: [] } },
  };
}

function suggestionsFor(type, meal) {
  if (type === "dish") return dishesFor(meal).map((d) => ({ value: d.id, label: `${d.emoji || ""} ${d.name}`.trim() }));
  if (type === "ingredient") return state.ingredients.map((i) => ({ value: i.name, label: i.name }));
  const tags = [...new Set(state.dishes.flatMap((d) => d.tags || []))].sort();
  return tags.map((t) => ({ value: t, label: `#${t}` }));
}

function ruleForm(rule) {
  const isNew = !rule;
  const r = structuredClone(rule || blankRule());
  const mealOpts = (sel) => MEALS.map((m) => `<option value="${m}"${m === sel ? " selected" : ""}>${MEAL_LABEL[m]}</option>`).join("");
  const typeOpts = (sel) => Object.entries(TYPE_LABEL).map(([k, v]) => `<option value="${k}"${k === sel ? " selected" : ""}>${v}</option>`).join("");

  openDrawer(`
    <h3>${isNew ? "Add rule" : "Edit rule"}</h3>
    <form id="ruleForm" class="rbuilder" style="margin-top:18px">
      <div class="step">
        <span class="label">When</span>
        <div class="row">
          <select id="wMeal" aria-label="When meal">${mealOpts(r.when.meal)}</select>
          <span>has a</span>
          <select id="wType" aria-label="Match by">${typeOpts(r.when.match.type)}</select>
        </div>
        <div class="valuebox" id="wBox"></div>
        <div class="suggest" id="wSug"></div>
      </div>
      <div class="step">
        <span class="label">Then</span>
        <div class="row">
          <select id="tEffect" aria-label="Effect">
            <option value="prefer"${r.then.effect === "prefer" ? " selected" : ""}>Prefer</option>
            <option value="avoid"${r.then.effect === "avoid" ? " selected" : ""}>Avoid</option>
          </select>
          <span>for</span>
          <select id="tMeal" aria-label="Then meal">${mealOpts(r.then.meal)}</select>
          <select id="tDay" aria-label="Which day">
            <option value="0"${!r.then.day_offset ? " selected" : ""}>same day</option>
            <option value="1"${r.then.day_offset ? " selected" : ""}>next day</option>
          </select>
        </div>
        <div class="row" style="margin-top:8px"><span>a</span>
          <select id="tType" aria-label="Match by">${typeOpts(r.then.match.type)}</select></div>
        <div class="valuebox" id="tBox"></div>
        <div class="suggest" id="tSug"></div>
      </div>
      <div class="rpreview" id="rPreview"></div>
      <div class="formactions">
        <button class="primary" type="submit">${isNew ? "Add rule" : "Save changes"}</button>
        ${isNew ? "" : `<button class="secondary danger" type="button" id="delRule">Delete rule</button>`}
      </div>
    </form>`);

  const sides = {
    when: { box: $("#wBox"), sug: $("#wSug"), meal: () => r.when.meal, match: () => r.when.match },
    then: { box: $("#tBox"), sug: $("#tSug"), meal: () => r.then.meal, match: () => r.then.match },
  };

  const preview = () => {
    const ok = r.when.match.values.length && r.then.match.values.length;
    const order = r.then.day_offset === 0 && MEALS.indexOf(r.then.meal) <= MEALS.indexOf(r.when.meal);
    $("#rPreview").innerHTML = order
      ? `<span class="miss" style="color:var(--alert)">On the same day, the second meal has to come after the first. Pick a later meal or "next day".</span>`
      : ok ? ruleSentence(r) : `<span class="current">Add at least one value on each side to see the rule.</span>`;
  };

  const drawSide = (key) => {
    const s = sides[key];
    const match = s.match();
    const all = suggestionsFor(match.type, s.meal());
    s.box.innerHTML = match.values.map((v, idx) => `<span class="vchip">${esc(valueLabel(match.type, v))}<button type="button" data-rm="${idx}" aria-label="Remove">×</button></span>`).join("")
      + `<input type="text" placeholder="${match.type === "dish" ? "Type a dish" : match.type === "tag" ? "Type a tag" : "Type an ingredient"}" aria-label="Add value">`;
    const input = $("input", s.box);
    const drawSug = () => {
      const q = input.value.trim().toLowerCase();
      const avail = all.filter((o) => !match.values.includes(o.value) && (!q || o.label.toLowerCase().includes(q))).slice(0, q ? 14 : 8);
      s.sug.innerHTML = avail.map((o) => `<button type="button" data-add="${esc(o.value)}">+ ${esc(o.label)}</button>`).join("");
      $$("[data-add]", s.sug).forEach((b) => (b.onclick = () => { match.values.push(b.dataset.add); drawSide(key); preview(); $("input", s.box).focus(); }));
    };
    input.oninput = drawSug;
    input.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === ",") {
        e.preventDefault();
        const q = input.value.trim().toLowerCase().replace(/^#/, "");
        if (!q) return;
        let v = q;
        if (match.type === "dish") {
          const d = dishesFor(s.meal()).find((x) => x.name.toLowerCase() === q);
          if (!d) return toast("Pick a dish from the suggestions", true);
          v = d.id;
        }
        if (!match.values.includes(v)) match.values.push(v);
        drawSide(key); preview(); $("input", s.box).focus();
      } else if (e.key === "Backspace" && !input.value && match.values.length) {
        match.values.pop(); drawSide(key); preview(); $("input", s.box).focus();
      }
    };
    $$("[data-rm]", s.box).forEach((b) => (b.onclick = () => { match.values.splice(Number(b.dataset.rm), 1); drawSide(key); preview(); }));
    drawSug();
  };

  const retype = (match, type) => { if (match.type !== type) { match.type = type; match.values = []; } };
  $("#wMeal").onchange = (e) => { r.when.meal = e.target.value; drawSide("when"); preview(); };
  $("#wType").onchange = (e) => { retype(r.when.match, e.target.value); drawSide("when"); preview(); };
  $("#tMeal").onchange = (e) => { r.then.meal = e.target.value; drawSide("then"); preview(); };
  $("#tType").onchange = (e) => { retype(r.then.match, e.target.value); drawSide("then"); preview(); };
  $("#tEffect").onchange = (e) => { r.then.effect = e.target.value; preview(); };
  $("#tDay").onchange = (e) => { r.then.day_offset = Number(e.target.value); preview(); };
  drawSide("when"); drawSide("then"); preview();

  $("#ruleForm").onsubmit = async (e) => {
    e.preventDefault();
    const body = { enabled: r.enabled, when: r.when, then: r.then };
    if (isNew) await run(() => api("/api/rules", { method: "POST", body }), "Rule added");
    else await run(() => api(`/api/rules/${rule.id}`, { method: "PUT", body }), "Rule saved");
    closeDrawer();
    loadRules();
  };
  const del = $("#delRule");
  if (del) {
    let armed = false;
    del.onclick = async () => {
      if (!armed) { armed = true; del.textContent = "Click again to delete"; return; }
      await run(() => api(`/api/rules/${rule.id}`, { method: "DELETE" }), "Rule deleted");
      closeDrawer();
      loadRules();
    };
  }
}

// =====================================================================
// WIRING
// =====================================================================
function initSegmented(container, key, onChange) {
  $$("button", container).forEach((b) => b.addEventListener("click", () => {
    $$("button", container).forEach((x) => x.setAttribute("aria-checked", String(x === b)));
    onChange(b.dataset[key]);
  }));
}

document.addEventListener("DOMContentLoaded", () => {
  $("#prevWeek").onclick = () => loadWeek(addDays(state.weekStart, -7));
  $("#nextWeek").onclick = () => loadWeek(addDays(state.weekStart, 7));
  $("#thisWeek").onclick = () => loadWeek(null);
  $("#generate").onclick = generate;
  $("#addDish").onclick = () => dishForm(null);
  $("#addRule").onclick = () => ruleForm(null);
  $("#copyList").onclick = copyList;
  $("#closeDrawer").onclick = () => closeDrawer();
  $("#scrim").onclick = () => closeDrawer();
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });

  initSegmented($("#view-grocery .segmented"), "range", (r) => { state.groceryRange = r; loadGrocery(); });
  initSegmented($("#view-pantry .segmented"), "pview", (v) => { state.pantryView = v; renderPantry(); });
  $("#pantrySearch").addEventListener("input", (e) => { state.pantryQuery = e.target.value; renderPantry(); });
  $("#dishSearch").addEventListener("input", (e) => { state.dishQuery = e.target.value; renderDishes(); });
  $("#pantryBody").addEventListener("change", (e) => {
    const t = e.target;
    if (!t.dataset.field) return;
    if (t.dataset.field === "shelf_life_days") {
      const v = parseInt(t.value, 10);
      if (!(v >= 1 && v <= 365)) return toast("Shelf life must be 1 to 365 days", true);
      updateIngredient(t.dataset.name, "shelf_life_days", v);
    } else {
      updateIngredient(t.dataset.name, t.dataset.field, t.checked);
    }
  });

  // On the iPhone home-screen app there is no reload button, so refresh
  // whenever the app comes back to the foreground (e.g. after the Mac changed it).
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || $("#drawer").classList.contains("open")) return;
    const tab = TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "plan";
    if (tab === "plan") {
      const onThisWeek = state.week && state.weekStart === mondayOf(state.week.today);
      state.todayDay = null;
      loadWeek(onThisWeek ? null : state.weekStart);
    } else if (tab === "grocery") loadGrocery();
    else if (tab === "pantry") loadPantry();
  });

  window.addEventListener("hashchange", route);
  route();
});
