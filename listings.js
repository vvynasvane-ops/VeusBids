import {
  requireAuth, db, doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, signOut, auth,
  collection, getDocs, query, where, serverTimestamp
} from "./firebase-init.js";
import { fileToCompressedDataURL } from "./img-utils.js";
import { initTheme } from "./theme.js";
import { renderNav } from "./nav.js";
import { generateListingCode, loaderTrackHtml, loaderPhotoHtml, escapeHtml, formatMoney, timeLeftLabel, isEnded, CATEGORIES, CONDITIONS, placeholderPhoto } from "./common.js";
import { startPresence } from "./presence.js";
import { showToast, savedToast, initNotifications } from "./notifications.js";

initTheme();
renderNav("profile");
document.body.insertAdjacentHTML("beforeend", loaderTrackHtml("Loading your listings"));

const nameEl = document.querySelector("#name");
const phoneEl = document.querySelector("#phone");
const photoPreview = document.querySelector("#photo-preview");
const photoFileInput = document.querySelector("#photoFile");
const uploadHint = document.querySelector(".upload-hint");
const showOnlineStatusEl = document.querySelector("#show-online-status");
const saveAccountBtn = document.querySelector("#save-account");
const logoutBtn = document.querySelector("#logout-btn");
const feedbackCard = document.querySelector("#feedback-card");
const feedbackSummary = document.querySelector("#feedback-summary");
const feedbackList = document.querySelector("#feedback-list");
const clearFeedbackBtn = document.querySelector("#clear-feedback");

const listingFormTitle = document.querySelector("#listing-form-title");
const iTitleEl = document.querySelector("#i-title");
const iCategoryEl = document.querySelector("#i-category");
const iConditionEl = document.querySelector("#i-condition");
const iStartPriceEl = document.querySelector("#i-start-price");
const iReserveEl = document.querySelector("#i-reserve");
const durationField = document.querySelector("#duration-field");
const iDurationValueEl = document.querySelector("#i-duration-value");
const iDurationUnitEl = document.querySelector("#i-duration-unit");
const durationHintEl = document.querySelector("#duration-hint");
const iLocationEl = document.querySelector("#i-location");
const iDescriptionEl = document.querySelector("#i-description");
const iContactEl = document.querySelector("#i-contact");
const iPhotosFile = document.querySelector("#i-photos-file");
const iPhotosPreview = document.querySelector("#i-photos-preview");
const saveListingBtn = document.querySelector("#save-listing");
const cancelEditBtn = document.querySelector("#cancel-edit");
const myListingsGrid = document.querySelector("#my-listings-grid");
const noListings = document.querySelector("#no-listings");

iCategoryEl.innerHTML = CATEGORIES.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
iConditionEl.innerHTML = CONDITIONS.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");

let user, userRef, pendingPhotoURL = null, myListings = [], editingId = null, pendingPhotos = [];

// ---- Auction length: typed number + unit, minutes by default ----
// Minutes is the standard unit (matches how short, fast-moving auctions on
// this platform actually run) — hours and days are there for longer listings.
const UNIT_MS = { minutes: 60 * 1000, hours: 60 * 60 * 1000, days: 24 * 60 * 60 * 1000 };
const MIN_DURATION_MS = 2 * 60 * 1000;   // below this the anti-snipe 2-minute extension (item.js) never stops re-triggering
const MAX_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30-day sanity cap

function durationToMs() {
  const unit = UNIT_MS[iDurationUnitEl.value] ? iDurationUnitEl.value : "minutes";
  const n = Number(iDurationValueEl.value) || 0;
  return Math.min(MAX_DURATION_MS, Math.max(MIN_DURATION_MS, n * UNIT_MS[unit]));
}

