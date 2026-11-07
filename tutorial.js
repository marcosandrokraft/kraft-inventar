// Interaktive Einführung (Coach-Marks mit Spotlight) für den Übungsmodus. Ohne Bibliotheken.
//
// Aufbau:
// - Oben die reine Logik (Schritte, Zustand, Bedingungen) – ohne DOM, auch in Node importierbar.
//   Beim Import wird NICHT auf document/window/localStorage/sessionStorage zugegriffen.
// - Unten die Anzeige (Blase, Ring, Hinweis-Karte), erst beim Aufruf von startTutorial/resumeTutorial/
//   showFirstRunHint aktiv. tutorial.css wird dabei einmal per <link> nachgeladen.
//
// Die App navigiert mit vollen Seitenaufrufen. Der aktuelle Schritt liegt deshalb in sessionStorage
// ("vorrat-tutorial" = {"step": <index>, "v": 1}); resumeTutorial(ctx) setzt nach jedem Seitenaufbau fort.
//
// ctx = { view: "overview" | "container" | "list-ablauf" | "other" | "login", containerId, practice,
//         navigate(url), startPracticeTutorial(), endPractice() }
// App-Ereignisse: document "vorrat:action" mit detail { type, containerId, itemId, query }.

export const TUTORIAL_STORAGE_KEY = "vorrat-tutorial";
export const TUTORIAL_HINT_KEY = "vorrat-tutorial-hint-done";
export const TUTORIAL_VERSION = 1;

// Alle Ansichten mit Kopf und Leiste (also nicht die Anmeldeseite).
const APP_VIEWS = ["overview", "container", "list-ablauf", "other"];

const TO_OVERVIEW = { label: "Zur Übersicht", url: "index.html", hint: "Dieser Schritt beginnt in der Übersicht." };
const TO_FRIDGE = { label: "Zum Kühlschrank", url: "index.html?c=kuehlschrank", hint: "Dieser Schritt geht im Kühlschrank weiter." };

