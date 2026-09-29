// Renders the same 4-item nav everywhere: a sticky row directly under the
// top bar on wide screens, redocking to a fixed bottom bar, edge to edge,
// on narrow ones — see the @media block in styles.css. One source of truth
// so every page stays in sync automatically.

// Inline SVG icons (stroke = currentColor) instead of Unicode glyphs: the old
// ⌕ ✉ ⬡ ☰ characters render at different sizes/weights on every device font.
const svg = inner => `<svg class="appnav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
const ICONS = {
  browse: svg(`<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>`),
  messages: svg(`<path d="M5 4.5h14a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5h-8.5L6 20v-3.5H5A1.5 1.5 0 0 1 3.5 15V6A1.5 1.5 0 0 1 5 4.5z"/>`),
  profile: svg(`<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>`),
  settings: svg(`<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>`)
};

const ITEMS = [
  { id: "browse", href: "browse.html", label: "Browse", icon: ICONS.browse },
  { id: "messages", href: "messages.html", label: "Messages", icon: ICONS.messages },
  { id: "profile", href: "listings.html", label: "My Listings", icon: ICONS.profile },
  { id: "settings", href: "settings.html", label: "Theme", icon: ICONS.settings }
];

// The unread-message badge is driven by a live Firestore listener in
// notifications.js (watchForNewResponses), which can call setMessagesBadge()
// from any page, at any time — including before renderNav() has painted
// anything on a slow connection. Keeping the last known count here (not just
// in the DOM) means whichever happens first — the listener firing or the
// nav painting — the badge still ends up correct instead of racing.
let lastCount = 0;

/** Call once per page load to paint the nav. */
export function renderNav(activeId) {
  const mount = document.querySelector("#nav-mount");
  if (!mount) return;
  mount.innerHTML = `<nav class="appnav">${ITEMS.map(item => `
    <a class="appnav-item ${item.id === activeId ? "active" : ""}" href="${item.href}">
      <span class="appnav-icon-wrap">
        ${item.icon}
        ${item.id === "messages" ? `<span id="appnav-msg-badge" class="appnav-badge" hidden></span>` : ""}
      </span>
      <span class="appnav-label">${item.label}</span>
    </a>`).join("")}</nav>`;
  paintBadge();
  syncTopbarHeightVar();
}

// The nav row sticks directly under the top bar (see #nav-mount in
// styles.css, which reads --topbar-h). The top bar's real height shifts
// with font-size/weight settings and viewport width, so it's measured
// live rather than hardcoded — kept in sync on load and on resize.
function syncTopbarHeightVar() {
  const topbar = document.querySelector(".topbar");
  if (!topbar) return;
  const set = () => document.documentElement.style.setProperty("--topbar-h", `${Math.floor(topbar.getBoundingClientRect().height)}px`);
  set();
  window.addEventListener("resize", set);
  if (window.ResizeObserver) new ResizeObserver(set).observe(topbar);
}

/**
 * Sets the live "new messages" count on the Messages nav item, from any page.
 * Safe to call before renderNav() has mounted anything, or on a page with no
 * #nav-mount at all — the count is kept either way so the next renderNav()
 * paints it correctly. This is what keeps Messages "always pinging for new":
 * the badge is wired to notifications.js's live thread listener, not to a
 * one-time check, so it updates in real time on whichever page is open.
 */
export function setMessagesBadge(count) {
  lastCount = count;
  paintBadge();
}

function paintBadge() {
  const el = document.querySelector("#appnav-msg-badge");
  if (!el) return;
  if (lastCount > 0) {
    el.hidden = false;
    el.textContent = lastCount > 9 ? "9+" : String(lastCount);
  } else {
    el.hidden = true;
  }
}