function formatDurationMs(ms) {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"}`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"}`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

function updateDurationHint() {
  durationHintEl.textContent = `Ends about ${formatDurationMs(durationToMs())} after you publish.`;
}
iDurationValueEl.addEventListener("input", updateDurationHint);
iDurationUnitEl.addEventListener("change", updateDurationHint);

async function load() {
  user = await requireAuth();
  startPresence(user.uid);
  userRef = doc(db, "users", user.uid);
  const snap = await getDoc(userRef);
  let data = snap.data();

  // The auth-time doc creation didn't happen (deleted doc, manual Firebase
  // Auth account, or an interrupted signup). Rebuild it here instead of
  // crashing, so this page — and the Save buttons below, which use
  // updateDoc() and require the doc to already exist — work again.
  if (!data) {
    data = {
      name: user.displayName || "New member", photoURL: user.photoURL || "", phone: "",
      showOnlineStatus: true,
      savedItems: [], blockedUsers: [],
      preferences: { priceMin: null, priceMax: null, category: "", conditions: [] },
      createdAt: Date.now()
    };
    await setDoc(userRef, data);
    showToast("We had to rebuild your account record — please double-check your details below.", { type: "info" });
  }

  document.querySelector(".loader-page")?.remove();
  nameEl.value = data.name || "";
  phoneEl.value = data.phone || "";
  pendingPhotoURL = data.photoURL || "";
  photoPreview.src = data.photoURL || placeholderPhoto();
  showOnlineStatusEl.checked = data.showOnlineStatus !== false;

  initNotifications(user.uid, data.preferences, data.savedItems || []);
  await loadMyListings(user.uid);
  await loadFeedback(user.uid, data.feedbackClearedAt || 0);
  startCountdownTicker();
}

async function loadMyListings(uid) {
  try {
    const snap = await getDocs(query(collection(db, "items"), where("ownerUid", "==", uid)));
    myListings = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    myListings.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    renderMyListings();
  } catch (err) {
    console.error("Couldn't load your listings:", err);
    myListingsGrid.innerHTML = `<p class="muted">Couldn't load your listings — check your connection and refresh.</p>`;
  }
}

function renderMyListings() {
  noListings.style.display = myListings.length ? "none" : "block";
  myListingsGrid.innerHTML = myListings.map(it => {
    const ended = isEnded(it);
    const hasBids = (it.bidCount || 0) > 0;
    return `
    <div class="person-card" data-item-id="${it.id}" style="cursor:default;">
      <img class="person-photo" src="${(it.photos && it.photos[0]) || placeholderPhoto()}" alt="${escapeHtml(it.title || "Item")}">
      <div class="card-countdown ${ended ? "ended-txt" : ""}" data-countdown="${it.id}">${ended ? (hasBids ? "SOLD" : "ENDED — NO BIDS") : timeLeftLabel(it.endTime).toUpperCase()}</div>
      <div class="person-meta">
        <div class="person-name">${escapeHtml(it.title || "Untitled item")}</div>
        <div class="person-sub auction-price-row">
          <span class="auction-current-price">${formatMoney(it.currentBid || it.startingPrice)}</span>
          <span class="auction-bid-count">${it.bidCount || 0} bid${it.bidCount === 1 ? "" : "s"}</span>
        </div>
        <div class="person-sub">${it.viewCount || 0} view${it.viewCount === 1 ? "" : "s"} · Listing ${escapeHtml(it.code || "")}</div>
        ${ended && hasBids ? `<div class="person-sub" style="color:var(--accent);">Won by ${escapeHtml(it.currentBidderName || "a bidder")} · ${it.fulfilled ? "Delivered ✓" : "Awaiting delivery"}</div>` : ""}
        <div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap;">
          <a class="btn ghost small" href="item.html?id=${it.id}">View</a>
          ${!hasBids ? `<button type="button" class="btn ghost small" data-edit="${it.id}">Edit</button>` : ""}
          ${!ended ? `<button type="button" class="btn ghost small" data-endnow="${it.id}">End now</button>` : ""}
          ${ended && hasBids ? `<button type="button" class="btn ghost small" data-fulfill="${it.id}">${it.fulfilled ? "Mark undelivered" : "Mark delivered"}</button>` : ""}
          <button type="button" class="btn ghost small" data-delete="${it.id}">Delete</button>
        </div>
      </div>
    </div>`;
  }).join("");
  myListingsGrid.querySelectorAll("[data-edit]").forEach(btn => btn.addEventListener("click", () => startEdit(btn.dataset.edit)));
  myListingsGrid.querySelectorAll("[data-delete]").forEach(btn => btn.addEventListener("click", () => deleteListing(btn.dataset.delete)));
  myListingsGrid.querySelectorAll("[data-endnow]").forEach(btn => btn.addEventListener("click", () => endAuctionNow(btn.dataset.endnow)));
  myListingsGrid.querySelectorAll("[data-fulfill]").forEach(btn => btn.addEventListener("click", () => toggleFulfilled(btn.dataset.fulfill)));
}