// Ein Schritt:
// - views / containerIds: wo der Schritt spielt (containerIds null = jeder Behälter)
// - targets: Ziele in Reihenfolge, das erste sichtbare gewinnt; optional mit eigenem Text
// - advance: { next: true } = nur über "Weiter"; { event: "<type>" } = App-Ereignis;
//   { view, containerId } = sobald diese Ansicht offen ist (nach Navigation)
// - nav: Knopf, wenn der Nutzer in einer anderen Ansicht ist
// - dialogText: Kurztext, solange ein Dialog der App offen ist
export const TUTORIAL_STEPS = [
  {
    id: "willkommen",
    title: "Willkommen im Übungsmodus",
    text: "Hier übst du mit Beispieldaten. Alles bleibt auf diesem Gerät – deine echten Daten bleiben unberührt. Oben kannst du die Übung jederzeit beenden.",
    views: APP_VIEWS,
    targets: [{ sel: "#mode-bar" }],
    advance: { next: true },
    nav: TO_OVERVIEW,
  },
  {
    id: "scannen",
    title: "Scannen",
    text: "Normalerweise scannst du den QR-Code am Behälter – die App öffnet ihn dann direkt. Zum Üben tippen wir uns hin.",
    views: APP_VIEWS,
    targets: [{ sel: "#scan-btn" }, { sel: '.bottom-nav [data-nav="scan"]' }],
    advance: { next: true },
    nav: TO_OVERVIEW,
  },
  {
    id: "behaelter",
    title: "Behälter öffnen",
    text: "Tippe auf «Küche».",
    views: ["overview"],
    targets: [{ sel: '#container-list a.card[data-cid="kueche"]' }],
    advance: { view: "container", containerId: "kueche" },
    nav: TO_OVERVIEW,
  },
  {
    id: "unterbehaelter",
    title: "Behälter in Behältern",
    text: "In der Küche steht der Kühlschrank. Öffne ihn.",
    views: ["container"],
    containerIds: ["kueche"],
    targets: [{ sel: '#children a.card[data-cid="kuehlschrank"]' }, { sel: "#children" }],
    advance: { view: "container", containerId: "kuehlschrank" },
    nav: { label: "Zur Küche", url: "index.html?c=kueche", hint: "Dieser Schritt spielt in der Küche." },
  },
  {
    id: "hinzufuegen",
    title: "Artikel hinzufügen",
    text: "Tippe z.B. «Käse» ein. Die App schlägt ein Icon vor – antippen, um es zu ändern. Dann «Hinzufügen».",
    views: ["container"],
    containerIds: null,
    targets: [{ sel: "#add-item-form" }],
    advance: { event: "item-added" },
    nav: TO_FRIDGE,
    dialogText: "Icon wählen – danach «Hinzufügen».",
  },
  {
    id: "menge",
    title: "Menge ändern",
    text: "Mit + und − änderst du die Menge. Die Zahl antippen, um sie direkt einzugeben.",
    views: ["container"],
    containerIds: null,
    targets: [{ sel: "#items > .card[data-id] .qty-controls" }, { sel: "#items .qty-controls" }],
    advance: { event: "qty-changed" },
    nav: TO_FRIDGE,
    dialogText: "Neue Menge eingeben und speichern.",
  },
  {
    id: "mhd",
    title: "Haltbar bis",
    text: "Tippe auf einen Namen und dann auf MHD – z.B. «+1 Woche». Dort kannst du auch verschieben, ein Icon wählen oder ein Foto machen.",
    views: ["container"],
    containerIds: null,
    targets: [{ sel: '#items > .card[data-id] [data-action="details"]' }, { sel: '#items [data-action="details"]' }],
    advance: { event: "mhd-saved" },
    nav: TO_FRIDGE,
    dialogText: "Tippe auf «MHD» und wähle z.B. «+1 Woche».",
  },
  {
    id: "loeschen",
    title: "Löschen",
    text: "Tippe zweimal auf den Papierkorb: Der erste Tipp fragt nach, der zweite löscht.",
    views: ["container"],
    containerIds: null,
    targets: [{ sel: '#items > .card[data-id] [data-action="del"]' }, { sel: '#items [data-action="del"]' }],
    advance: { event: "item-removed" },
    nav: TO_FRIDGE,
  },
  {
    id: "verschieben",
    title: "Verschieben und Fächer",
    text: "Mit «Auswählen» markierst du mehrere Artikel und verschiebst sie. Unten legst du mit «+ Behälter hier hineinlegen» Fächer oder Boxen an.",
    note: "Aus Versehen gelöscht? In der Meldung unten gibt es «Rückgängig».",
    views: ["container"],
    containerIds: null,
    targets: [{ sel: "#select-btn" }, { sel: ".sub-form" }],
    advance: { next: true, event: "move-done" },
    nav: TO_FRIDGE,
    dialogText: "Ziel wählen – die Artikel ziehen dorthin um.",
  },
  {
    id: "suche",
    title: "Wo ist …?",
    text: "Tippe «Hammer» ins Suchfeld – du siehst sofort, wo er liegt.",
    views: APP_VIEWS,
    targets: [
      { sel: "#search" },
      { sel: '.bottom-nav [data-nav="search"]', text: "Tippe auf «Suchen» und dann «Hammer» ein – du siehst sofort, wo er liegt." },
    ],
    advance: { event: "search", needsQuery: true },
    nav: { label: "Zur Suche", url: "index.html#suche", hint: "Die Suche findest du in der Übersicht." },
  },
  {
    id: "ablauf",
    title: "Läuft ab",
    text: "Tippe auf «Läuft ab» – dort siehst du, was bald abläuft.",
    views: ["overview", "container", "other"],
    targets: [{ sel: '.bottom-nav [data-nav="ablauf"]' }],
    advance: { view: "list-ablauf" },
    nav: TO_OVERVIEW,
  },
  {
    id: "ablauf-liste",
    title: "Bald fällig",
    text: "Zuoberst steht, was zuerst abläuft. Ocker heisst «bald», Rot heisst «abgelaufen».",
    views: ["list-ablauf"],
    targets: [],
    advance: { next: true },
    nav: { label: "Zu «Läuft ab»", url: "index.html?liste=ablauf", hint: "Dieser Schritt zeigt die Liste «Läuft ab»." },
  },
  {
    id: "qr",
    title: "QR-Codes drucken",
    text: "Drucke Codes für deine Behälter und klebe sie auf – dann genügt künftig ein Scan. Im Übungsmodus entstehen nur Übungs-Codes.",
    views: APP_VIEWS,
    targets: [{ sel: "#qr-header" }],
    advance: { next: true },
    nav: TO_OVERVIEW,
  },
];

