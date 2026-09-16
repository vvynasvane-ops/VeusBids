// Renders the same nav everywhere. On wide screens it's a sticky
// horizontal row under the top bar (#nav-mount — see the @media block in
// styles.css). On narrow screens that row is hidden outright; the same
// items instead live in an off-canvas left sidebar (#veus-sidebar),
// opened via a hamburger button (#menu-btn) that each page's topbar
// carries. That replaces what used to be a second sticky row (or a fixed
// bottom bar) stacked under the sticky .topbar — on phones that combo
// left almost nothing on screen for the actual page content.

const ITEMS = [
  { id: "browse", href: "browse.html", label: "Browse", icon: "⌕" },
  { id: "messages", href: "messages.html", label: "Messages", icon: "✉" },
  { id: "profile", href: "listings.html", label: "My Listings", icon: "⬡" },
  { id: "settings", href: "settings.html", label: "Theme", icon: "☰" }
];

// The unread-message badge is driven by a live Firestore listener in
// notifications.js (watchForNewResponses), which can call setMessagesBadge()
// from any page, at any time — including before renderNav() has painted
// anything on a slow connection. Keeping the last known count here (not just
// in the DOM) means whichever happens first — the listener firing or the
// nav painting — the badge still ends up correct instead of racing. There
// are now two badge elements per page (top row + sidebar), so paintBadge()
// updates every ".js-msg-badge" it finds rather than a single id.
let lastCount = 0;

/** Call once per page load to paint the nav (top row + sidebar). */
export function renderNav(activeId) {
  renderTopRow(activeId);
  renderSidebar(activeId);
  wireMenuButton();
  paintBadge();
  syncTopbarHeightVar();
}

function renderTopRow(activeId) {
  const mount = document.querySelector("#nav-mount");
  if (!mount) return;
  mount.innerHTML = `<nav class="appnav">${ITEMS.map(item => navLinkHtml(item, activeId, false)).join("")}</nav>`;
}

function navLinkHtml(item, activeId, sidebar) {
  const cls = sidebar ? "veus-sidebar-item" : "appnav-item";
  return `
    <a class="${cls} ${item.id === activeId ? "active" : ""}" href="${item.href}">
      <span class="appnav-icon-wrap">
        <span class="appnav-icon">${item.icon}</span>
        ${item.id === "messages" ? `<span class="appnav-badge js-msg-badge" hidden></span>` : ""}
      </span>
      <span class="appnav-label">${item.label}</span>
    </a>`;
}

/**
 * Builds (once) or repaints the off-canvas sidebar + its backdrop, both
 * appended directly to <body> so they sit above everything regardless of
 * which page's markup calls this. Safe to call on every renderNav(): if
 * the sidebar already exists this just refreshes its active item and
 * (re)wires the logout mirror, instead of double-appending.
 */
function renderSidebar(activeId) {
  let sidebar = document.querySelector("#veus-sidebar");
  let overlay = document.querySelector("#veus-sidebar-overlay");

  if (!sidebar) {
    overlay = document.createElement("div");
    overlay.id = "veus-sidebar-overlay";
    overlay.className = "veus-sidebar-overlay";
    document.body.appendChild(overlay);

    sidebar = document.createElement("aside");
    sidebar.id = "veus-sidebar";
    sidebar.className = "veus-sidebar";
    document.body.appendChild(sidebar);

    overlay.addEventListener("click", closeSidebar);
    document.addEventListener("keydown", e => { if (e.key === "Escape") closeSidebar(); });
    // A resize past the phone breakpoint (rotating a tablet, resizing a
    // browser window) shouldn't leave the drawer stranded open with no
    // hamburger left to close it — #menu-btn is display:none above 720px.
    window.addEventListener("resize", () => { if (window.innerWidth > 720) closeSidebar(); });
  }

  const logoutBtn = document.querySelector("#logout-btn");
  sidebar.innerHTML = `
    <div class="veus-sidebar-head">
      <span class="veus-sidebar-brand">Veus<em>Bid</em></span>
      <button type="button" class="veus-sidebar-close" aria-label="Close menu">&times;</button>
    </div>
    <nav class="veus-sidebar-nav">${ITEMS.map(item => navLinkHtml(item, activeId, true)).join("")}</nav>
    ${logoutBtn ? `<div class="veus-sidebar-foot"><button type="button" id="sidebar-logout-btn" class="btn ghost small block">Log out</button></div>` : ""}
  `;

  sidebar.querySelector(".veus-sidebar-close").addEventListener("click", closeSidebar);
  sidebar.querySelectorAll(".veus-sidebar-item").forEach(a => a.addEventListener("click", closeSidebar));
  const sidebarLogout = sidebar.querySelector("#sidebar-logout-btn");
  if (sidebarLogout && logoutBtn) sidebarLogout.addEventListener("click", () => logoutBtn.click());
}

function wireMenuButton() {
  const btn = document.querySelector("#menu-btn");
  // dataset guard: renderNav() can run more than once on some pages
  // (e.g. after a re-auth), and re-adding the same listener would open
  // the sidebar and immediately re-close it on a single tap.
  if (!btn || btn.dataset.wired) return;
  btn.dataset.wired = "1";
  btn.addEventListener("click", () => {
    const isOpen = btn.getAttribute("aria-expanded") === "true";
    if (isOpen) closeSidebar(); else openSidebar();
  });
}

function openSidebar() {
  document.querySelector("#veus-sidebar")?.classList.add("open");
  document.querySelector("#veus-sidebar-overlay")?.classList.add("open");
  document.querySelector("#menu-btn")?.setAttribute("aria-expanded", "true");
  document.body.style.overflow = "hidden";
}

function closeSidebar() {
  document.querySelector("#veus-sidebar")?.classList.remove("open");
  document.querySelector("#veus-sidebar-overlay")?.classList.remove("open");
  document.querySelector("#menu-btn")?.setAttribute("aria-expanded", "false");
  document.body.style.overflow = "";
}

// The nav row sticks directly under the top bar (see #nav-mount in
// styles.css, which reads --topbar-h). The top bar's real height shifts
// with font-size/weight settings and viewport width, so it's measured
// live rather than hardcoded — kept in sync on load and on resize.
function syncTopbarHeightVar() {
  const topbar = document.querySelector(".topbar");
  if (!topbar) return;
  const set = () => document.documentElement.style.setProperty("--topbar-h", `${topbar.offsetHeight}px`);
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
  document.querySelectorAll(".js-msg-badge").forEach(el => {
    if (lastCount > 0) {
      el.hidden = false;
      el.textContent = lastCount > 9 ? "9+" : String(lastCount);
    } else {
      el.hidden = true;
    }
  });
}