/** Closes bidding immediately — the seller's own equivalent of the clock
 * running out. Handy for an item sold or settled outside the app, or a
 * listing the seller just wants to stop early; the current highest bid (if
 * any) still wins, same as a normal close. */
async function endAuctionNow(id) {
  const it = myListings.find(x => x.id === id);
  const warn = (it?.bidCount || 0) > 0
    ? `End "${it?.title || "this listing"}" right now? The current highest bid becomes the winning bid immediately.`
    : `End "${it?.title || "this listing"}" right now with no bids? It'll close as unsold.`;
  if (!confirm(warn)) return;
  try {
    await updateDoc(doc(db, "items", id), { endTime: Date.now() });
    await loadMyListings(user.uid);
    showToast("Auction ended.", { type: "success" });
  } catch (err) {
    console.error("End auction failed:", err);
    showToast("Couldn't end that auction — try again.", { type: "error" });
  }
}

/** Lets a seller track, for their own reference, which sold items have
 * actually been handed off — separate from the buyer/seller chat itself, so
 * "who still needs their item" doesn't get lost in a long list of sales. */
async function toggleFulfilled(id) {
  const it = myListings.find(x => x.id === id);
  if (!it) return;
  try {
    await updateDoc(doc(db, "items", id), { fulfilled: !it.fulfilled });
    await loadMyListings(user.uid);
    showToast(it.fulfilled ? "Marked as awaiting delivery." : "Marked as delivered.", { type: "success" });
  } catch (err) {
    console.error("Couldn't update delivery status:", err);
    showToast("Couldn't update that — try again.", { type: "error" });
  }
}

function startCountdownTicker() {
  setInterval(() => {
    document.querySelectorAll("#my-listings-grid [data-countdown]").forEach(el => {
      const it = myListings.find(x => x.id === el.dataset.countdown);
      if (!it) return;
      const ended = isEnded(it);
      el.textContent = ended ? ((it.bidCount || 0) > 0 ? "SOLD" : "ENDED — NO BIDS") : timeLeftLabel(it.endTime).toUpperCase();
      el.classList.toggle("ended-txt", ended);
    });
  }, 1000);
}

/** Live-watches the `feedback` collection for docs on any item this member
 * owns (see item.js's quick-feedback chips). `clearedAt` (my own doc's own
 * field, so I can write it myself) hides anything left before the last time
 * I hit "Clear all" — the underlying docs stay put, only my own view of them
 * changes; other members still see feedback on the listing itself. */
async function loadFeedback(uid, clearedAt) {
  try {
    const snap = await getDocs(query(collection(db, "feedback"), where("ownerUid", "==", uid)));
    let list = snap.docs.map(d => d.data());
    if (clearedAt) list = list.filter(f => (f.createdAt?.toMillis?.() || 0) > clearedAt);
    list.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
    renderFeedback(list);
  } catch (err) {
    console.error("Couldn't load feedback:", err);
  }
}

function renderFeedback(list) {
  if (!list.length) { feedbackCard.style.display = "none"; return; }
  feedbackCard.style.display = "block";
  feedbackSummary.textContent = `${list.length} buyer${list.length === 1 ? "" : "s"} left feedback on your listings.`;
  feedbackList.innerHTML = list.slice(0, 10).map(f => `
    <div class="appreciation-item">
      <div class="appreciation-from">${escapeHtml(f.itemName || "A listing")}</div>
      <div>${escapeHtml(f.text || "")}</div>
    </div>`).join("");
}

