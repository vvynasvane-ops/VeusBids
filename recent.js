// "Recently viewed" — a small per-account, per-device list of the last few
// listings someone opened, kept in localStorage (never sent to Firestore).
// item.js records a visit; browse.js shows the strip. Every access is wrapped
// in try/catch because storage can be blocked (private mode) or full.

const MAX = 10;
const key = uid => `vb-recent:${uid}`;

export function getRecent(uid) {
  try {
    const arr = JSON.parse(localStorage.getItem(key(uid)) || "[]");
    return Array.isArray(arr) ? arr.filter(x => typeof x === "string") : [];
  } catch { return []; }
}

export function rememberViewed(uid, itemId) {
  if (!uid || !itemId) return;
  try {
    const next = [itemId, ...getRecent(uid).filter(id => id !== itemId)].slice(0, MAX);
    localStorage.setItem(key(uid), JSON.stringify(next));
  } catch { /* storage unavailable — the strip just stays empty */ }
}

export function clearRecent(uid) {
  try { localStorage.removeItem(key(uid)); } catch { /* ignore */ }
}