export function stepIndexById(id) {
  return TUTORIAL_STEPS.findIndex((s) => s.id === id);
}

// Beliebiger Wert → gültiger Index (Müll → 0).
export function clampStep(i) {
  const n = typeof i === "number" ? i : Number(i);
  if (!Number.isFinite(n)) return 0;
  return Math.min(TUTORIAL_STEPS.length - 1, Math.max(0, Math.trunc(n)));
}

// JSON aus sessionStorage → { step, v } oder null (bei Müll, falscher Version, ungültigem Index).
export function parseTutorialState(raw) {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 200) return null;
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  if (data.v !== TUTORIAL_VERSION) return null;
  const step = data.step;
  if (!Number.isInteger(step) || step < 0 || step >= TUTORIAL_STEPS.length) return null;
  return { step, v: TUTORIAL_VERSION };
}

export function serializeTutorialState(state) {
  return JSON.stringify({ step: clampStep(state && state.step), v: TUTORIAL_VERSION });
}

// Passt der Schritt zur aktuellen Ansicht?
export function stepMatchesView(step, ctx) {
  if (!step || !ctx) return false;
  if (ctx.practice === false) return false;
  if (!step.views.includes(ctx.view)) return false;
  if (step.containerIds && ctx.view === "container" && !step.containerIds.includes(ctx.containerId)) return false;
  return true;
}

export function progressLabel(i) {
  return `${clampStep(i) + 1}/${TUTORIAL_STEPS.length}`;
}

// Ist eine Ansichts-Bedingung erfüllt (für Schritte, die nach einer Navigation weitergehen)?
function viewConditionMet(advance, view, containerId) {
  if (!advance || !advance.view) return false;
  if (advance.view !== view) return false;
  return !advance.containerId || advance.containerId === containerId;
}

// Erfüllt das Ereignis den Schritt?
// event = { type: "next" } (Knopf Weiter/Überspringen – geht immer),
//         { type: "view", view, containerId } (Seitenaufbau) oder
//         { type: "<App-Ereignis>", containerId, itemId, query } (aus "vorrat:action").
// Reine Klick-Schritte ({ next: true } ohne event) gehen nur über "next" weiter.
export function shouldAdvance(step, event) {
  if (!step || !event || typeof event.type !== "string") return false;
  const adv = step.advance || {};
  if (event.type === "next") return true;
  if (event.type === "view") return viewConditionMet(adv, event.view, event.containerId ?? null);
  if (!adv.event || adv.event !== event.type) return false;
  if (adv.needsQuery) return typeof event.query === "string" && event.query.trim().length > 0;
  return true;
}

// Ab Index i alle Schritte überspringen, deren Ansichts-Bedingung schon erfüllt ist (nach Navigation).
export function resolveStepForView(i, ctx) {
  let idx = clampStep(i);
  while (idx < TUTORIAL_STEPS.length - 1 && shouldAdvance(TUTORIAL_STEPS[idx], { type: "view", view: ctx.view, containerId: ctx.containerId })) {
    idx++;
  }
  return idx;
}

// ===================================================================================================
// Anzeige (nur im Browser)
// ===================================================================================================

const SEARCH_SETTLE_MS = 1500; // Suche erst weiter, wenn eine Weile nicht mehr getippt wird
const MISSING_NOTE_MS = 1200;  // so lange auf ein Ziel warten, bevor der Hinweis "nicht sichtbar" kommt
const MARGIN = 8;              // Abstand zum Bildschirmrand (360 px → Blase 344 px breit)
const GAP = 16;                // Abstand Blase ↔ Ziel
const RING_PAD = 6;

