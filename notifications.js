// ============================================================
// Shared notification system for VeusBid.
//
// Pieces, all drop-in-safe across every page:
//   1. showToast(msg, opts)       — stacked, themed toasts. Same call
//      signature everywhere, so swapping the import is the only change
//      needed at call sites.
//   2. renderBell(uid)            — a persistent notification bell +
//      history, backed by localStorage (per member), rendered into
//      any page that has a #notif-mount element.
//   3. watchForNewItemMatches()   — a live Firestore listener that raises
//      a notification the moment a brand-new auction listing goes up
//      that fits the signed-in member's saved search filters.
//   4. watchForOutbid()           — live-watches every item this member
//      is currently the highest bidder on, and raises a notification the
//      instant someone else takes the lead.
//   5. watchForEndingSoon()       — live-watches this member's watchlist
//      + active bids for items about to close, so a last-second bid isn't
//      missed.
//   6. watchForNewResponses()     — new/replying message threads.
//   7. watchForListingFeedback()  — feedback left on items this member sold.
// ============================================================

import { db, collection, onSnapshot, query, where, doc, getDoc } from "./firebase-init.js";
import { matchScore, hasPreferences } from "./recommend.js";
import { setMessagesBadge } from "./nav.js";

const SESSION_KEY = "vb-session-start";
const SEEN_KEY = "vb-seen-new-items";
const MSG_SESSION_KEY = "vb-msg-session-start";
const SEEN_THREADS_KEY = "vb-seen-thread-replies";

let toastRoot = null;
function ensureToastRoot() {
  if (toastRoot && document.body.contains(toastRoot)) return toastRoot;
  toastRoot = document.querySelector("#toast-root");
  if (!toastRoot) {
    toastRoot = document.createElement("div");
    toastRoot.id = "toast-root";
    toastRoot.className = "toast-root";
    document.body.appendChild(toastRoot);
  }
  return toastRoot;
}

const ICONS = { success: "&#10003;", match: "&#10022;", error: "!", info: "&#9670;", outbid: "&#9889;" };

/** Stacked, auto-dismissing toast. opts: { type: "info"|"success"|"match"|"error"|"outbid", duration, icon } */
export function showToast(msg, opts = {}) {
  const root = ensureToastRoot();
  const type = opts.type || "info";
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.innerHTML = `<span class="toast-icon">${opts.icon || ICONS[type] || ICONS.info}</span><span class="toast-msg"></span>`;
  el.querySelector(".toast-msg").textContent = msg;
  root.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  const life = opts.duration || 3200;
  const dismiss = () => {
    el.classList.remove("show");
    el.classList.add("hide");
    setTimeout(() => el.remove(), 320);
  };
  const timer = setTimeout(dismiss, life);
  el.addEventListener("click", () => { clearTimeout(timer); dismiss(); });
  return el;
}

/** The "priority" confirmation — every save action gets one of these. */
export function savedToast(what = "Changes") {
  showToast(`${what} saved`, { type: "success" });
}

function notifKey(uid) { return `vb-notifications-${uid}`; }
function loadNotifs(uid) { try { return JSON.parse(localStorage.getItem(notifKey(uid))) || []; } catch { return []; } }
function saveNotifs(uid, list) { localStorage.setItem(notifKey(uid), JSON.stringify(list.slice(0, 30))); }

function timeAgo(ts) {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
}

function addNotification(uid, notif) {
  const list = loadNotifs(uid);
  list.unshift({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, read: false, at: Date.now(), ...notif });
  saveNotifs(uid, list);
  renderBell(uid);
}

