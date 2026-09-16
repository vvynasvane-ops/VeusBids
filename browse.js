import {
  requireAuth, db, auth, signOut, collection, getDocs, doc, getDoc, updateDoc,
  arrayUnion, arrayRemove
} from "./firebase-init.js";
import { initTheme } from "./theme.js";
import { renderNav } from "./nav.js";
import { escapeHtml, itemCardHtml, loaderHtml, loaderTrackHtml, timeLeftLabel, isEnded, CATEGORIES, CONDITIONS } from "./common.js";
import { matchScore, hasPreferences } from "./recommend.js";
import { startPresence } from "./presence.js";
import { showToast, initNotifications } from "./notifications.js";

initTheme();
renderNav("browse");
document.body.insertAdjacentHTML("beforeend", loaderTrackHtml("Loading auctions"));

const grid = document.querySelector("#grid");
const recommendedGrid = document.querySelector("#recommended-grid");
const watchGrid = document.querySelector("#watch-grid");
const noWatch = document.querySelector("#no-watch");
const noResults = document.querySelector("#no-results");
const noRecommended = document.querySelector("#no-recommended");
const searchInput = document.querySelector("#search-input");
const sortSelect = document.querySelector("#sort-select");
const filtersToggleBtn = document.querySelector("#filters-toggle-btn");
const filtersPanel = document.querySelector("#filters-panel");
const categorySelect = document.querySelector("#f-category");
const conditionsBox = document.querySelector("#f-conditions");
const applyFiltersBtn = document.querySelector("#apply-filters");
const clearFiltersBtn = document.querySelector("#clear-filters");
const savePresetBtn = document.querySelector("#save-preset");
const presetList = document.querySelector("#preset-list");
const logoutBtn = document.querySelector("#logout-btn");

categorySelect.innerHTML = `<option value="">Any category</option>` + CATEGORIES.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
conditionsBox.innerHTML = CONDITIONS.map((c, i) => `
  <label for="f-cond-${i}"><input type="checkbox" id="f-cond-${i}" value="${escapeHtml(c)}">${escapeHtml(c)}</label>
`).join("");

let me, myData, items = [];
let filters = { priceMin: null, priceMax: null, category: "", conditions: [], endingSoon: false, hasPhoto: false };

async function load() {
  grid.innerHTML = loaderHtml("Fetching live auctions");
  recommendedGrid.innerHTML = loaderHtml();
  me = await requireAuth();
  startPresence(me.uid);
  const meSnap = await getDoc(doc(db, "users", me.uid));
  myData = meSnap.data() || {};
  document.querySelector(".loader-page")?.remove();
  const blocked = new Set(myData.blockedUsers || []);

  const snap = await getDocs(collection(db, "items"));
  items = [];
  snap.forEach(d => {
    const data = d.data();
    if (blocked.has(data.ownerUid)) return;
    items.push({ id: d.id, ...data });
  });

  render();
  renderPresets();
  initNotifications(me.uid, myData.preferences, myData.savedItems || []);
  startCountdownTicker();
}

function passesFilters(it) {
  const price = it.currentBid || it.startingPrice || 0;
  if (filters.priceMin && price < filters.priceMin) return false;
  if (filters.priceMax && price > filters.priceMax) return false;
  if (filters.category && it.category !== filters.category) return false;
  if (filters.conditions.length && !filters.conditions.includes(it.condition)) return false;
  if (filters.endingSoon && !(it.endTime && it.endTime - Date.now() < 60 * 60 * 1000 && it.endTime > Date.now())) return false;
  if (filters.hasPhoto && !(it.photos && it.photos.length)) return false;
  return true;
}

function matchesSearch(it, term) {
  if (!term) return true;
  const hay = `${it.title || ""} ${it.category || ""} ${it.description || ""} ${it.code || ""}`.toLowerCase();
  return hay.includes(term);
}