const X_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6 6 18"/></svg>';

let ui = null; // { ctx, index, finished, root, ring, bubble, live, ... } solange aktiv

function readSession() {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage.getItem(TUTORIAL_STORAGE_KEY);
  } catch {
    return null;
  }
}
function writeSession(index) {
  try {
    sessionStorage.setItem(TUTORIAL_STORAGE_KEY, serializeTutorialState({ step: index }));
  } catch { /* privater Modus o.ä. – Tutorial läuft trotzdem bis zur nächsten Navigation */ }
}
function clearSession() {
  try {
    sessionStorage.removeItem(TUTORIAL_STORAGE_KEY);
  } catch { /* egal */ }
}

let cssPromise = null;
function ensureCss() {
  if (cssPromise) return cssPromise;
  cssPromise = new Promise((resolve) => {
    const href = new URL("./tutorial.css", import.meta.url).href;
    const existing = document.querySelector("link[data-tutorial-css]");
    if (existing) return resolve();
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.dataset.tutorialCss = "";
    link.addEventListener("load", () => resolve(), { once: true });
    link.addEventListener("error", () => resolve(), { once: true });
    document.head.appendChild(link);
  });
  return cssPromise;
}

function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === "class") node.className = v;
    else node.setAttribute(k, v === true ? "" : v);
  }
  if (text != null) node.textContent = text;
  return node;
}

function isVisible(node) {
  if (!node || !node.isConnected) return false;
  if (node.closest("[hidden]")) return false;
  const r = node.getBoundingClientRect();
  return r.width > 0 || r.height > 0;
}

function findTarget(step) {
  for (const t of step.targets) {
    let node = null;
    try {
      node = document.querySelector(t.sel);
    } catch {
      node = null;
    }
    if (isVisible(node)) return { node, target: t };
  }
  return null;
}

function dialogOpen() {
  return !!document.querySelector(".photo-overlay");
}

function prefersReducedMotion() {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

// Unterer Rand für die Blase: Oberkante der Leiste unten (falls sichtbar), sonst Bildschirm minus Safe-Area.
function bottomLimit(vh) {
  const nav = document.querySelector(".bottom-nav");
  if (nav && isVisible(nav)) {
    const top = nav.getBoundingClientRect().top;
    if (top > vh * 0.5) return Math.min(vh, top) - MARGIN;
  }
  return vh - MARGIN - safeAreaBottom();
}

let safeProbe = null;
function safeAreaBottom() {
  if (!safeProbe) {
    safeProbe = el("div", { class: "tut-safe-probe", "aria-hidden": "true" });
    document.body.appendChild(safeProbe);
  }
  if (!safeProbe.isConnected) document.body.appendChild(safeProbe);
  return safeProbe.offsetHeight || 0;
}

function viewport() {
  const vv = window.visualViewport;
  const vw = document.documentElement.clientWidth || window.innerWidth;
  const vh = vv ? Math.min(window.innerHeight, vv.height) : window.innerHeight;
  return { vw, vh };
}

// --- Aufbau / Abbau --------------------------------------------------------------------------------

function mount(ctx, index) {
  unmount();
  ensureCss().then(() => {
    if (ui) {
      ui.cssReady = true;
      schedule();
    }
  });
  const root = el("div", { class: "tut-root", id: "tutorial-root" });
  const ring = el("div", { class: "tut-ring", "aria-hidden": "true", hidden: true });
  const bubble = el("div", {
    class: "tut-bubble",
    role: "dialog",
    "aria-modal": "false",
    "aria-labelledby": "tut-title",
    "aria-describedby": "tut-text",
    tabindex: "-1",
  });
  bubble.style.visibility = "hidden"; // bis tutorial.css geladen und die Position berechnet ist
  const live = el("div", { class: "tut-sr", "aria-live": "polite", role: "status" });
  root.append(ring, bubble, live);
  document.body.appendChild(root);

  ui = {
    ctx,
    index,
    finished: false,
    root,
    ring,
    bubble,
    live,
    cssReady: false,
    renderKey: "",
    announced: -1,
    focused: -1,
    scrolledFor: null,
    freeSince: 0,
    raf: 0,
    timers: new Set(),
    searchTimer: 0,
  };

  ui.onScroll = () => schedule();
  ui.onKey = (e) => {
    if (e.key !== "Escape" || !ui) return;
    if (dialogOpen()) return; // zuerst schliesst die App ihren Dialog
    e.preventDefault();
    stopTutorial();
  };
  ui.onAction = (e) => onAppAction(e && e.detail ? e.detail : {});
  ui.observer = new MutationObserver((records) => {
    if (!ui) return;
    if (records.some((r) => !ui.root.contains(r.target) && r.target !== safeProbe)) schedule();
  });
  ui.observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "class", "open"] });
  window.addEventListener("scroll", ui.onScroll, { passive: true, capture: true });
  window.addEventListener("resize", ui.onScroll, { passive: true });
  if (window.visualViewport) window.visualViewport.addEventListener("resize", ui.onScroll, { passive: true });
  document.addEventListener("keydown", ui.onKey, true);
  document.addEventListener("vorrat:action", ui.onAction);
  schedule();
}