/** Renders the bell + dropdown into #notif-mount, if the current page has one. Safe to call repeatedly. */
export function renderBell(uid) {
  const mount = document.querySelector("#notif-mount");
  if (!mount) return;
  const list = loadNotifs(uid);
  const unread = list.filter(n => !n.read).length;

  mount.innerHTML = `
    <button id="notif-bell-btn" class="notif-bell" type="button" aria-label="Notifications" aria-expanded="false">
      <span class="notif-bell-icon">&#128276;</span>
      ${unread ? `<span class="notif-badge">${unread > 9 ? "9+" : unread}</span>` : ""}
    </button>
    <div id="notif-panel" class="notif-panel">
      <div class="notif-panel-head">
        <span>Notifications</span>
        <button id="notif-clear" type="button" class="notif-clear-btn" ${list.length ? "" : "disabled"}>Clear all</button>
      </div>
      <div class="notif-list">
        ${list.length ? list.map(n => `
          <a class="notif-item ${n.read ? "" : "unread"}" href="${n.href || "#"}" data-id="${n.id}">
            <span class="notif-item-icon">${n.icon || "&#10022;"}</span>
            <span class="notif-item-body">
              <span class="notif-item-title" data-title></span>
              <span class="notif-item-time">${timeAgo(n.at)}</span>
            </span>
          </a>`).join("") : `<p class="notif-empty">Nothing yet — outbid alerts, new messages, and matching listings will show up here.</p>`}
      </div>
    </div>`;

  // Titles are set as text (not interpolated into the template) so a member's stored
  // name can never be read back as HTML.
  list.forEach(n => {
    const t = mount.querySelector(`[data-id="${n.id}"] [data-title]`);
    if (t) t.textContent = n.title;
  });

  const btn = mount.querySelector("#notif-bell-btn");
  const panel = mount.querySelector("#notif-panel");
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const opening = !panel.classList.contains("open");
    panel.classList.toggle("open", opening);
    btn.setAttribute("aria-expanded", String(opening));
    if (opening && unread) {
      setTimeout(() => {
        saveNotifs(uid, loadNotifs(uid).map(n => ({ ...n, read: true })));
        const badge = mount.querySelector(".notif-badge");
        if (badge) badge.remove();
      }, 900);
    }
  });
  document.addEventListener("click", (e) => {
    if (!mount.contains(e.target)) panel.classList.remove("open");
  });
  const clearBtn = mount.querySelector("#notif-clear");
  if (clearBtn) clearBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    saveNotifs(uid, []);
    renderBell(uid);
  });
}

// Kept live so a page can call watchForNewItemMatches(...) again after the
// member edits their saved search mid-session (e.g. Save filters) without
// stacking a second Firestore listener — only one listener per tab.
let watcherArmed = false;
let latestPrefs = null;

/**
 * Live-watches new auction listings for the rest of this tab's session and raises
 * a match notification (in-app bell + toast, plus a real browser Notification if
 * permitted) the moment a listing goes up that fits the signed-in member's saved
 * search filters (price range, category, condition).
 */
export function watchForNewItemMatches(uid, myPrefs) {
  latestPrefs = myPrefs;
  if (!hasPreferences(myPrefs) || watcherArmed) return;
  watcherArmed = true;

  if (!sessionStorage.getItem(SESSION_KEY)) sessionStorage.setItem(SESSION_KEY, String(Date.now()));
  const sessionStart = Number(sessionStorage.getItem(SESSION_KEY));

  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission().catch(() => {});
  }

  let seen;
  try { seen = new Set(JSON.parse(sessionStorage.getItem(SEEN_KEY)) || []); } catch { seen = new Set(); }

  onSnapshot(query(collection(db, "items")), (snap) => {
    snap.docChanges().forEach((change) => {
      if (change.type !== "added") return;
      const d = change.doc;
      if (seen.has(d.id)) return;
      const data = d.data();
      if (data.ownerUid === uid) return; // don't notify someone about their own new listing
      const createdMs = typeof data.createdAt === "number" ? data.createdAt : (data.createdAt?.toMillis ? data.createdAt.toMillis() : 0);
      if (!createdMs || createdMs < sessionStart - 2 * 60 * 1000) return;
      seen.add(d.id);
      sessionStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));

      const score = matchScore(latestPrefs, { ...data, id: d.id });
      if (score <= 0) return;

      const name = data.title || "A new item";
      addNotification(uid, { title: `${name} just listed and fits your search`, icon: "&#10022;", href: "browse.html" });
      showToast(`New match: ${name} fits your search`, { type: "match", duration: 4400 });

      if ("Notification" in window && Notification.permission === "granted") {
        try {
          new Notification("VeusBid — new match", {
            body: `${name} just listed and fits your search filters.`,
            icon: "icon-192.png"
          });
        } catch { /* some browsers restrict this — the in-app toast/bell still cover it */ }
      }
    });
  });
}