clearFeedbackBtn.addEventListener("click", async () => {
  if (!confirm("Clear all feedback from this view? This only clears your view — it can't be undone, and it stays visible to buyers on the listing itself.")) return;
  clearFeedbackBtn.disabled = true;
  try {
    const clearedAt = Date.now();
    await updateDoc(userRef, { feedbackClearedAt: clearedAt });
    renderFeedback([]);
    showToast("Cleared.", { type: "success" });
  } catch (err) {
    console.error("Clear feedback failed:", err);
    showToast("Couldn't clear those — try again.", { type: "error" });
  } finally {
    clearFeedbackBtn.disabled = false;
  }
});

photoFileInput.addEventListener("change", async () => {
  const file = photoFileInput.files[0];
  if (!file) return;
  const hintText = uploadHint.textContent;
  uploadHint.innerHTML = loaderPhotoHtml() + ` <span style="vertical-align:middle;">Processing photo…</span>`;
  try {
    const dataUrl = await fileToCompressedDataURL(file, 480, 0.65);
    pendingPhotoURL = dataUrl;
    photoPreview.src = dataUrl;
    showToast("Photo ready — hit Save account to keep it.", { type: "info" });
  } catch (err) {
    showToast(err.message || "Couldn't process that image.", { type: "error" });
  } finally {
    uploadHint.textContent = hintText;
  }
});

saveAccountBtn.addEventListener("click", async () => {
  saveAccountBtn.disabled = true;
  try {
    await updateDoc(userRef, {
      name: nameEl.value.trim(),
      phone: phoneEl.value.trim(),
      photoURL: pendingPhotoURL || "",
      showOnlineStatus: showOnlineStatusEl.checked
    });
    savedToast("Account");
  } finally {
    saveAccountBtn.disabled = false;
  }
});

// ---- Add / edit an auction listing ----
function renderListingPhotos() {
  iPhotosPreview.innerHTML = pendingPhotos.map((src, i) => `
    <div class="extra-photo-thumb">
      <img src="${src}" alt="">
      <button type="button" data-remove="${i}" title="Remove">×</button>
    </div>`).join("");
  iPhotosPreview.querySelectorAll("[data-remove]").forEach(btn => {
    btn.addEventListener("click", () => {
      pendingPhotos.splice(Number(btn.dataset.remove), 1);
      renderListingPhotos();
    });
  });
}

iPhotosFile.addEventListener("change", async () => {
  const files = Array.from(iPhotosFile.files || []);
  iPhotosFile.value = "";
  if (!files.length) return;
  iPhotosPreview.innerHTML = `<div class="loader-wrap" style="padding:12px;">${loaderPhotoHtml()}<div class="loader-label">Processing photos</div></div>`;
  for (const file of files.slice(0, 6 - pendingPhotos.length)) {
    try {
      const dataUrl = await fileToCompressedDataURL(file, 640, 0.6);
      pendingPhotos.push(dataUrl);
    } catch (err) {
      showToast(err.message || "Couldn't process one of those images.", { type: "error" });
    }
  }
  renderListingPhotos();
  showToast("Photos ready — hit Publish/Save to keep them.", { type: "info" });
});

function resetListingForm() {
  editingId = null;
  pendingPhotos = [];
  listingFormTitle.textContent = "List an item";
  saveListingBtn.textContent = "Start auction";
  cancelEditBtn.style.display = "none";
  iTitleEl.value = ""; iStartPriceEl.value = ""; iReserveEl.value = ""; iLocationEl.value = "";
  iDescriptionEl.value = ""; iContactEl.value = ""; iCategoryEl.value = CATEGORIES[0]; iConditionEl.value = CONDITIONS[0];
  iDurationValueEl.value = "60";
  iDurationUnitEl.value = "minutes";
  durationField.style.display = "";
  updateDurationHint();
  renderListingPhotos();
}

