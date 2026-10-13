// ============================================================
// Autofill guard — stops the browser (and password managers) from dropping
// a saved email or password into fields that were never meant to hold one:
// display name, phone, search bars, bid amounts, PIN boxes, "type DELETE",
// the current-password box inside Danger zone, and so on.
//
// Browsers decide what to fill using heuristics ("first text box before a
// password box must be the username"), and autocomplete="off" alone is
// routinely ignored. So this stacks several independent defences:
//
//   1. autocomplete="off" on text-like fields; "new-password" on password
//      fields (the one value browsers honour for "don't fill a saved one").
//   2. Password-manager opt-out hints (LastPass, 1Password, Bitwarden, Dashlane).
//   3. A throw-away `name`, so name-based matching has nothing to latch onto.
//   4. "Read-only until touched": the field can't be filled while idle, and
//      unlocks on the first tap / click / keypress / focus.
//   5. A tripwire: if a browser fills one anyway (it shows up as
//      :-webkit-autofill / :autofill), the value is wiped before the person sees it
//      — unless they've already typed in that field themselves.
//
// The only fields left alone are the ones that genuinely want it: anything
// marked data-autofill="allow" (the real log-in email + password).
// Runs automatically on every page that imports common.js, and keeps
// watching for fields built later (chat modals, the bid form rebuild, etc.).
// ============================================================

const SKIP_TYPES = new Set(["checkbox", "radio", "range", "file", "hidden", "button", "submit", "reset", "image", "color"]);
const READONLY_TYPES = new Set(["text", "search", "email", "tel", "url", "password"]);
let started = false;

function isAllowed(el) {
  return el.matches("[data-autofill='allow']");
}

function randomSuffix() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0].toString(36);
}

/** Applies every defence to one field. Safe to call repeatedly. */
export function guardField(el) {
  if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) return;
  if (el.dataset.vbGuarded === "1") return;
  const type = (el.getAttribute("type") || "text").toLowerCase();
  if (SKIP_TYPES.has(type) || isAllowed(el)) return;
  el.dataset.vbGuarded = "1";

  // 1. autocomplete — passwords get "new-password" so no saved one is injected.
  el.setAttribute("autocomplete", type === "password" ? "new-password" : "off");

  // 2. password-manager opt-outs
  el.setAttribute("data-lpignore", "true");   // LastPass
  el.setAttribute("data-1p-ignore", "true");  // 1Password
  el.setAttribute("data-bwignore", "true");   // Bitwarden
  el.setAttribute("data-form-type", "other"); // Dashlane

  // 3. a name nothing will recognise (ids are what the app's own code uses)
  el.setAttribute("name", `vb-${el.id || "field"}-${randomSuffix()}`);
  if (type === "search") el.setAttribute("autocapitalize", "off");

  // 4. read-only until touched
  if (el instanceof HTMLInputElement && READONLY_TYPES.has(type) && document.activeElement !== el) {
    el.readOnly = true;
    const unlock = () => {
      el.readOnly = false;
      ["pointerdown", "touchstart", "mousedown", "keydown", "focus"].forEach(ev => el.removeEventListener(ev, unlock, true));
    };
    ["pointerdown", "touchstart", "mousedown", "keydown", "focus"].forEach(ev => el.addEventListener(ev, unlock, true));
  }

  // Remember whether a *person* has typed here, so the tripwire never eats real input.
  const markTyped = () => { el.dataset.vbTyped = "1"; };
  el.addEventListener("keydown", markTyped);
  el.addEventListener("paste", markTyped);
  el.addEventListener("beforeinput", markTyped);
}

export function guardAutofill(root = document) {
  root.querySelectorAll("input, textarea").forEach(guardField);
}

// 5. Tripwire — CSS fires an animation the instant a browser autofills a field.
function injectTripwireCss() {
  if (document.getElementById("vb-autofill-guard-css")) return;
  const style = document.createElement("style");
  style.id = "vb-autofill-guard-css";
  style.textContent = `
    @keyframes vb-autofill-hit { from { opacity: 1; } to { opacity: 1; } }
    input:-webkit-autofill { animation-name: vb-autofill-hit; animation-duration: 1ms; }
  `;
  document.head.appendChild(style);
  const style2 = document.createElement("style");
  style2.textContent = `input:autofill { animation-name: vb-autofill-hit; animation-duration: 1ms; }`;
  document.head.appendChild(style2);
}

function onAutofillHit(e) {
  if (e.animationName !== "vb-autofill-hit") return;
  const el = e.target;
  if (!(el instanceof HTMLInputElement)) return;
  if (el.dataset.vbGuarded !== "1" || el.dataset.vbTyped === "1") return;
  // The browser filled a field that should be empty. Wipe it and tell the app.
  el.value = "";
  el.dispatchEvent(new Event("input", { bubbles: true }));
  // Chrome sometimes fills again a beat later; sweep once more.
  setTimeout(() => { if (el.dataset.vbTyped !== "1" && el.matches(":-webkit-autofill, :autofill")) el.value = ""; }, 400);
}

export function initAutofillGuard() {
  if (started) return;
  started = true;
  const boot = () => {
    injectTripwireCss();
    guardAutofill(document);
    document.addEventListener("animationstart", onAutofillHit, true);
    new MutationObserver(muts => {
      for (const m of muts) {
        m.addedNodes.forEach(n => {
          if (n.nodeType !== 1) return;
          if (n.matches?.("input, textarea")) guardField(n);
          n.querySelectorAll?.("input, textarea").forEach(guardField);
        });
      }
    }).observe(document.body, { childList: true, subtree: true });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
}
