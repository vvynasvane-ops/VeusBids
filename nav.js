// Renders the same nav everywhere. On wide screens it's a sticky
// horizontal row under the top bar (#nav-mount — see the @media block in
// styles.css). On narrow screens that row is hidden outright; the same
// items instead live in an off-canvas left sidebar (#veus-sidebar),
// opened via a hamburger button (#menu-btn) that each page's topbar
// carries. That replaces what used to be a second sticky row (or a fixed
// bottom bar) stacked under the sticky .topbar — on phones that combo
// left almost nothing on screen for the actual page content.

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
  mount.innerHTML = `<nav class="appnav"><span class="appnav-glide" aria-hidden="true"></span>${ITEMS.map(item => navLinkHtml(item, activeId, false)).join("")}</nav>`;
  initGlide(mount.querySelector(".appnav"));
}

// The active-tab pill. It starts where it sat on the PREVIOUS page (remembered
// in sessionStorage) and slides to the new tab, so navigating feels continuous
// even though every page is a full reload. Falls back to a plain placement.
const GLIDE_KEY = "veus-nav-glide";
function initGlide(nav) {
  const glide = nav.querySelector(".appnav-glide");
  const place = (animate) => {
    const active = nav.querySelector(".appnav-item.active");
    if (!active) { glide.classList.remove("ready"); return; }
    const to = { x: active.offsetLeft, w: active.offsetWidth };
    let from = null;
    if (animate) { try { from = JSON.parse(sessionStorage.getItem(GLIDE_KEY)); } catch (e) {} }
    const apply = r => { glide.style.width = r.w + "px"; glide.style.transform = `translateX(${r.x}px)`; };
    if (from && typeof from.x === "number" && (from.x !== to.x || from.w !== to.w)) {
      glide.style.transition = "none";
      apply(from);
      glide.classList.add("ready");
      void glide.offsetWidth;            // commit the start position
      glide.style.transition = "";
      requestAnimationFrame(() => apply(to));
    } else {
      glide.style.transition = "none";
      apply(to);
      glide.classList.add("ready");
      void glide.offsetWidth;
      glide.style.transition = "";
    }
    try { sessionStorage.setItem(GLIDE_KEY, JSON.stringify(to)); } catch (e) {}
  };
  place(true);
  // Webfonts / badge / resize can shift tab widths after first paint: re-seat without animating.
  if (window.ResizeObserver) new ResizeObserver(() => place(false)).observe(nav);
  window.addEventListener("resize", () => place(false));
}

function navLinkHtml(item, activeId, sidebar) {
  const cls = sidebar ? "veus-sidebar-item" : "appnav-item";
  return `
    <a class="${cls} ${item.id === activeId ? "active" : ""}" href="${item.href}">
      <span class="appnav-icon-wrap">
        ${item.icon}
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