function startEdit(id) {
  const it = myListings.find(x => x.id === id);
  if (!it) return;
  if ((it.bidCount || 0) > 0) { showToast("This item already has bids and can't be edited — you can still delete it.", { type: "error" }); return; }
  editingId = id;
  pendingPhotos = [...(it.photos || [])];
  listingFormTitle.textContent = `Editing ${it.title || "listing"}`;
  saveListingBtn.textContent = "Save changes";
  cancelEditBtn.style.display = "inline-flex";
  iTitleEl.value = it.title || "";
  iCategoryEl.value = it.category || CATEGORIES[0];
  iConditionEl.value = it.condition || CONDITIONS[0];
  iStartPriceEl.value = it.startingPrice || "";
  iReserveEl.value = it.reservePrice ?? "";
  iLocationEl.value = it.location || "";
  iDescriptionEl.value = it.description || "";
  iContactEl.value = it.contact || "";
  // The countdown itself can't be changed on a published listing (see the
  // save handler below — endTime is only ever set on create), so hide the
  // length picker while editing instead of showing a control that does
  // nothing. Delete + relist is the path for "I want a different length."
  durationField.style.display = "none";
  renderListingPhotos();
  document.querySelector("#listing-form-title").scrollIntoView({ behavior: "smooth", block: "start" });
}
cancelEditBtn.addEventListener("click", resetListingForm);

saveListingBtn.addEventListener("click", async () => {
  const title = iTitleEl.value.trim();
  const startPrice = Number(iStartPriceEl.value);
  if (!title) { showToast("Give the item a title first.", { type: "error" }); return; }
  if (!startPrice || startPrice <= 0) { showToast("Set a starting price above $0.", { type: "error" }); return; }
  if (!editingId && (!iDurationValueEl.value || Number(iDurationValueEl.value) <= 0)) {
    showToast("Set an auction length greater than 0.", { type: "error" });
    return;
  }
  saveListingBtn.disabled = true;
  try {
    const fields = {
      title,
      category: iCategoryEl.value,
      condition: iConditionEl.value,
      startingPrice: startPrice,
      reservePrice: iReserveEl.value ? Number(iReserveEl.value) : null,
      location: iLocationEl.value.trim(),
      description: iDescriptionEl.value.trim(),
      contact: iContactEl.value.trim(),
      photos: pendingPhotos
    };
    if (editingId) {
      await updateDoc(doc(db, "items", editingId), fields);
      showToast("Listing updated.", { type: "success" });
    } else {
      const durationMs = durationToMs();
      await addDoc(collection(db, "items"), {
        ...fields,
        ownerUid: user.uid,
        ownerName: nameEl.value.trim() || "A seller",
        code: generateListingCode(),
        currentBid: null,
        currentBidderUid: null,
        currentBidderName: null,
        bidCount: 0,
        everBidUids: [],
        viewCount: 0,
        fulfilled: false,
        endTime: Date.now() + durationMs,
        createdAt: Date.now()
      });
      showToast(`Auction live — ends in about ${formatDurationMs(durationMs)}.`, { type: "success" });
    }
    resetListingForm();
    await loadMyListings(user.uid);
  } catch (err) {
    console.error("Saving listing failed:", err);
    showToast("Couldn't save that listing — try again.", { type: "error" });
  } finally {
    saveListingBtn.disabled = false;
  }
});

async function deleteListing(id) {
  const it = myListings.find(x => x.id === id);
  const warn = (it?.bidCount || 0) > 0
    ? `"${it?.title || "This item"}" has active bids. Deleting it cancels the auction for everyone who's bid — this can't be undone.`
    : `Delete "${it?.title || "this listing"}"? It disappears from Browse and everyone's watchlist right away — this can't be undone.`;
  if (!confirm(warn)) return;
  try {
    await deleteDoc(doc(db, "items", id));
    if (editingId === id) resetListingForm();
    await loadMyListings(user.uid);
    showToast("Listing deleted.", { type: "success" });
  } catch (err) {
    console.error("Delete listing failed:", err);
    showToast("Couldn't delete that — try again.", { type: "error" });
  }
}

resetListingForm();

logoutBtn.addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "index.html";
});

load().catch(err => {
  console.error("My Listings load failed:", err);
  document.querySelector(".loader-page")?.remove();
  showToast("Couldn't load your listings — check your connection and refresh.", { type: "error" });
});
