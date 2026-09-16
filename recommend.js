// A small, transparent scoring function — no hidden ranking algorithm.
// Each stated search preference that an item fits adds points; a blank
// or unset preference simply doesn't filter anything out.

function norm(v) {
  return (v || "").toString().trim().toLowerCase();
}

export function matchScore(myPrefs, item) {
  if (!myPrefs) return 0;
  let score = 0;

  const priceMin = Number(myPrefs.priceMin) || 0;
  const priceMax = Number(myPrefs.priceMax) || 0;
  const price = item.currentBid || item.startingPrice || 0;
  if (price && (priceMin || priceMax)) {
    const okMin = !priceMin || price >= priceMin;
    const okMax = !priceMax || price <= priceMax;
    if (okMin && okMax) score += 3;
  }

  if (myPrefs.category && norm(myPrefs.category) && norm(myPrefs.category) === norm(item.category)) score += 3;

  const wantedConditions = Array.isArray(myPrefs.conditions) ? myPrefs.conditions : [];
  if (wantedConditions.length && wantedConditions.includes(item.condition)) score += 2;

  // A watched item ending soon is worth surfacing even without a strong
  // category/price match, so a bidder doesn't miss the countdown.
  if (item.endTime && item.endTime - Date.now() < 60 * 60 * 1000 && item.endTime > Date.now()) score += 1;

  return score;
}

/** True once at least one search preference has been set. */
export function hasPreferences(myPrefs) {
  if (!myPrefs) return false;
  return !!(myPrefs.priceMin || myPrefs.priceMax || myPrefs.category
    || (Array.isArray(myPrefs.conditions) && myPrefs.conditions.length));
}
