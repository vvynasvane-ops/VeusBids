import {
  requireAuth, db, auth, signOut, doc, getDoc, updateDoc, deleteDoc, addDoc, collection,
  getDocs, query, orderBy, limit, onSnapshot, serverTimestamp, arrayUnion, arrayRemove, increment
} from "./firebase-init.js";
import { openChat, closeChat } from "./chat.js";
import { initTheme } from "./theme.js";
import { renderNav } from "./nav.js";
import {
  escapeHtml, placeholderPhoto, activityLabel, loaderHtml, loaderTrackHtml,
  formatMoney, timeLeftLabel, isEnded, isEndingSoon
} from "./common.js";
import { startPresence } from "./presence.js";
import { showToast, initNotifications } from "./notifications.js";

initTheme();
renderNav(""); // no single nav tab owns the item detail page
document.body.insertAdjacentHTML("beforeend", loaderTrackHtml("Loading listing"));

const root = document.querySelector("#item-root");
const logoutBtn = document.querySelector("#logout-btn");

const itemId = new URLSearchParams(window.location.search).get("id");

let me, myData, item, owner = {}, activeGallery = 0, bidsUnsub = null, itemUnsub = null;

/** The bump required above the current price — bigger increments at higher
 * price points, same shape auction houses actually use, so a $6 bid can't
 * follow a $50,000 one. */
function minIncrement(amount) {
  if (amount < 20) return 1;
  if (amount < 100) return 5;
  if (amount < 500) return 10;
  if (amount < 1000) return 25;
  if (amount < 5000) return 50;
  return 100;
}
function minNextBid(it) {
  const current = it.currentBid || it.startingPrice || 0;
  return it.bidCount ? current + minIncrement(current) : current;
}

async function load() {
  if (!itemId) {
    document.querySelector(".loader-page")?.remove();
    root.innerHTML = `<p class="muted">No listing specified.</p>`;
    return;
  }
  me = await requireAuth();
  startPresence(me.uid);
  const meSnap = await getDoc(doc(db, "users", me.uid));
  myData = meSnap.data() || {};

  const snap = await getDoc(doc(db, "items", itemId));
  document.querySelector(".loader-page")?.remove();
  if (!snap.exists()) {
    root.innerHTML = `<p class="muted">This listing no longer exists.</p>`;
    return;
  }
  item = { id: snap.id, ...snap.data() };

  if (item.ownerUid !== me.uid) {
    updateDoc(doc(db, "items", itemId), { viewCount: increment(1) }).catch(() => {});
  }

  const ownerSnap = await getDoc(doc(db, "users", item.ownerUid)).catch(() => null);
  owner = ownerSnap?.data() || {};

  render();
  initNotifications(me.uid, myData.preferences, myData.savedItems || []);
  watchLive();
  startTicker();
}

function isSaved() { return (myData.savedItems || []).includes(itemId); }