function sortList(list) {
  const sorted = [...list];
  if (sortSelect.value === "price-asc") {
    sorted.sort((a, b) => (a.currentBid || a.startingPrice || 0) - (b.currentBid || b.startingPrice || 0));
  } else if (sortSelect.value === "price-desc") {
    sorted.sort((a, b) => (b.currentBid || b.startingPrice || 0) - (a.currentBid || a.startingPrice || 0));
  } else if (sortSelect.value === "ending-soon") {
    sorted.sort((a, b) => (a.endTime || Infinity) - (b.endTime || Infinity));
  } else if (sortSelect.value === "most-bids") {
    sorted.sort((a, b) => (b.bidCount || 0) - (a.bidCount || 0));
  } else {
    sorted.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }
  return sorted;
}

function isSaved(id) { return (myData.savedItems || []).includes(id); }

function render() {
  const term = searchInput.value.trim().toLowerCase();
  const live = items.filter(it => !isEnded(it));
  const visible = sortList(live.filter(it => passesFilters(it) && matchesSearch(it, term)));

  if (hasPreferences(myData.preferences)) {
    const scored = live
      .map(it => ({ it, score: matchScore(myData.preferences, it) }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12);
    recommendedGrid.style.display = scored.length ? "grid" : "none";
    noRecommended.style.display = scored.length ? "none" : "block";
    recommendedGrid.innerHTML = scored.map(x => itemCardHtml(x.it.id, x.it, true, isSaved(x.it.id))).join("");
    attachCardHandlers(recommendedGrid);
  } else {
    recommendedGrid.style.display = "none";
    recommendedGrid.innerHTML = "";
    noRecommended.style.display = "block";
  }

  const watched = items.filter(it => isSaved(it.id));
  watchGrid.style.display = watched.length ? "grid" : "none";
  noWatch.style.display = watched.length ? "none" : "block";
  watchGrid.innerHTML = watched.map(it => itemCardHtml(it.id, it, false, true)).join("");
  attachCardHandlers(watchGrid);

  grid.innerHTML = visible.map(it => itemCardHtml(it.id, it, false, isSaved(it.id))).join("");
  attachCardHandlers(grid);
  noResults.style.display = visible.length ? "none" : "block";
}

function attachCardHandlers(container) {
  container.querySelectorAll(".auction-card").forEach(card => {
    card.addEventListener("click", (e) => {
      const saveBtn = e.target.closest(".card-like-btn");
      if (saveBtn) { e.stopPropagation(); toggleSave(saveBtn.dataset.saveId); return; }
      window.location.href = `item.html?id=${encodeURIComponent(card.dataset.itemId)}`;
    });
  });
}

async function toggleSave(id) {
  const saved = isSaved(id);
  myData.savedItems = myData.savedItems || [];
  if (saved) myData.savedItems = myData.savedItems.filter(u => u !== id);
  else myData.savedItems.push(id);
  render();
  await updateDoc(doc(db, "users", me.uid), { savedItems: saved ? arrayRemove(id) : arrayUnion(id) });
  showToast(saved ? "Removed from Watchlist." : "Watching — you'll be pinged before it ends.", { type: saved ? "info" : "success" });
}

// Live countdown text on every visible card, ticking every second without a full re-render.
function startCountdownTicker() {
  setInterval(() => {
    document.querySelectorAll("[data-countdown]").forEach(el => {
      const it = items.find(x => x.id === el.dataset.countdown);
      if (!it) return;
      const ended = isEnded(it);
      el.textContent = ended ? "ENDED" : timeLeftLabel(it.endTime).toUpperCase();
      el.classList.toggle("ended-txt", ended);
    });
  }, 1000);
}

searchInput.addEventListener("input", render);
sortSelect.addEventListener("change", render);
filtersToggleBtn.addEventListener("click", () => {
  filtersPanel.style.display = filtersPanel.style.display === "none" ? "block" : "none";
});
function readFiltersFromForm() {
  return {
    priceMin: Number(document.querySelector("#f-price-min").value) || null,
    priceMax: Number(document.querySelector("#f-price-max").value) || null,
    category: categorySelect.value,
    conditions: Array.from(conditionsBox.querySelectorAll("input:checked")).map(cb => cb.value),
    endingSoon: document.querySelector("#f-ending-soon").checked,
    hasPhoto: document.querySelector("#f-has-photo").checked
  };
}
function writeFiltersToForm(f) {
  document.querySelector("#f-price-min").value = f.priceMin || "";
  document.querySelector("#f-price-max").value = f.priceMax || "";
  categorySelect.value = f.category || "";
  const wanted = new Set(f.conditions || []);
  conditionsBox.querySelectorAll("input").forEach(cb => { cb.checked = wanted.has(cb.value); });
  document.querySelector("#f-ending-soon").checked = !!f.endingSoon;
  document.querySelector("#f-has-photo").checked = !!f.hasPhoto;
}
applyFiltersBtn.addEventListener("click", async () => {
  filters = readFiltersFromForm();
  render();
  // Filters double as the member's saved search — persisting them is what
  // powers "Recommended for you" here and the new-listing match notifications.
  myData.preferences = { priceMin: filters.priceMin, priceMax: filters.priceMax, category: filters.category, conditions: filters.conditions };
  try { await updateDoc(doc(db, "users", me.uid), { preferences: myData.preferences }); } catch (err) { console.error("Saving search filters failed:", err); }
});
clearFiltersBtn.addEventListener("click", () => {
  ["#f-price-min", "#f-price-max"].forEach(sel => (document.querySelector(sel).value = ""));
  categorySelect.value = "";
  conditionsBox.querySelectorAll("input").forEach(cb => { cb.checked = false; });
  document.querySelector("#f-ending-soon").checked = false;
  document.querySelector("#f-has-photo").checked = false;
  filters = { priceMin: null, priceMax: null, category: "", conditions: [], endingSoon: false, hasPhoto: false };
  render();
});

// ---- saved filter presets (per-device, via localStorage) ----
function presetsKey() { return `vb-presets-${me.uid}`; }
function loadPresets() { try { return JSON.parse(localStorage.getItem(presetsKey())) || []; } catch { return []; } }
function savePresets(list) { localStorage.setItem(presetsKey(), JSON.stringify(list)); }
function renderPresets() {
  const presets = loadPresets();
  presetList.innerHTML = presets.map((p, i) => `
    <span class="chip preset-chip" data-apply="${i}">${escapeHtml(p.name)} <button type="button" data-remove="${i}" title="Delete">&times;</button></span>
  `).join("");
  presetList.querySelectorAll("[data-apply]").forEach(el => {
    el.addEventListener("click", (e) => {
      if (e.target.closest("[data-remove]")) return;
      const p = presets[Number(el.dataset.apply)];
      if (!p) return;
      writeFiltersToForm(p.filters);
      searchInput.value = p.term || "";
      filters = p.filters;
      filtersPanel.style.display = "block";
      render();
      showToast(`Applied "${p.name}".`, { type: "info" });
    });
  });
  presetList.querySelectorAll("[data-remove]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const list = loadPresets();
      list.splice(Number(btn.dataset.remove), 1);
      savePresets(list);
      renderPresets();
    });
  });
}
savePresetBtn.addEventListener("click", () => {
  const name = prompt('Name this filter preset (e.g. "Electronics under $200"):');
  if (!name) return;
  const list = loadPresets();
  list.push({ name: name.trim().slice(0, 30), filters: readFiltersFromForm(), term: searchInput.value.trim() });
  savePresets(list);
  renderPresets();
  showToast("Preset saved.", { type: "success" });
});

logoutBtn.addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "index.html";
});

load().catch(err => {
  console.error("Browse load failed:", err);
  document.querySelector(".loader-page")?.remove();
  grid.innerHTML = `<p class="muted">Couldn't load auctions — check your connection and refresh.</p>`;
});