function unmount() {
  if (!ui) return;
  const u = ui;
  ui = null;
  if (u.raf) cancelAnimationFrame(u.raf);
  for (const t of u.timers) clearTimeout(t);
  clearTimeout(u.searchTimer);
  u.observer.disconnect();
  window.removeEventListener("scroll", u.onScroll, { capture: true });
  window.removeEventListener("resize", u.onScroll);
  if (window.visualViewport) window.visualViewport.removeEventListener("resize", u.onScroll);
  document.removeEventListener("keydown", u.onKey, true);
  document.removeEventListener("vorrat:action", u.onAction);
  u.root.remove();
  if (safeProbe) {
    safeProbe.remove();
    safeProbe = null;
  }
}

function schedule() {
  if (!ui || ui.raf) return;
  ui.raf = requestAnimationFrame(() => {
    if (!ui) return;
    ui.raf = 0;
    layout();
  });
}

function later(fn, ms) {
  if (!ui) return;
  const t = setTimeout(() => {
    if (ui) ui.timers.delete(t);
    fn();
  }, ms);
  ui.timers.add(t);
}

// --- Navigation zwischen Schritten -----------------------------------------------------------------

function goTo(index) {
  if (!ui) return;
  ui.index = clampStep(index);
  ui.finished = false;
  ui.scrolledFor = null;
  clearTimeout(ui.searchTimer);
  writeSession(ui.index);
  schedule();
}

function next() {
  if (!ui) return;
  if (ui.index >= TUTORIAL_STEPS.length - 1) {
    clearSession(); // Abschluss ist nur noch eine Anzeige
    ui.finished = true;
    schedule();
    return;
  }
  goTo(ui.index + 1);
}

// Zurück: vorheriger Schritt; spielt er in einer anderen Ansicht, dorthin navigieren.
function back() {
  if (!ui || ui.index === 0) return;
  const prev = ui.index - 1;
  const step = TUTORIAL_STEPS[prev];
  if (!stepMatchesView(step, ui.ctx) && step.nav && typeof ui.ctx.navigate === "function") {
    writeSession(prev);
    ui.ctx.navigate(step.nav.url);
    return;
  }
  goTo(prev);
}

function onAppAction(detail) {
  if (!ui || ui.finished) return;
  const type = detail && detail.type;
  if (type === "dialog-open" || type === "dialog-close") {
    schedule();
    return;
  }
  const step = TUTORIAL_STEPS[ui.index];
  if (!stepMatchesView(step, ui.ctx)) return;
  if (!shouldAdvance(step, { ...detail, type })) {
    schedule();
    return;
  }
  if (type === "search") {
    // Erst weiter, wenn fertig getippt ist – sonst springt es schon beim "H".
    clearTimeout(ui.searchTimer);
    const idx = ui.index;
    ui.searchTimer = setTimeout(() => {
      if (ui && ui.index === idx && !ui.finished) next();
    }, SEARCH_SETTLE_MS);
    return;
  }
  next();
}

// --- Darstellung -----------------------------------------------------------------------------------