function render() {
  const ended = isEnded(item);
  const current = item.currentBid || item.startingPrice || 0;
  const photos = (item.photos && item.photos.length ? item.photos : [placeholderPhoto()]);
  const activity = owner.showOnlineStatus !== false ? activityLabel(owner.lastActive) : "";
  const isOwner = item.ownerUid === me.uid;
  const iWon = ended && item.currentBidderUid === me.uid && (item.bidCount || 0) > 0;
  const iLost = ended && !isOwner && item.currentBidderUid && item.currentBidderUid !== me.uid;

  root.innerHTML = `
    <div class="detail-wrap">
      <div>
        <img id="gallery-main" class="person-photo" style="border-radius:var(--radius-lg); cursor:${photos.length > 1 ? "pointer" : "default"};" src="${photos[activeGallery] || photos[0]}" alt="${escapeHtml(item.title || "Item")}">
        ${photos.length > 1 ? `<div class="photo-strip" id="gallery-strip" style="margin-top:8px;">${photos.map((url, i) => `<img data-idx="${i}" src="${url}" alt="" style="${i === activeGallery ? "outline:2px solid var(--accent);" : ""}">`).join("")}</div>` : ""}

        <h2 style="margin-top:14px;">${escapeHtml(item.title || "Untitled item")}</h2>
        <div style="display:flex; gap:8px; flex-wrap:wrap; margin:6px 0;">
          <span class="chip">${escapeHtml(item.category || "Item")}</span>
          ${item.condition ? `<span class="chip">${escapeHtml(item.condition)}</span>` : ""}
        </div>
        ${item.location ? `<p class="muted" style="font-size:13px;">&#9635; ${escapeHtml(item.location)}</p>` : ""}
        ${activity && !isOwner ? `<p class="muted" style="font-size:12px;">Seller ${escapeHtml(activity.toLowerCase())}</p>` : ""}
        ${item.code ? `<p class="muted" style="font-size:12px;">Listing ${escapeHtml(item.code)}</p>` : ""}

        <div style="display:flex; gap:10px; align-items:center; margin-top:10px; flex-wrap:wrap;">
          ${!isOwner ? `<button type="button" class="like-btn ${isSaved() ? "liked" : ""}" id="detail-like-btn" title="${isSaved() ? "Remove from Watchlist" : "Watch"}">${isSaved() ? "&#10084;" : "&#9825;"}</button>` : ""}
          <button type="button" id="feedback-btn" class="btn subtle small">&#10024; Leave feedback</button>
        </div>
        <div id="feedback-picker" class="appreciate-picker" hidden></div>

        <p style="margin-top:16px;">${escapeHtml(item.description || "No description yet.")}</p>
      </div>

      <div>
        <div class="card auction-panel ${isEndingSoon(item.endTime) && !ended ? "urgent" : ""}">
          <div class="auction-panel-label">${ended ? (item.bidCount ? "WINNING BID" : "CURRENT PRICE") : "CURRENT BID"}</div>
          <div class="auction-panel-price">${formatMoney(current)}</div>
          <div class="auction-panel-meta">
            <span>${item.bidCount || 0} bid${item.bidCount === 1 ? "" : "s"}</span>
            <span id="item-countdown" class="${ended ? "ended-txt" : isEndingSoon(item.endTime) ? "urgent-txt" : ""}">${ended ? "AUCTION ENDED" : timeLeftLabel(item.endTime).toUpperCase()}</span>
          </div>

          ${isOwner ? `
            <p class="muted" style="font-size:13px; margin-top:10px;">This is your listing — manage it from <a href="listings.html">My Listings</a>.</p>
          ` : ended ? `
            <p class="muted" style="font-size:13px; margin-top:10px;">
              ${item.bidCount ? (iWon ? "&#127942; You won this auction! Message the seller to arrange payment/pickup." : `Sold to ${escapeHtml(item.currentBidderName || "another bidder")}.`) : "This auction closed with no bids."}
            </p>
          ` : `
            <form id="bid-form" style="margin-top:14px;">
              <label for="bid-amount">Your bid (min ${formatMoney(minNextBid(item))})</label>
              <input id="bid-amount" type="number" min="${minNextBid(item)}" step="1" placeholder="${minNextBid(item)}">
              <button type="submit" class="btn block" style="margin-top:10px;">${item.bidCount ? "Place bid" : "Bid now — be the first"}</button>
            </form>
            ${item.reservePrice ? `<p class="field-hint">Reserve price ${current >= item.reservePrice ? "met" : "not yet met"}.</p>` : ""}
          `}
        </div>

        <div class="gilt-rule"></div>
        <h3>Bid history</h3>
        <div id="bid-history"></div>

        ${!isOwner ? `
          <div class="gilt-rule"></div>
          <h3>Message the seller</h3>
          <div id="chat-mount"></div>

          <div class="gilt-rule"></div>
          <div style="display:flex; gap:10px;">
            <button id="block-btn" class="btn ghost small" type="button">Block seller</button>
            <button id="report-btn" class="btn ghost small" type="button">Report listing</button>
          </div>
          <p id="safety-note" class="muted" style="font-size:12px; margin-top:6px;"></p>
        ` : ""}
      </div>
    </div>`;

  wireDetailEvents(isOwner, ended);
}

function wireDetailEvents(isOwner, ended) {
  document.querySelectorAll("#gallery-strip img").forEach(img => {
    img.addEventListener("click", () => { activeGallery = Number(img.dataset.idx); render(); });
  });

  if (!isOwner) {
    document.querySelector("#detail-like-btn")?.addEventListener("click", toggleSave);
  }

  const feedbackBtn = document.querySelector("#feedback-btn");
  const feedbackPicker = document.querySelector("#feedback-picker");
  feedbackBtn.addEventListener("click", () => {
    const opening = feedbackPicker.hidden;
    feedbackPicker.hidden = !opening;
    if (opening && !feedbackPicker.innerHTML) {
      feedbackPicker.innerHTML = FEEDBACK_PRESETS.map(text => `<button type="button" class="chip appreciate-chip" data-text="${escapeHtml(text)}">${escapeHtml(text)}</button>`).join("");
      feedbackPicker.querySelectorAll(".appreciate-chip").forEach(chip => {
        chip.addEventListener("click", () => sendFeedback(chip.dataset.text, feedbackBtn, feedbackPicker));
      });
    }
  });

  const bidForm = document.querySelector("#bid-form");
  if (bidForm) bidForm.addEventListener("submit", onPlaceBid);

  if (!isOwner) {
    document.querySelector("#block-btn")?.addEventListener("click", async () => {
      if (!confirm("Block this seller? You won't see their listings in Browse anymore.")) return;
      await updateDoc(doc(db, "users", me.uid), { blockedUsers: arrayUnion(item.ownerUid) });
      closeChat();
      showToast("Blocked.", { type: "success" });
      window.location.href = "browse.html";
    });

    document.querySelector("#report-btn")?.addEventListener("click", async () => {
      const reason = prompt("What's the issue with this listing? (a short reason helps us review it)");
      if (reason === null) return;
      await addDoc(collection(db, "reports"), {
        reportedItemId: itemId, reportedUid: item.ownerUid, reporterUid: me.uid,
        reason: reason.trim() || "No reason given", createdAt: serverTimestamp()
      });
      document.querySelector("#safety-note").textContent = "Thanks — this has been reported for review. You can also reach us directly at support@veusbid.app.";
      showToast("Report submitted.", { type: "success" });
    });

    openChat(document.querySelector("#chat-mount"), me.uid, item.ownerUid, { name: owner.name, photoURL: owner.photoURL });
  }
}

async function toggleSave() {
  const saved = isSaved();
  myData.savedItems = myData.savedItems || [];
  if (saved) myData.savedItems = myData.savedItems.filter(u => u !== itemId);
  else myData.savedItems.push(itemId);
  await updateDoc(doc(db, "users", me.uid), { savedItems: saved ? arrayRemove(itemId) : arrayUnion(itemId) });
  showToast(saved ? "Removed from Watchlist." : "Watching — you'll be pinged before it ends.", { type: saved ? "info" : "success" });
  render();
}

const FEEDBACK_PRESETS = [
  "Item as described", "Fast shipping", "Great communication", "Well packaged",
  "Would buy again", "Smooth transaction", "Slow to respond", "Not as described"
];

async function sendFeedback(text, btn, picker) {
  picker.hidden = true;
  btn.disabled = true;
  btn.textContent = "Sent ✓";
  try {
    await addDoc(collection(db, "feedback"), {
      itemId, ownerUid: item.ownerUid, itemName: item.title || "a listing",
      fromUid: me.uid, fromName: myData.name || "A bidder", text, createdAt: serverTimestamp()
    });
    showToast("Feedback posted — thanks for helping other bidders.", { type: "success" });
  } catch (err) {
    console.error("Feedback failed:", err);
    btn.disabled = false;
    btn.textContent = "\u2728 Leave feedback";
    showToast("Couldn't post that — try again.", { type: "error" });
  }
}

async function onPlaceBid(e) {
  e.preventDefault();
  const input = document.querySelector("#bid-amount");
  const amount = Number(input.value);
  const min = minNextBid(item);
  if (!amount || amount < min) {
    showToast(`Bid must be at least ${formatMoney(min)}.`, { type: "error" });
    return;
  }
  const submitBtn = e.target.querySelector("button[type=submit]");
  submitBtn.disabled = true;
  try {
    // Anti-sniping: a bid landing inside the final 2 minutes pushes the
    // close out by 2 more minutes — the same "going, going, gone" grace
    // period real auction houses use, so a last-second bid always gets a
    // fair chance to be topped rather than silently winning by a clock edge.
    const now = Date.now();
    const extending = item.endTime && (item.endTime - now) < 2 * 60 * 1000;
    const newEndTime = extending ? now + 2 * 60 * 1000 : item.endTime;

    await updateDoc(doc(db, "items", itemId), {
      currentBid: amount,
      currentBidderUid: me.uid,
      currentBidderName: myData.name || "A bidder",
      bidCount: increment(1),
      everBidUids: arrayUnion(me.uid),
      endTime: newEndTime
    });
    await addDoc(collection(db, "items", itemId, "bids"), {
      bidderUid: me.uid, bidderName: myData.name || "A bidder", amount, at: serverTimestamp()
    });
    input.value = "";
    showToast(extending ? "Bid placed — auction extended 2 minutes!" : "Bid placed — you're the highest bidder.", { type: "success" });
  } catch (err) {
    console.error("Bid failed:", err);
    showToast("Couldn't place that bid — try again.", { type: "error" });
  } finally {
    submitBtn.disabled = false;
  }
}

function renderBidHistory(bids) {
  const el = document.querySelector("#bid-history");
  if (!el) return;
  if (!bids.length) { el.innerHTML = `<p class="muted" style="font-size:13px;">No bids yet — be the first.</p>`; return; }
  el.innerHTML = `<div class="appreciation-list">${bids.map(b => `
    <div class="appreciation-item">
      <div class="appreciation-from">${escapeHtml(b.bidderName || "A bidder")}${b.bidderUid === me.uid ? " (you)" : ""}</div>
      <div>${formatMoney(b.amount)}</div>
    </div>`).join("")}</div>`;
}

/** Live-watches the item doc (price/bidder/countdown updates from anyone
 * bidding) and the bid history subcollection, for as long as this page is open. */
function watchLive() {
  itemUnsub = onSnapshot(doc(db, "items", itemId), (snap) => {
    if (!snap.exists()) return;
    const prevBidder = item.currentBidderUid;
    item = { id: snap.id, ...snap.data() };
    if (prevBidder === me.uid && item.currentBidderUid && item.currentBidderUid !== me.uid) {
      showToast(`Outbid! New price: ${formatMoney(item.currentBid)}`, { type: "outbid", duration: 5000 });
    }
    render();
  });
  bidsUnsub = onSnapshot(query(collection(db, "items", itemId, "bids"), orderBy("at", "desc"), limit(20)), (snap) => {
    renderBidHistory(snap.docs.map(d => d.data()));
  });
}

function startTicker() {
  setInterval(() => {
    const el = document.querySelector("#item-countdown");
    if (!el || !item) return;
    const ended = isEnded(item);
    el.textContent = ended ? "AUCTION ENDED" : timeLeftLabel(item.endTime).toUpperCase();
    el.classList.toggle("ended-txt", ended);
    el.classList.toggle("urgent-txt", !ended && isEndingSoon(item.endTime));
    // Re-render once, right at the moment an open auction flips to ended,
    // so the bid form is replaced by the winner/closed message without
    // needing a manual refresh.
    if (ended && !el.dataset.endedHandled) {
      el.dataset.endedHandled = "1";
      render();
    }
  }, 1000);
}

window.addEventListener("beforeunload", () => {
  if (itemUnsub) itemUnsub();
  if (bidsUnsub) bidsUnsub();
});

logoutBtn.addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "index.html";
});

load().catch(err => {
  console.error("Item load failed:", err);
  document.querySelector(".loader-page")?.remove();
  root.innerHTML = `<p class="muted">Couldn't load this listing — check your connection and refresh.</p>`;
});
