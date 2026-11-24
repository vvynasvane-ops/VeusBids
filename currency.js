// ============================================================
// Currencies for VeusBid listings (web mirror of the Android util/Currency.java).
//
// Each listing carries its own ISO code in `item.currency`; the whole auction (starting price,
// reserve, bids, outbid alerts) is in that currency. Listings made before this feature have no
// field and read as USD, so old data keeps working.
//
// perUsd is a ROUGH reference rate (units of the currency per 1 USD). It is only used for "about"
// conversions and cross-currency sorting/filtering - never to settle or change a bid.
// Edit the numbers whenever you want fresher approximations.
// ============================================================

export const DEFAULT_CURRENCY = "USD";

// [code, symbol, name, country (flag), max decimals, perUsd]
const ROWS = [
  // East Africa first, then the rest of Africa, then the world.
  ["KES", "KSh", "Kenyan Shilling", "KE", 2, 129],
  ["UGX", "USh", "Ugandan Shilling", "UG", 0, 3650],
  ["TZS", "TSh", "Tanzanian Shilling", "TZ", 0, 2550],
  ["RWF", "FRw", "Rwandan Franc", "RW", 0, 1450],
  ["ETB", "Br", "Ethiopian Birr", "ET", 2, 125],
  ["NGN", "\u20A6", "Nigerian Naira", "NG", 2, 1500],
  ["GHS", "GH\u20B5", "Ghanaian Cedi", "GH", 2, 15],
  ["ZAR", "R", "South African Rand", "ZA", 2, 18],
  ["EGP", "E\u00A3", "Egyptian Pound", "EG", 2, 48],
  ["MAD", "MAD", "Moroccan Dirham", "MA", 2, 9.5],
  ["ZMW", "ZK", "Zambian Kwacha", "ZM", 2, 26],
  ["XOF", "CFA", "West African CFA Franc", "SN", 0, 600],
  ["USD", "$", "US Dollar", "US", 2, 1],
  ["EUR", "\u20AC", "Euro", "EU", 2, 0.92],
  ["GBP", "\u00A3", "British Pound", "GB", 2, 0.78],
  ["CHF", "CHF", "Swiss Franc", "CH", 2, 0.88],
  ["CAD", "C$", "Canadian Dollar", "CA", 2, 1.38],
  ["AUD", "A$", "Australian Dollar", "AU", 2, 1.52],
  ["AED", "AED", "UAE Dirham", "AE", 2, 3.67],
  ["SAR", "SAR", "Saudi Riyal", "SA", 2, 3.75],
  ["TRY", "\u20BA", "Turkish Lira", "TR", 2, 34],
  ["INR", "\u20B9", "Indian Rupee", "IN", 2, 84],
  ["PKR", "Rs", "Pakistani Rupee", "PK", 2, 280],
  ["BDT", "\u09F3", "Bangladeshi Taka", "BD", 2, 120],
  ["CNY", "CN\u00A5", "Chinese Yuan", "CN", 2, 7.2],
  ["JPY", "\u00A5", "Japanese Yen", "JP", 0, 150],
  ["KRW", "\u20A9", "South Korean Won", "KR", 0, 1370],
  ["SGD", "S$", "Singapore Dollar", "SG", 2, 1.33],
  ["IDR", "Rp", "Indonesian Rupiah", "ID", 0, 15800],
  ["PHP", "\u20B1", "Philippine Peso", "PH", 2, 57],
  ["BRL", "R$", "Brazilian Real", "BR", 2, 5.5],
  ["MXN", "MX$", "Mexican Peso", "MX", 2, 19]
];

const TABLE = new Map(ROWS.map(([code, symbol, name, country, decimals, perUsd]) =>
  [code, { code, symbol, name, country, decimals, perUsd }]));

export const CURRENCIES = [...TABLE.values()];

/** Unknown / empty codes fall back to USD so a bad value in Firestore can never break a page. */
export function getCurrency(code) {
  return TABLE.get(String(code || "").trim().toUpperCase()) || TABLE.get(DEFAULT_CURRENCY);
}

export function isKnownCurrency(code) {
  return TABLE.has(String(code || "").trim().toUpperCase());
}

/** Regional-indicator flag emoji, e.g. KE -> a Kenyan flag. */
export function flagOf(code) {
  const c = getCurrency(code).country;
  return c.length === 2
    ? String.fromCodePoint(...[...c].map(ch => 0x1F1E6 + ch.charCodeAt(0) - 65))
    : "";
}

/** "<flag>  KES · Kenyan Shilling" for pickers. */
export function currencyLabel(code) {
  const c = getCurrency(code);
  return `${flagOf(c.code)}  ${c.code} \u00B7 ${c.name}`;
}

/** <option> markup for a <select>; `selected` is the code to preselect. */
export function currencyOptionsHtml(selected) {
  const want = getCurrency(selected).code;
  return CURRENCIES.map(c =>
    `<option value="${c.code}"${c.code === want ? " selected" : ""}>${currencyLabel(c.code)}</option>`).join("");
}

/** 12500 KES -> "KSh 12,500"; 12.5 USD -> "$12.5"; 1500 NGN -> "\u20A61,500". */
export function formatCurrency(n, code) {
  const c = getCurrency(code);
  const num = Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: c.decimals });
  const spaced = /[A-Za-z]$/.test(c.symbol);
  return c.symbol + (spaced ? " " : "") + num;
}

// ---------------- approximate conversion ----------------

export function convertCurrency(amount, from, to) {
  return Number(amount || 0) / getCurrency(from).perUsd * getCurrency(to).perUsd;
}
export function toUsd(amount, from) {
  return Number(amount || 0) / getCurrency(from).perUsd;
}

// ---------------- bid amounts ----------------

/** Smallest amount a bid can move by: 1 for zero-decimal currencies, else 0.01. */
export function smallestUnit(code) {
  return getCurrency(code).decimals === 0 ? 1 : 0.01;
}

/** Round to the currency's own decimals so a typed 5000.004 can never be stored as such. */
export function roundToCurrency(n, code) {
  const d = getCurrency(code).decimals;
  return Number(Number(n || 0).toFixed(d));
}

// ---------------- the viewer's own currency ----------------

const LAST_KEY = "vb-last-currency";

/** Last currency the member listed/filtered in, else their browser locale's, else USD. */
export function preferredCurrency() {
  try {
    const saved = localStorage.getItem(LAST_KEY);
    if (isKnownCurrency(saved)) return getCurrency(saved).code;
  } catch { /* storage blocked */ }
  try {
    const region = (navigator.language || "").split("-")[1];
    if (region) {
      const hit = ROWS.find(r => r[3] === region.toUpperCase());
      if (hit) return hit[0];
    }
  } catch { /* no navigator */ }
  return DEFAULT_CURRENCY;
}

export function rememberCurrency(code) {
  try { localStorage.setItem(LAST_KEY, getCurrency(code).code); } catch { /* best effort */ }
}
