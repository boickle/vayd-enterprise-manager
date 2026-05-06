# Scout routing — frontend handoff

**Single reference for routing v2 / Scout UI.** Extend the client **slot** (winner / alternate / `doctors[].top[]` / `gaps[]`) type with the optional fields below; ignore missing fields in **legacy** or older payloads.

---

## When it applies

| Mode | Client behavior |
|------|-----------------|
| **`scoutEmptyDayPolicy === 'zone_aware'`** (root and/or slot) | Show zone-aware callout, liaison line, day badges, **N6–N9** diagnostics, optional **Scout zone-aware Δ**. |
| **`legacy`** (e.g. `scoutEmptyDayPolicy: 'legacy'` on slots) | Same **getFleetRoutingV2 / routing v2** shape as before; **no** zone-aware-only fields required. Treat absent fields as unused. |

No new **client** environment variables; the server uses **`SCOUT_EMPTY_DAY_POLICY=zone_aware`** when enabled.

---

## Zone-aware **slim pass** (current default scorer path)

**API shape unchanged:** same env flag, same `scoutEmptyDayPolicy`, same field names on root / winner / alternates / `gaps[]` when policy is `zone_aware`.

| Topic | Behavior |
|-------|----------|
| **`scoutZoneClass`** | `local` / `corridor` / `anchor` from **depot→candidate** drive: **≤15 min** local, **≥25 min** anchor, **between** corridor. Same minute thresholds as **anchor** legs counted for N9. |
| **Ranking nudge** | Effectively **N9 only:** `scoutMultiAnchorDayN9` penalizes **non-local** slots on days that already have **two+** existing legs classified **anchor** (same thresholds as zone class). Full penalty when two+ anchor legs exist even in one zone. |
| **`scoutZoneAwareScoreDelta`** | Treat as **equal to N9** on this pass (**N1–N8 not applied** here). Lower **total** score is still better after the server adjusts score. |
| **N6 / N7 / N8** | Still on the wire for stable shape; **usually `0`**. Show in UI only when **non-zero** (or omit row noise). |
| **`scoutAnchorPanelShare`** | **Not set** by Scout on this path—do **not** rely on it from routing; use **My Week / zone-percentages** if you need panel share. |
| **Ordering** | May differ vs the older heavier zone-aware scorer; **no contract break** on field names. |

---

## Zone-aware: numeric fields on each slot (diagnostics / transparency)

Not the main sort key—**total score** already includes everything. These are for tooltips / power users / copy.

| Field | Meaning |
|-------|---------|
| **`scoutWeekPanelBalanceN6`** | **Slim pass:** usually **`0`** (shape-stable). Heavier scorer: week vs **panel** (N6). Non-negative; larger = worse. |
| **`scoutPackDayReserveN7`** | **Slim pass:** usually **`0`**. Heavier scorer: **N7** pack-day reserve (additive). Larger = worse. |
| **`scoutZoneHourPackN8`** | **Slim pass:** usually **`0`**. Heavier scorer: **N8** zone-hour pack—extra penalty when this option puts the **new client’s zone** on a day **already mostly another zone** by **booked service hours**, with panel budget for that dominant zone. **0** = not penalized. **Lower is better**; whitespace on the slot could reduce penalty in the heavier model. |
| **`scoutMultiAnchorDayN9`** | **N9** multi-anchor day (primary slim-pass nudge). Penalty when the doctor’s day **already has two or more** depot→stop legs classified as **anchor** **before** adding this visit, for **non-local** candidates. **`0`** for **local** or when the pattern does not apply. Full penalty when two+ anchor legs exist even in one zone. |
| **`scoutZoneAwareScoreDelta`** | **Slim pass:** **N9-only** (align with `scoutMultiAnchorDayN9`). Heavier scorer: could include N1–N9+; use total score as authority. |

---

## Liaison

- **`scoutLiaisonLabelIds`** — stable ids for **i18n** and **analytics** (order matches `scoutLiaisonLabels` when both are sent).
- **`scoutLiaisonPrimaryLabel`** — main human line when present.
- **`scoutLiaisonLabels`** — English strings in id order; API remains source for wording.

### Stable id → typical English (reference)

| `scoutLiaisonLabelIds` | Typical `scoutLiaisonLabels` / meaning |
|------------------------|----------------------------------------|
| `balances_week` | Busy-day spread (**N4** only—not panel mix). |
| `keeps_week_panel_mix` | Panel-mix / week vs panel (**N6**). Distinct from `balances_week`. |
| `fits_far_run_day` | “Fits a day that already runs farther from home” — explain similar-drive wins. |
| `fits_zone_pack_day` | “Fits a day already concentrated in this zone (panel time budget).” — **N8** story (heavier scorer). |
| `outside_zones_drive_fit` | Address not in a zone polygon. |
| `earliest_available` | Earliest available (fallback). |

Other ids in the liaison table may be **reserved / legacy** on the slim pass—prefer **`scoutLiaisonPrimaryLabel`** / **`scoutLiaisonLabels`** from the API for copy.

---

## Product one-liners (talk track)

- **Slim pass:** Prefer **`scoutZoneClass`** + **`scoutMultiAnchorDayN9`** (and **`scoutZoneAwareScoreDelta`** as N9) for explanations; ignore **`scoutAnchorPanelShare`** from routing unless panel is wired separately.
- **N9:** **“Penalty when this day already has two or more long (anchor) runs from depot before adding this visit.”** Non-local slots only; full penalty when two+ anchor legs exist even in one zone.

---

## Frontend (`src/pages/Routing.tsx`)

- Purple **Zone-aware** callout when root policy is `zone_aware`.
- **Client Liaison Note** (deduped primary + labels); id tooltips + `data-scout-liaison-label-ids`.
- Badges: households/patients, strategic light, empty day.
- Diagnostics row: **Zone class** chip; **N6–N8** only when **> 0**; **N9** when present (**≥ 0**). Same row on **`gaps[]`** when applicable.
- **Scout zone-aware Δ (N9)** when `scoutZoneAwareScoreDelta` is present (slim pass: N9-only delta).
- **`gaps[]` / `routingGaps`** when root or gap policy is `zone_aware`.

Local map: `SCOUT_LIAISON_LABEL_ID_COPY` + long tooltips for selected ids (e.g. `fits_far_run_day`, `fits_zone_pack_day`).