// Kept live for the same reason as the watcher above.
let outbidWatcherArmed = false;
const SEEN_OUTBID_KEY = "vb-seen-outbid";

/**
 * Live-watches every auction item this member is currently the highest
 * bidder on, and raises a notification the instant currentBidderUid changes
 * away from them — the core "you've been outbid" alert an auction platform
 * needs. Fires for the rest of this tab's session.
 */
export function watchForOutbid(uid) {
  if (outbidWatcherArmed) return;
  outbidWatcherArmed = true;

  let seen;
  try { seen = new Map(JSON.parse(sessionStorage.getItem(SEEN_OUTBID_KEY)) || []); } catch { seen = new Map(); }

  const q = query(collection(db, "items"), where("everBidUids", "array-contains", uid));
  onSnapshot(q, (snap) => {
    snap.docChanges().forEach((change) => {
      if (change.type === "removed") return;
      const data = change.doc.data();
      const id = change.doc.id;
      if (!data.currentBidderUid || data.currentBidderUid === uid) return; // still winning, or no bids
      if (data.endTime && data.endTime <= Date.now()) return; // auction already closed — that's a "you won/lost", not an outbid

      const already = seen.get(id);
      const marker = `${data.currentBidderUid}:${data.currentBid}`;
      if (already === marker) return;
      seen.set(id, marker);
      sessionStorage.setItem(SEEN_OUTBID_KEY, JSON.stringify([...seen]));

      const name = data.title || "an item";
      addNotification(uid, { title: `You've been outbid on ${name} — now at $${Number(data.currentBid).toLocaleString()}`, icon: "&#9889;", href: `item.html?id=${id}` });
      showToast(`Outbid on ${name}!`, { type: "outbid", duration: 5000 });

      if ("Notification" in window && Notification.permission === "granted") {
        try {
          new Notification("VeusBid — you've been outbid", {
            body: `Someone outbid you on ${name}. Current bid: $${Number(data.currentBid).toLocaleString()}.`,
            icon: "icon-192.png"
          });
        } catch { /* some browsers restrict this */ }
      }
    });
  });
}

// Kept live for the same reason as the watchers above.
let soldWatcherArmed = false;
const SEEN_SOLD_KEY = "vb-seen-sold";

/**
 * Live-watches items this member owns for one flipping from live to ended
 * with a winning bid, and nudges them to reach out — a client-only app has
 * no server-side cron to fire this the instant the clock actually hits
 * zero, so it catches up next time the seller has any page open, same
 * best-effort shape as the other watchers here.
 */
export function watchForSoldItems(uid) {
  if (soldWatcherArmed) return;
  soldWatcherArmed = true;

  let seen;
  try { seen = new Set(JSON.parse(localStorage.getItem(SEEN_SOLD_KEY)) || []); } catch { seen = new Set(); }

  const q = query(collection(db, "items"), where("ownerUid", "==", uid));
  onSnapshot(q, (snap) => {
    snap.docs.forEach((d) => {
      const data = d.data();
      const id = d.id;
      if (seen.has(id)) return;
      if (!data.endTime || data.endTime > Date.now()) return; // still live
      if (!data.currentBidderUid || !(data.bidCount > 0)) return; // ended with no winner
      seen.add(id);
      localStorage.setItem(SEEN_SOLD_KEY, JSON.stringify([...seen]));

      const name = data.title || "your listing";
      addNotification(uid, { title: `${name} sold to ${data.currentBidderName || "a bidder"} — message them for delivery details`, icon: "&#127942;", href: `item.html?id=${id}` });
      showToast(`Sold: ${name} — reach out to arrange delivery`, { type: "match", duration: 4400 });
    });
  }, err => console.error("watchForSoldItems listener failed:", err));
}