function button(label, cls, onClick, attrs = {}) {
  const b = el("button", { type: "button", class: cls, ...attrs }, label);
  b.addEventListener("click", onClick);
  return b;
}

function closeButton() {
  const b = el("button", { type: "button", class: "tut-close", "aria-label": "Einführung beenden" });
  b.innerHTML = X_ICON;
  b.addEventListener("click", () => stopTutorial());
  return b;
}

// Inhalt der Blase für den aktuellen Modus neu aufbauen.
function renderContent(mode, found, missingNote) {
  const { bubble } = ui;
  const step = TUTORIAL_STEPS[ui.index];
  bubble.replaceChildren();
  bubble.classList.toggle("tut-compact", mode === "compact");

  if (ui.finished) {
    const head = el("div", { class: "tut-head" });
    head.append(el("span", { class: "tut-progress" }, "Fertig"), closeButton());
    const title = el("h2", { class: "tut-title", id: "tut-title" }, "Geschafft");
    const text = el("p", { class: "tut-text", id: "tut-text" }, "Du kennst jetzt das Wichtigste. Übe ruhig weiter mit den Beispieldaten oder beende die Übung – deine echten Daten bleiben, wie sie waren.");
    const foot = el("div", { class: "tut-foot" });
    foot.append(
      el("span", { class: "tut-spacer" }),
      button("Weiter üben", "tut-btn tut-secondary", () => stopTutorial(), { "data-main": "" }),
      button("Übung beenden", "tut-btn tut-primary", () => {
        const ctx = ui && ui.ctx;
        stopTutorial();
        if (ctx && typeof ctx.endPractice === "function") ctx.endPractice();
      }),
    );
    bubble.append(head, title, text, foot);
    return;
  }

  const head = el("div", { class: "tut-head" });
  head.append(el("span", { class: "tut-progress", "aria-label": `Schritt ${progressLabel(ui.index)}` }, progressLabel(ui.index)), closeButton());

  if (mode === "compact") {
    const line = el("p", { class: "tut-text", id: "tut-text" }, step.dialogText || step.text);
    const title = el("span", { class: "tut-title", id: "tut-title" }, step.title);
    head.insertBefore(title, head.lastChild);
    bubble.append(head, line);
    return;
  }

  const title = el("h2", { class: "tut-title", id: "tut-title" }, step.title);
  let textValue = (found && found.target.text) || step.text;
  if (mode === "away") textValue = step.nav ? step.nav.hint : step.text;
  const text = el("p", { class: "tut-text", id: "tut-text" }, textValue);
  bubble.append(head, title, text);
  if (mode !== "away" && step.note) bubble.append(el("p", { class: "tut-note" }, step.note));
  if (mode === "free" && missingNote && step.targets.length) {
    bubble.append(el("p", { class: "tut-note" }, "Das gezeigte Element ist gerade nicht zu sehen – mit «Weiter» geht es trotzdem weiter."));
  }

  const foot = el("div", { class: "tut-foot" });
  if (ui.index > 0) foot.append(button("Zurück", "tut-btn tut-link", () => back()));
  foot.append(el("span", { class: "tut-spacer" }));
  const last = ui.index === TUTORIAL_STEPS.length - 1;
  const interactive = !step.advance.next;
  if (mode === "away") {
    foot.append(button("Überspringen", "tut-btn tut-link", () => next()));
    foot.append(button(step.nav.label, "tut-btn tut-primary", () => {
      if (ui && typeof ui.ctx.navigate === "function") ui.ctx.navigate(step.nav.url);
    }, { "data-main": "" }));
  } else if (interactive && !(mode === "free" && missingNote)) {
    foot.append(button("Überspringen", "tut-btn tut-link", () => next(), { "data-main": "" }));
  } else {
    foot.append(button(last ? "Fertig" : "Weiter", "tut-btn tut-primary", () => next(), { "data-main": "" }));
  }
  bubble.append(foot);
}

function announce() {
  if (ui.finished) {
    ui.live.textContent = "Einführung abgeschlossen.";
    return;
  }
  const step = TUTORIAL_STEPS[ui.index];
  ui.live.textContent = `Schritt ${progressLabel(ui.index)}: ${step.title}. ${step.text}`;
}

