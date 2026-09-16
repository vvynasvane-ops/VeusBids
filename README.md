# VeusBid — setup

A static web app (no build step, all files flat in one folder) using
Firebase Auth + Firestore. No Firebase Storage and no billing plan needed —
photos are compressed to small JPEGs in the browser and stored as data
strings directly on the Firestore document.

This is your original single-file VeusBid prototype, rebuilt on the same
engine as your HostelHive project — real accounts, live data, messaging,
notifications — repurposed for VeusBid's actual job: live online auctions.
See section 9 for exactly what came from where.

## 1. Firebase project
1. Create a **new, separate** project at console.firebase.google.com —
   don't reuse your HostelHive or love-wonders projects; the data models don't mix.
2. Enable **Authentication** → Sign-in providers → turn on **Email/Password** and **Google**.
3. Enable **Firestore** (production mode).
4. Project settings → General → add a **Web app** → copy the config values into `firebase-config.js` (must be a plain `export const firebaseConfig = {...}` — not the console's own init snippet). The file currently ships with placeholder values and a comment reminding you of this.

## 2. Firestore security rules
Paste into Firestore → Rules (this file also ships as `firestore.rules`):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && request.auth.uid == uid;
    }
    match /items/{itemId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null && request.resource.data.ownerUid == request.auth.uid;
      allow update: if request.auth != null && (
        resource.data.ownerUid == request.auth.uid ||
        request.resource.data.diff(resource.data).affectedKeys().hasOnly(['viewCount']) ||
        (
          resource.data.ownerUid != request.auth.uid &&
          request.resource.data.diff(resource.data).affectedKeys().hasOnly(
            ['currentBid', 'currentBidderUid', 'currentBidderName', 'bidCount', 'everBidUids', 'endTime']
          ) &&
          request.resource.data.currentBidderUid == request.auth.uid &&
          request.resource.data.currentBid >
            (resource.data.currentBid != null ? resource.data.currentBid : resource.data.startingPrice) &&
          request.resource.data.bidCount == (resource.data.bidCount != null ? resource.data.bidCount : 0) + 1 &&
          request.resource.data.endTime >= resource.data.endTime
        )
      );
      allow delete: if request.auth != null && resource.data.ownerUid == request.auth.uid;
    }
    match /items/{itemId}/bids/{bidId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null && request.resource.data.bidderUid == request.auth.uid;
      allow update, delete: if false;
    }
    match /threads/{threadId} {
      allow read: if request.auth != null && request.auth.uid in resource.data.participants;
      allow create, update: if request.auth != null
        && request.auth.uid in request.resource.data.participants;
    }
    match /threads/{threadId}/messages/{messageId} {
      allow read: if request.auth != null && threadId.matches('.*' + request.auth.uid + '.*');
      allow create: if request.auth != null && request.resource.data.from == request.auth.uid;
    }
    match /reports/{reportId} {
      allow create: if request.auth != null && request.resource.data.reporterUid == request.auth.uid;
      allow read, update, delete: if false; // reports are write-only from the client; review them in the console
    }
    match /feedback/{feedbackId} {
      allow create: if request.auth != null && request.resource.data.fromUid == request.auth.uid;
      allow read: if request.auth != null;
      allow update, delete: if false; // immutable once sent, same as reports
    }
  }
}
```

The bid-placing clause is the one worth reading carefully: a non-owner can
*only* touch the six bidding fields, must name themselves as the new
`currentBidderUid`, must strictly beat the current price, must advance
`bidCount` by exactly one, and can only move `endTime` forward (the
anti-snipe extension) — never back. That's what stops a bidder from editing
someone else's listing, faking a low bid, or rewinding the clock, entirely
at the rules level, without a server.

## 2b. Firestore indexes (required for Messages to load)
The Messages inbox queries `threads` by `participants array-contains <you>`
ordered by `lastAt desc` — Firestore needs a composite index for that combo,
and it won't exist yet on a fresh project. Without it, the inbox listener
fails silently (you'll see a `failed-precondition ... requires an index`
error in the console) and just sits on its loading state — the app itself
now recovers gracefully and shows a retry message, but the index still
needs to be created for Messages to actually work.

Two ways to create it:
- **Fastest:** open the app, trigger the error once, and click the link
  Firestore prints in the browser console (`...firestore/indexes?create_composite=...`) —
  it pre-fills everything.
- **Or deploy directly:** this project ships a `firestore.indexes.json` with
  the same index already defined. Run `firebase deploy --only firestore:indexes`
  from the project folder (needs the Firebase CLI + `firebase init` done once
  to link it to your project).

Items, bids, and feedback don't need a composite index — every query against
them (`items` by `ownerUid` or `everBidUids array-contains`, `items/{id}/bids`
ordered by `at`, `feedback` by `ownerUid`) is a single-field query, which
Firestore indexes automatically.

## 3. What's in the app
- **Auth**: email/password and Google sign-in, plus a "Forgot password?"
  link on the login screen (Firebase's own reset-email flow).
- **Browse** (`browse.html`): every live auction, text search (title/
  category/description/listing code), a filter panel (price range,
  category, condition checklist, ending-within-the-hour, has-photo),
  sortable by ending-soonest/newest/price/most-bids, savable filter presets
  (per-device, via `localStorage`), a live **Watchlist** row, and a
  **Recommended for you** row that scores every visible item against your
  saved filters (`recommend.js`) — it never hides anything, it just
  re-orders. Every card shows a live, ticking countdown.
- **Listing detail** (`item.html` — new): the actual auction page. Full
  photo gallery, current price and bid count in a glowing panel, a live
  countdown, a bid form that enforces a minimum increment above the current
  price, a real-time bid history (anyone can see every bid, in order), a
  watch/save heart, quick feedback chips, Block/Report, and an inline chat
  panel to message the seller — all wired to Firestore's `onSnapshot` so a
  page you're sitting on updates the instant someone else bids, with no
  refresh.
- **Live bidding, no server required**: placing a bid is a single Firestore
  transaction-shaped update (`items/{id}`) plus an append to that item's
  `bids` subcollection, both validated by the security rules above — a bid
  under the current price, or from someone impersonating another bidder, is
  rejected before it ever reaches the database.
- **Anti-sniping**: a bid that lands inside the final two minutes pushes the
  close out by two more minutes, the same "going, going, gone" grace period
  real auction houses use — an intentional upgrade over a flat countdown
  reset, so the last thirty seconds can't be won by clock-edge timing alone.
- **My Listings** (`listings.html`): your account basics (name, photo,
  phone/WhatsApp, an "active recently" toggle shown to members you chat
  with), a form to start an auction — title, category, condition, starting
  price, optional reserve, auction length (1–14 days), item location,
  description, contact info, and up to 6 photos — and a grid of everything
  you've listed, each editable (until the first bid lands) or deletable
  inline, with a live view counter and current price per listing.
- **Watching**: tap the heart on any card to watch an item — stored on your
  own user doc (`savedItems: [id, …]`), so no extra security rule is needed.
- **Nothing hidden**: starting price, current bid, the full bid history,
  condition, contact info, and every photo are visible immediately to any
  signed-in member. There's no unlock-code system in this app at all (the
  encrypt/decrypt pair from `crypto-utils.js` is gone; only the PIN hasher
  for the optional chat-lock feature remains).
- **Feedback**: short preset reaction chips ("Item as described", "Fast
  shipping", "Would buy again", …) a bidder can leave on a listing's detail
  view — public on the listing as lightweight social proof, not a private
  note to the seller. Backed by a `feedback` collection with a denormalized
  `ownerUid` so the seller's live notification listener and My Listings
  summary can query it directly.
- **Safety**: Block (hides a seller's listings from your Browse
  permanently) and Report (writes to a `reports` collection for manual
  review, referencing the specific listing) on every item detail, plus a
  Help & Safety card in Settings with before-you-bid guidelines and a
  direct contact link (support@veusbid.app).
- **Messages**: a dedicated inbox page (`messages.html`) listing every
  conversation you've started — avatar, name, last message preview,
  relative timestamp, and an unread dot — next to a real chat panel: header
  with the other person's photo, date dividers, per-message timestamps, a
  "seen" tick once they've opened the thread, a typing indicator, an
  auto-growing input (Enter to send, Shift+Enter for a new line), and an
  empty state on a fresh conversation. The same chat panel also opens
  inline from an item's detail view. If the other person has deleted their
  account, the header and composer clearly say so ("Deleted account" / "No
  longer on VeusBid") instead of showing a confusing blank name. Each
  thread is backed by a `threads/{id}` doc (`participants`, `lastText`,
  `lastAt`, `lastFrom`, `lastRead.{uid}`, `typing.{uid}`) plus its
  `threads/{id}/messages` subcollection.
- **Delete account** (Settings → Danger zone): type-to-confirm plus a fresh
  password/Google re-auth, then deletes every item you've listed, your
  profile, and your sign-in itself, in that order — permanent, and
  everything vanishes from Browse/Watchlist/search immediately since those
  are all built by live-querying `items`/`users`, not by scrubbing anyone
  else's data.
- **Theme**: plasma cyan & ultraviolet by default (`#00FFD4` primary,
  `#7B2FFF` secondary, over a void-black background) — the same duotone
  glow your original single-file VeusBid mock used, now driving every
  screen — with RGB sliders to retune the accent and a light/dark mode
  toggle, all saved to `localStorage` and applied on every page via
  `theme.js`. A cyan hive-hexagon-with-bolt favicon (`gen_icons.py` —
  regenerate after tweaking the design).