// Kept live for the same reason as the watchers above.
let endingSoonWatcherArmed = false;
const SEEN_ENDING_KEY = "vb-seen-ending-soon";

/**
 * Live-watches items this member is watching (savedItems) or currently
 * bidding on, and raises a one-time "ending soon" alert once an item drops
 * under 5 minutes remaining — so a close final bid isn't missed while
 * browsing elsewhere in the app.
 */
export function watchForEndingSoon(uid, watchIds) {
  if (endingSoonWatcherArmed || !watchIds || !watchIds.length) return;
  endingSoonWatcherArmed = true;

  let seen;
  try { seen = new Set(JSON.parse(sessionStorage.getItem(SEEN_ENDING_KEY)) || []); } catch { seen = new Set(); }

  const check = async () => {
    for (const id of watchIds) {
      if (seen.has(id)) continue;
      try {
        const snap = await getDoc(doc(db, "items", id));
        if (!snap.exists()) continue;
        const data = snap.data();
        if (!data.endTime) continue;
        const diff = data.endTime - Date.now();
        if (diff > 0 && diff < 5 * 60 * 1000) {
          seen.add(id);
          sessionStorage.setItem(SEEN_ENDING_KEY, JSON.stringify([...seen]));
          addNotification(uid, { title: `${data.title || "An item"} you're watching ends in under 5 minutes`, icon: "&#9203;", href: `item.html?id=${id}` });
          showToast(`Ending soon: ${data.title || "an item"}`, { type: "match", duration: 4400 });
        }
      } catch { /* best-effort */ }
    }
  };
  check();
  setInterval(check, 30000);
}

/** Call once per authenticated page, right after load(): renders the bell and arms the live watchers. */
export function initNotifications(uid, myPrefs, watchIds) {
  renderBell(uid);
  watchForNewItemMatches(uid, myPrefs);
  watchForOutbid(uid);
  if (watchIds) watchForEndingSoon(uid, watchIds);
  watchForNewResponses(uid);
  watchForListingFeedback(uid);
  watchForSoldItems(uid);
}

// Kept live for the same reason as the other watchers above.
let feedbackWatcherArmed = false;
const FEEDBACK_SESSION_KEY = "vb-feedback-session-start";
const SEEN_FEEDBACK_KEY = "vb-seen-feedback";

/**
 * Live-watches the `feedback` collection (see item.js's quick-feedback
 * chips on an item's detail view) for docs on a listing this member owns,
 * and raises a notification the moment a new one lands, for the rest of
 * this tab's session — same pattern as watchForNewResponses, just filtered
 * by `ownerUid` instead of `participants`.
 */
export function watchForListingFeedback(uid) {
  if (feedbackWatcherArmed) return;
  feedbackWatcherArmed = true;

  if (!sessionStorage.getItem(FEEDBACK_SESSION_KEY)) sessionStorage.setItem(FEEDBACK_SESSION_KEY, String(Date.now()));
  const sessionStart = Number(sessionStorage.getItem(FEEDBACK_SESSION_KEY));

  let seen;
  try { seen = new Set(JSON.parse(sessionStorage.getItem(SEEN_FEEDBACK_KEY)) || []); } catch { seen = new Set(); }

  const q = query(collection(db, "feedback"), where("ownerUid", "==", uid));
  onSnapshot(q, (snap) => {
    snap.docChanges().forEach((change) => {
      if (change.type !== "added") return;
      if (seen.has(change.doc.id)) return;
      seen.add(change.doc.id);
      sessionStorage.setItem(SEEN_FEEDBACK_KEY, JSON.stringify([...seen]));

      const f = change.doc.data();
      const createdMs = f.createdAt?.toMillis ? f.createdAt.toMillis() : 0;
      if (!createdMs || createdMs < sessionStart - 2 * 60 * 1000) return;

      addNotification(uid, { title: `New feedback on ${f.itemName || "your listing"}: "${f.text}"`, icon: "&#10024;", href: "listings.html" });
      showToast(`\u2728 New feedback on ${f.itemName || "your listing"}`, { type: "match", duration: 4400 });
    });
  });
}

