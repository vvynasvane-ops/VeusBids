import {
  auth, db, googleProvider, onAuthStateChanged, signInWithPopup,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail,
  doc, setDoc, getDoc, serverTimestamp
} from "./firebase-init.js";
import { loaderBlobHtml, addPasswordToggle } from "./common.js";
import { attachPasswordTools, showPasswordOnce } from "./password-tools.js";
import { showToast } from "./notifications.js";

const form = document.querySelector("#auth-form");
const tabLogin = document.querySelector("#tab-login");
const tabSignup = document.querySelector("#tab-signup");
const nameField = document.querySelector("#name-field");
const submitBtn = document.querySelector("#auth-submit");
const errorBox = document.querySelector("#auth-error");
const forgotLink = document.querySelector("#forgot-link");
const passwordInput = document.querySelector("#password");
const confirmField = document.querySelector("#confirm-field");
const confirmInput = document.querySelector("#password-confirm");
addPasswordToggle(passwordInput);
addPasswordToggle(confirmInput);
// Strength meter, generator, copy, and a live "passwords match" check — shown only while signing up.
const pwTools = attachPasswordTools(passwordInput, { confirmInput });
pwTools.setVisible(false);
let mode = "login";
// True from the moment account creation starts until the "here's your password"
// sheet is dismissed — stops onAuthStateChanged from redirecting underneath it.
let signingUp = false;

/** Where to go after signing in: the page they were trying to reach (shared
 * listing links, for instance) if it's a plain same-site .html page, else Browse. */
function destination() {
  const next = new URLSearchParams(window.location.search).get("next") || "";
  return /^[a-z0-9_-]+\.html(\?[a-zA-Z0-9_=&%.-]*)?$/i.test(next) ? next : "browse.html";
}

function setMode(next) {
  mode = next;
  tabLogin.classList.toggle("active", mode === "login");
  tabSignup.classList.toggle("active", mode === "signup");
  nameField.style.display = mode === "signup" ? "block" : "none";
  confirmField.style.display = mode === "signup" ? "block" : "none";
  confirmInput.required = mode === "signup";
  // Tell the browser which kind of password this is, so a signup never
  // gets a saved one injected and a login still can.
  passwordInput.setAttribute("autocomplete", mode === "signup" ? "new-password" : "current-password");
  pwTools.setVisible(mode === "signup");
  if (mode === "login") { confirmInput.value = ""; passwordInput.dispatchEvent(new Event("vb:hide-password")); }
  submitBtn.textContent = mode === "signup" ? "Create account" : "Log in";
  errorBox.textContent = "";
}
tabLogin.addEventListener("click", () => setMode("login"));
tabSignup.addEventListener("click", () => setMode("signup"));

/** Creates the Firestore profile doc for a brand-new bidder/seller, the first time they sign in. */
async function ensureProfileDoc(user, displayName) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      name: displayName || user.displayName || "New member",
      photoURL: user.photoURL || "",
      phone: "",
      showOnlineStatus: true,
      lastActive: serverTimestamp(),
      savedItems: [],
      blockedUsers: [],
      // Saved search filters — price range, category, and condition — set
      // from the Browse page and reused there to power "Recommended for
      // you" and the new-listing match notifications.
      preferences: { priceMin: null, priceMax: null, category: "", conditions: [] },
      createdAt: Date.now()
    });
  }
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorBox.textContent = "";
  const email = document.querySelector("#email").value.trim();
  const password = document.querySelector("#password").value;
  const name = document.querySelector("#name").value.trim();
  if (mode === "signup" && password !== confirmInput.value) {
    errorBox.textContent = "The two passwords don't match.";
    return;
  }
  const originalLabel = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.innerHTML = loaderBlobHtml();
  try {
    if (mode === "signup") {
      signingUp = true;
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await ensureProfileDoc(cred.user, name);
      // Let them see exactly what they set (masked, reveal on tap) before moving on.
      await showPasswordOnce(password, { title: "Account created", note: "Here's the password you just set." });
      signingUp = false;
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
    window.location.href = destination();
  } catch (err) {
    signingUp = false;
    errorBox.textContent = friendlyError(err);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalLabel;
  }
});

document.querySelector("#google-btn").addEventListener("click", async (e) => {
  errorBox.textContent = "";
  const googleBtn = e.currentTarget;
  const originalLabel = googleBtn.textContent;
  googleBtn.disabled = true;
  googleBtn.innerHTML = loaderBlobHtml();
  try {
    const cred = await signInWithPopup(auth, googleProvider);
    await ensureProfileDoc(cred.user);
    window.location.href = destination();
  } catch (err) {
    errorBox.textContent = friendlyError(err);
  } finally {
    googleBtn.disabled = false;
    googleBtn.textContent = originalLabel;
  }
});

forgotLink.addEventListener("click", async (e) => {
  e.preventDefault();
  errorBox.textContent = "";
  const email = document.querySelector("#email").value.trim();
  if (!email) { errorBox.textContent = "Enter your email above first, then tap \"Forgot password?\"."; return; }
  try {
    await sendPasswordResetEmail(auth, email);
    showToast("Password reset email sent — check your inbox.", { type: "success" });
  } catch (err) {
    errorBox.textContent = friendlyError(err);
  }
});

function friendlyError(err) {
  const code = err.code || "";
  if (code.includes("wrong-password") || code.includes("user-not-found") || code.includes("invalid-credential")) return "Email or password is incorrect.";
  if (code.includes("email-already-in-use")) return "That email already has an account — try logging in instead.";
  if (code.includes("weak-password")) return "Password should be at least 6 characters.";
  if (code.includes("invalid-email")) return "That doesn't look like a valid email address.";
  return "Something went wrong. Please try again.";
}

// If already signed in, skip straight past the auth screen.
onAuthStateChanged(auth, (user) => {
  if (user && !signingUp) window.location.href = destination();
});

// Land here via index.html?deleted=1 right after Settings' Danger zone
// finishes deleting the account — a short, one-time farewell instead of
// silently dumping them back on the login screen with no acknowledgment.
if (new URLSearchParams(window.location.search).get("deleted") === "1") {
  showToast("Your account has been deleted. Take care.", { type: "info", duration: 5000 });
  window.history.replaceState({}, "", "index.html");
}