// Fokus auf die Blase – ausser jemand tippt gerade in ein Feld der Seite.
function focusBubble() {
  const a = document.activeElement;
  const typing = a && a !== document.body && !ui.root.contains(a) && (a.matches("input, textarea, select, [contenteditable]") || a.isContentEditable);
  if (typing || dialogOpen()) return;
  const main = ui.bubble.querySelector("[data-main]");
  try {
    (main || ui.bubble).focus({ preventScroll: true });
  } catch {
    (main || ui.bubble).focus();
  }
}

function layout() {
  if (!ui) return;
  const { ring, bubble } = ui;
  const step = TUTORIAL_STEPS[ui.index];

  let mode;
  let found = null;
  if (ui.finished) mode = "free";
  else if (!stepMatchesView(step, ui.ctx)) mode = "away";
  else if (dialogOpen()) mode = "compact";
  else {
    found = findTarget(step);
    mode = found ? "spot" : "free";
  }

  // Wartet ein Schritt auf sein Ziel (Liste lädt noch …), erst später den Hinweis zeigen.
  let missingNote = false;
  if (mode === "free" && !ui.finished && step.targets.length) {
    if (!ui.freeSince) {
      ui.freeSince = Date.now();
      later(schedule, MISSING_NOTE_MS + 50);
    }
    missingNote = Date.now() - ui.freeSince >= MISSING_NOTE_MS;
  } else {
    ui.freeSince = 0;
  }

  const key = `${ui.finished ? "fin" : ui.index}|${mode}|${missingNote}|${found ? found.target.sel : ""}`;
  if (key !== ui.renderKey) {
    ui.renderKey = key;
    renderContent(mode, found, missingNote);
  }
  const stepKey = ui.finished ? "fin" : ui.index;
  if (ui.announced !== stepKey) {
    ui.announced = stepKey;
    announce();
  }

  // Ziel einmal pro Schritt in die Mitte holen.
  if (mode === "spot" && ui.scrolledFor !== found.node) {
    ui.scrolledFor = found.node;
    const inNav = !!found.node.closest(".bottom-nav");
    if (!inNav) {
      try {
        found.node.scrollIntoView({ block: "center", inline: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
      } catch {
        found.node.scrollIntoView();
      }
    }
  }

  if (!ui.cssReady) return; // ohne CSS keine verlässlichen Masse

  const { vw, vh } = viewport();
  const width = Math.min(380, vw - 2 * MARGIN);
  bubble.style.width = `${width}px`;

  if (mode === "compact") {
    ring.hidden = true;
    bubble.style.left = `${Math.round((vw - width) / 2)}px`;
    bubble.style.top = "";
    bubble.style.bottom = "";
    bubble.classList.add("tut-at-top");
    bubble.style.visibility = "";
    finishFrame();
    return;
  }
  bubble.classList.remove("tut-at-top");

  const lower = bottomLimit(vh);
  const upper = MARGIN;
  const h = bubble.offsetHeight;

  if (mode !== "spot") {
    ring.hidden = true;
    bubble.style.left = `${Math.round((vw - width) / 2)}px`;
    bubble.style.top = `${Math.round(Math.max(upper, lower - h))}px`;
    bubble.style.visibility = "";
    finishFrame();
    return;
  }

  // Ring um das Ziel (auf den Bildschirm begrenzt)
  const r = found.node.getBoundingClientRect();
  const rl = Math.max(2, r.left - RING_PAD);
  const rt = Math.max(2, r.top - RING_PAD);
  const rr = Math.min(vw - 2, r.right + RING_PAD);
  const rb = Math.min(vh - 2, r.bottom + RING_PAD);
  const visible = rr > rl && rb > rt;
  ring.hidden = !visible;
  if (visible) {
    ring.style.left = `${Math.round(rl)}px`;
    ring.style.top = `${Math.round(rt)}px`;
    ring.style.width = `${Math.round(rr - rl)}px`;
    ring.style.height = `${Math.round(rb - rt)}px`;
  }

  // Blase unter oder über dem Ziel – dort, wo mehr Platz ist; nie ausserhalb des Bildschirms.
  const spaceBelow = lower - (r.bottom + GAP);
  const spaceAbove = (r.top - GAP) - upper;
  let top;
  if (spaceBelow >= h && (spaceBelow >= spaceAbove || spaceAbove < h)) top = r.bottom + GAP;
  else if (spaceAbove >= h) top = r.top - GAP - h;
  else top = spaceBelow >= spaceAbove ? lower - h : upper; // Ziel sehr gross: an den Rand mit mehr Platz
  top = Math.max(upper, Math.min(top, lower - h));
  const centerX = r.left + r.width / 2;
  const left = Math.max(MARGIN, Math.min(centerX - width / 2, vw - MARGIN - width));
  bubble.style.left = `${Math.round(left)}px`;
  bubble.style.top = `${Math.round(top)}px`;
  bubble.style.visibility = "";
  finishFrame();
}

function finishFrame() {
  const stepKey = ui.finished ? "fin" : ui.index;
  if (ui.focused !== stepKey) {
    ui.focused = stepKey;
    focusBubble();
  }
}

// --- Öffentliche Funktionen ------------------------------------------------------------------------

export function isTutorialActive() {
  if (ui) return true;
  return parseTutorialState(readSession()) !== null;
}

export function startTutorial(ctx) {
  if (typeof document === "undefined" || !ctx) return;
  removeHint();
  writeSession(0);
  mount(ctx, 0);
}

export function resumeTutorial(ctx) {
  if (typeof document === "undefined" || !ctx) return;
  const state = parseTutorialState(readSession());
  if (!state) return;
  if (ctx.practice === false || ctx.view === "login") return;
  const index = resolveStepForView(state.step, ctx);
  if (index !== state.step) writeSession(index);
  mount(ctx, index);
}

export function stopTutorial() {
  clearSession();
  unmount();
}

// --- Hinweis für neue Geräte -----------------------------------------------------------------------

function hintDone() {
  try {
    return localStorage.getItem(TUTORIAL_HINT_KEY) === "1";
  } catch {
    return false;
  }
}
function markHintDone() {
  try {
    localStorage.setItem(TUTORIAL_HINT_KEY, "1");
  } catch { /* egal – dann kommt der Hinweis halt nochmals */ }
}
function removeHint() {
  if (typeof document === "undefined") return;
  document.getElementById("tutorial-hint")?.remove();
}

export function showFirstRunHint(ctx) {
  if (typeof document === "undefined" || !ctx) return;
  if (hintDone() || isTutorialActive() || document.getElementById("tutorial-hint")) return;
  const nav = document.querySelector(".bottom-nav");
  const card = el("section", { class: "tut-hint", id: "tutorial-hint", "aria-labelledby": "tut-hint-title" });
  if (nav && !nav.hidden) card.classList.add("tut-hint-above-nav");
  const head = el("div", { class: "tut-head" });
  head.append(el("h2", { class: "tut-title", id: "tut-hint-title" }, "Neu hier?"));
  const x = el("button", { type: "button", class: "tut-close", "aria-label": "Hinweis schliessen" });
  x.innerHTML = X_ICON;
  head.append(x);
  const text = el("p", { class: "tut-text" }, "Eine kurze Einführung zeigt dir alles mit Übungsdaten – deine echten Daten bleiben unberührt.");
  const close = () => {
    markHintDone();
    card.remove();
  };
  x.addEventListener("click", close);
  const foot = el("div", { class: "tut-foot" });
  foot.append(
    el("span", { class: "tut-spacer" }),
    button("Nein danke", "tut-btn tut-link", close),
    button("Einführung starten", "tut-btn tut-primary", () => {
      close();
      if (typeof ctx.startPracticeTutorial === "function") ctx.startPracticeTutorial();
    }),
  );
  card.append(head, text, foot);
  card.style.visibility = "hidden"; // erst mit tutorial.css zeigen
  document.body.appendChild(card);
  ensureCss().then(() => { card.style.visibility = ""; });
}