// Kept live for the same reason as watcherArmed above — only one listener
// per tab, safe to call initNotifications() again mid-session.
let msgWatcherArmed = false;
const senderProfileCache = new Map(); // uid -> {name, photoURL}, so a busy conversation doesn't re-fetch per message

/**
 * Looks up the sender info we already stashed on a past message notification
 * for `otherUid`, if any — most recent first. Lets messages.html paint a
 * conversation's header (name + photo) the instant a notification is tapped.
 */
export function getCachedSenderProfile(myUid, otherUid) {
  const list = loadNotifs(myUid);
  const hit = list.find(n => n.data?.uid === otherUid);
  return hit ? { name: hit.data.name, photoURL: hit.data.photoURL } : null;
}

/**
 * Live-watches this member's message threads for the rest of this tab's session
 * and raises a notification (in-app bell + toast, plus a real browser
 * Notification if permitted) the moment someone "reaches out" — whether
 * that's the *first* message in a brand-new thread they started, or a
 * *reply* back after this member messaged them first.
 */
export function watchForNewResponses(uid) {
  if (msgWatcherArmed) return;
  msgWatcherArmed = true;

  if (!sessionStorage.getItem(MSG_SESSION_KEY)) sessionStorage.setItem(MSG_SESSION_KEY, String(Date.now()));
  const sessionStart = Number(sessionStorage.getItem(MSG_SESSION_KEY));

  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission().catch(() => {});
  }

  let seen;
  try { seen = new Map(JSON.parse(sessionStorage.getItem(SEEN_THREADS_KEY)) || []); } catch { seen = new Map(); }

  const q = query(collection(db, "threads"), where("participants", "array-contains", uid));
  onSnapshot(q, (snap) => {
    let unreadCount = 0;
    snap.forEach((docSnap) => {
      const t = docSnap.data();
      if (!t.lastAt || t.lastFrom === uid) return;
      const lastAtMs = t.lastAt?.toMillis ? t.lastAt.toMillis() : 0;
      const readMs = t.lastRead?.[uid]?.toMillis ? t.lastRead[uid].toMillis() : 0;
      if (!readMs || readMs < lastAtMs) unreadCount++;
    });
    setMessagesBadge(unreadCount);

    snap.docChanges().forEach((change) => {
      if (change.type === "removed") return;
      const data = change.doc.data();
      if (!data.lastFrom || data.lastFrom === uid) return;

      const lastAtMs = data.lastAt?.toMillis ? data.lastAt.toMillis() : 0;
      if (!lastAtMs || lastAtMs < sessionStart - 2 * 60 * 1000) return;

      const already = seen.get(change.doc.id);
      if (already && already >= lastAtMs) return;
      seen.set(change.doc.id, lastAtMs);
      sessionStorage.setItem(SEEN_THREADS_KEY, JSON.stringify([...seen]));

      const otherUid = data.lastFrom;
      const threadId = change.doc.id;
      const announce = ({ name, photoURL }) => {
        addNotification(uid, {
          title: `${name} sent you a message`,
          icon: "&#128172;",
          href: `messages.html?uid=${encodeURIComponent(otherUid)}&tid=${encodeURIComponent(threadId)}`,
          data: { uid: otherUid, name, photoURL: photoURL || "" }
        });
        showToast(`New message from ${name}`, { type: "match", duration: 4400 });
        if ("Notification" in window && Notification.permission === "granted") {
          try {
            new Notification("VeusBid — new message", {
              body: `${name} sent you a message.`,
              icon: "icon-192.png"
            });
          } catch { /* some browsers restrict this */ }
        }
      };

      if (senderProfileCache.has(otherUid)) {
        announce(senderProfileCache.get(otherUid));
      } else {
        getDoc(doc(db, "users", otherUid)).then(userSnap => {
          const u = userSnap.data() || {};
          const profile = { name: u.name || "Someone", photoURL: u.photoURL || "" };
          senderProfileCache.set(otherUid, profile);
          announce(profile);
        }).catch(() => announce({ name: "Someone", photoURL: "" }));
      }
    });
  });
}