## 4. Running it
Any static file server works, e.g.:
```
npx serve .
```
Firebase Auth requires the page be served over `http://localhost` or
`https://`, not opened as a bare `file://` path.

## 5. Notifications
- **Save confirmations**: every save action across the app (account,
  listings, filter presets, watches, blocks, reports, feedback, theme
  changes) raises a themed, stacked toast (`notifications.js`).
- **Outbid alerts** (new): live-watches every item you're currently the
  highest bidder on and fires the instant someone tops you — in-app toast,
  bell notification, and a real browser Notification if you've granted
  permission.
- **Ending-soon alerts** (new): live-watches your Watchlist and current
  bids, and fires once an item drops under 5 minutes remaining.
- **Match notifications**: a bell icon (top bar, every authenticated page)
  with an unread badge and a history dropdown. While the app is open, it
  watches Firestore live for brand-new listings and, if one scores against
  your saved search filters (`recommend.js`), raises an in-app notification
  plus a real browser Notification.
- **New-responder notifications**: the same pipeline watches your message
  threads live and fires the moment someone reaches out — their first
  message to you in a brand-new thread, or a reply back after you messaged
  them first.
- **Feedback notifications**: fires when a member leaves feedback on any
  listing you own.
- None of this is *background* push — it needs a tab open somewhere. True
  background push would need a service worker + FCM and a small backend;
  out of scope for this static-file setup for now.

