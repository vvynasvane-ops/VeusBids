// ============================================================
// Password tools — everything around *creating* a password:
//
//   attachPasswordTools(input, { confirmInput })
//       Adds a live strength meter, a "Generate strong password" button, a
//       Copy button, and (with confirmInput) a live "passwords match" check.
//
//   showPasswordOnce(password, { title, note })
//       Shows the password someone just created in a private sheet — masked,
//       with press-and-hold / tap to reveal, and Copy — right after sign-up
//       or a password change, so they can confirm what they set and save it
//       in their own password manager.
//
// Why "once": Firebase only ever stores a one-way hash of a password, so
// it can't be read back later — by us, by an admin, or by anyone who gets
// into the account. That is the safe design, and this file keeps to it:
// the password lives only in a JS variable until the sheet closes, is never
// written to localStorage / Firestore / the URL, and is wiped on close.
// ============================================================

import { escapeHtml } from "./common.js";
import { showToast } from "./notifications.js";

const LOWER = "abcdefghijkmnopqrstuvwxyz";   // no l
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";     // no I, O
const DIGITS = "23456789";                    // no 0, 1
const SYMBOLS = "!@#$%^&*-_=+?";
const COMMON = ["password", "123456", "qwerty", "letmein", "welcome", "admin", "iloveyou", "abc123", "veusbid", "monkey", "dragon"];

/** Unbiased random integer in [0, max) using crypto (rejection sampling). */
function randInt(max) {
  const limit = Math.floor(0x100000000 / max) * max;
  const buf = new Uint32Array(1);
  do { crypto.getRandomValues(buf); } while (buf[0] >= limit);
  return buf[0] % max;
}

/** A strong random password that always contains each character class.
 * Skips look-alike characters (l/1/I, O/0) so it can be read off the screen
 * and typed on another device without mistakes. */