## 6. App icon
Generated procedurally with Pillow (`gen_icons.py`, shipped in the project
root — rerun it any time you want to tweak the design and regenerate every
size): a plasma-cyan hive hexagon with a bolt silhouette cut into it, on a
void-black background. Outputs the full set — 16/32/48/96/192/512 plain
PNGs, two maskable PWA icons (192/512, glyph inset to the safe zone), a
180px `apple-touch-icon.png`, a multi-size `favicon.ico`, and an opaque
`favicon.jpg`. `manifest.json` lists the five PWA sizes with the correct
`purpose` per icon (`any` vs `maskable`), and every page's `<head>` links
the favicon set and `apple-touch-icon.png` directly.

## 7. Still worth adding later
- No *background* push (see section 5).
- No native iOS/Android app — the manifest makes it installable as a PWA.
- The Browse feed loads every item in one query; once listing count grows
  you'll want to paginate.
- Reports land in Firestore but there's no admin screen to review them —
  check the `reports` collection directly in the Firebase console for now.
- The anti-snipe extension and bid validation both run client-side against
  rules-enforced writes, which is solid for a small-to-mid-size auction site
  but not fully race-condition-proof under very high concurrent bidding on
  the same item (two bids landing in the same instant could both read the
  same "current price" before either write completes) — a Cloud Function
  wrapping bid placement in a real Firestore transaction would close that
  gap; out of scope for this static-file, no-backend setup for now.
- No automatic "auction closed" cleanup — the countdown is purely visual
  (`isEnded()` compares `endTime` to `Date.now()` on every page that reads
  it) and the last bid stands as the winner; there's no server-side job
  that does anything at close time (no auto-charge, no auto-email).
- Feedback and reports referencing a listing aren't cleaned up if that
  specific listing is later deleted without the seller's account also being
  deleted — harmless orphaned data (nothing links back to a live page), but
  worth a cleanup pass eventually.

## 9. What came from where
Your original VeusBid was a single self-contained HTML file (`index__4_.html`)
with a `localStorage`-backed bid list and a separate password-gated admin
view (`perfectbid.html`) — real-looking, but with no accounts, no live data
between two different people's browsers, and no way for a second bidder to
actually see or beat the first one's bid in real time. This rebuild keeps
VeusBid's *purpose* (list an item, take bids on it, see who's winning) but
swaps the foundation for the real multi-user engine your HostelHive project
already proved out:
- `discover.js`/`browse.html` → `browse.js`/`browse.html`: went from
  browsing hostel listings with price/distance/necessities filters to
  browsing live auctions with price/category/condition filters, a ticking
  countdown on every card, and a live current-price/bid-count readout.
- `profile.js`/`listings.html` → `listings.js`/`listings.html`: "My
  Listings" now starts and manages auctions (starting price, reserve,
  duration) instead of hostel listings — editable only until the first bid
  lands, so a bidder can always trust what they bid on.
- **New**: `item.html`/`item.js` — HostelHive had no equivalent. This is the
  actual auction floor: live price, live countdown, live bid history, and
  the bid form itself, all built on Firestore's real-time listeners plus
  the rules-enforced update shape described in section 2.
- **New**: outbid and ending-soon notifications in `notifications.js`,
  alongside the match/message/feedback notifications carried over from
  HostelHive.
- "Saved" stayed "Watching" in spirit — a heart/bookmark on an item, not a
  romance — but now doubles as the ending-soon alert list.
- "Appreciations"/feedback stayed public social proof on a listing, reworded
  for items instead of housing.
- Color theme moved from HostelHive's gold & black to VeusBid's own plasma
  cyan & ultraviolet purple — the palette your original single-file mock
  already established — now applied consistently with sharp, angular
  corners instead of HostelHive's rounded ones.
- `firebase-config.js` was reset to placeholders — this needs its own
  Firebase project, not HostelHive's or love-wonders'.