export function generatePassword(length = 16) {
  const all = LOWER + UPPER + DIGITS + SYMBOLS;
  const chars = [
    LOWER[randInt(LOWER.length)], UPPER[randInt(UPPER.length)],
    DIGITS[randInt(DIGITS.length)], SYMBOLS[randInt(SYMBOLS.length)]
  ];
  while (chars.length < length) chars.push(all[randInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) { // Fisher–Yates shuffle
    const j = randInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

/** Rough strength score 0–4 plus one short tip. Local only — nothing is sent anywhere. */
export function scorePassword(pw) {
  if (!pw) return { score: 0, label: "", tip: "" };
  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/\d/.test(pw)) pool += 10;
  if (/[^A-Za-z0-9]/.test(pw)) pool += 32;
  let bits = pw.length * Math.log2(pool || 1);
  const lower = pw.toLowerCase();
  if (COMMON.some(c => lower.includes(c))) bits -= 25;
  if (/(.)\1{2,}/.test(pw)) bits -= 8;
  if (/(0123|1234|2345|3456|4567|5678|6789|abcd|bcde|qwer|asdf)/i.test(pw)) bits -= 10;
  let score = bits < 30 ? 1 : bits < 45 ? 2 : bits < 65 ? 3 : 4;
  if (pw.length < 12) score = Math.min(score, 3); // length matters most — "Strong" needs 12+
  if (pw.length < 6) score = 1;
  const labels = ["", "Weak", "Fair", "Good", "Strong"];
  let tip = "";
  if (score <= 2) {
    if (pw.length < 12) tip = "Try 12+ characters.";
    else if (!/[^A-Za-z0-9]/.test(pw)) tip = "Add a symbol or two.";
    else tip = "Avoid common words and patterns.";
  } else if (score === 3 && pw.length < 12) tip = "A few more characters makes it Strong.";
  return { score, label: labels[score], tip };
}

/** Copies a secret, then clears the clipboard after 30s if it still holds that secret. */
export async function copySecret(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    showToast("Couldn't copy automatically — reveal it and copy by hand.", { type: "error" });
    return false;
  }
  showToast("Copied — clipboard clears in 30 seconds.", { type: "success" });
  setTimeout(async () => {
    try {
      const now = await navigator.clipboard.readText();
      if (now === text) await navigator.clipboard.writeText("");
    } catch { /* no permission to read back — leave it */ }
  }, 30000);
  return true;
}

/**
 * Wires the creation helpers under a password input. Call addPasswordToggle()
 * on the input first (so the eye button + Caps Lock hint exist); this adds the rest.
 * Returns { setVisible(bool), reset() } so the sign-up form can show the tools
 * only while it's in "Sign up" mode.
 */
export function attachPasswordTools(input, { confirmInput = null } = {}) {
  if (!input || input.dataset.pwToolsAttached) return { setVisible() {}, reset() {} };
  input.dataset.pwToolsAttached = "1";

  const box = document.createElement("div");
  box.className = "pw-tools";
  box.innerHTML = `
    <div class="pw-meter" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
    <div class="pw-meter-row">
      <span class="pw-meter-label" aria-live="polite"></span>
      <span class="pw-meter-tip"></span>
    </div>
    <div class="pw-tools-actions">
      <button type="button" class="btn subtle small" data-act="gen">&#10024; Generate strong password</button>
      <button type="button" class="btn ghost small" data-act="copy" hidden>Copy</button>
    </div>
    <p class="field-hint pw-match" hidden></p>`;
  // Sit after the field wrapper (and its caps-lock hint, if present).
  const anchor = input.closest(".pw-field")?.nextElementSibling?.classList.contains("pw-caps")
    ? input.closest(".pw-field").nextElementSibling
    : (input.closest(".pw-field") || input);
  anchor.insertAdjacentElement("afterend", box);

  const bars = [...box.querySelectorAll(".pw-meter span")];
  const label = box.querySelector(".pw-meter-label");
  const tipEl = box.querySelector(".pw-meter-tip");
  const copyBtn = box.querySelector('[data-act="copy"]');
  const matchEl = box.querySelector(".pw-match");

  function refresh() {
    const { score, label: text, tip } = scorePassword(input.value);
    bars.forEach((b, i) => { b.className = i < score ? `on s${score}` : ""; });
    label.textContent = text;
    label.className = `pw-meter-label s${score}`;
    tipEl.textContent = tip;
    copyBtn.hidden = !input.value;
    if (confirmInput) {
      if (!confirmInput.value) matchEl.hidden = true;
      else {
        const ok = confirmInput.value === input.value;
        matchEl.hidden = false;
        matchEl.textContent = ok ? "\u2713 Passwords match" : "Passwords don't match yet";
        matchEl.className = `field-hint pw-match ${ok ? "ok" : "bad"}`;
      }
    }
  }
  input.addEventListener("input", refresh);
  confirmInput?.addEventListener("input", refresh);

  box.querySelector('[data-act="gen"]').addEventListener("click", () => {
    const pw = generatePassword(16);
    input.value = pw;
    if (confirmInput) confirmInput.value = pw;
    input.dataset.vbTyped = "1";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    // Show it (it auto-masks after 15s) so the person can actually see what was made.
    input.dispatchEvent(new Event("vb:show-password"));
    showToast("Strong password generated — copy it before you continue.", { type: "info" });
  });
  copyBtn.addEventListener("click", () => { if (input.value) copySecret(input.value); });

  return {
    setVisible(show) { box.hidden = !show; if (!show) matchEl.hidden = true; },
    reset() { refresh(); }
  };
}

/**
 * Private "here's the password you just created" sheet. Resolves when closed.
 * Masked by default; Show/Hide toggles it, and it re-masks after 15s or when
 * the tab is hidden. The value is dropped from memory on close.
 */
export function showPasswordOnce(password, { title = "Your new password", note = "" } = {}) {
  return new Promise(resolve => {
    let secret = password;
    const wrap = document.createElement("div");
    wrap.className = "chat-modal-backdrop pw-once-backdrop";
    wrap.innerHTML = `
      <div class="chat-modal pw-once" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
        <div class="chat-modal-title">${escapeHtml(title)}</div>
        <div class="chat-modal-body">
          ${note ? escapeHtml(note) + " " : ""}For your safety VeusBid never stores this password in readable form, so this is the only time it can be shown.
          Save it in a password manager now.
        </div>
        <div class="pw-once-box" id="pw-once-value" aria-live="polite"></div>
        <div class="pw-meter-row" style="margin-top:6px;"><span class="pw-meter-label"></span></div>
        <div class="chat-modal-actions" style="flex-wrap:wrap;">
          <button type="button" class="btn ghost small" data-act="toggle">Show</button>
          <button type="button" class="btn subtle small" data-act="copy">Copy</button>
          <button type="button" class="btn small" data-act="done">I've saved it</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);

    const valueEl = wrap.querySelector("#pw-once-value");
    const toggleBtn = wrap.querySelector('[data-act="toggle"]');
    const strengthEl = wrap.querySelector(".pw-meter-label");
    const { score, label } = scorePassword(secret);
    strengthEl.textContent = label ? `Strength: ${label}` : "";
    strengthEl.className = `pw-meter-label s${score}`;

    let shown = false, timer = null;
    const paint = () => {
      valueEl.textContent = shown ? secret : "\u2022".repeat(Math.min(secret.length, 24));
      valueEl.classList.toggle("is-shown", shown);
      toggleBtn.textContent = shown ? "Hide" : "Show";
    };
    const setShown = on => {
      shown = on; clearTimeout(timer);
      if (on) timer = setTimeout(() => setShown(false), 15000);
      paint();
    };
    paint();

    const onVis = () => { if (document.hidden) setShown(false); };
    document.addEventListener("visibilitychange", onVis);
    toggleBtn.addEventListener("click", () => setShown(!shown));
    wrap.querySelector('[data-act="copy"]').addEventListener("click", () => copySecret(secret));
    const close = () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVis);
      secret = ""; valueEl.textContent = "";
      wrap.remove();
      resolve();
    };
    wrap.querySelector('[data-act="done"]').addEventListener("click", close);
  });
}
