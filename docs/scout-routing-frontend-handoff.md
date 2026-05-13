# Scout routing — frontend handoff

**Single reference for routing v2 / Scout UI.** Extend the client **slot** (winner / alternate / `doctors[].top[]` / `gaps[]`) type with the optional fields below; ignore missing fields in **legacy** or older payloads.

---

## When it applies

| Mode | Client behavior |
|------|-----------------|
| **`scoutEmptyDayPolicy === 'zone_aware'`** (root and/or slot) | Show zone-aware callout, liaison line, day badges, **N6–N8** (usually 0), **N9** + **preserved-day** chips when applicable, **Zone-aware Δ** when `scoutZoneAwareScoreDelta` is present. |
| **`legacy`** | Same routing v2 shape as before; **no** zone-aware-only fields required. Treat absent fields as unused. |

No new **client** environment variables; the server uses **`SCOUT_EMPTY_DAY_POLICY=zone_aware`** when enabled.

---

## Zone-aware scorer (routing v2)

**Do not recompute preserve logic in the UI** — it depends on full ISO week hydration, panel %, modal depot, centroids, and OSRM. **Use server fields only.**

**Panel / “≥7.5%” conceptual source:** still **`GET /patients/provider/:providerId/zone-percentages`** (same as My Week). Routing does **not** return raw panel rows on each candidate.

| Field | Meaning |
|-------|---------|
| **`scoutZoneClass`** | `local` / `corridor` / `anchor` from depot→candidate minutes (≤15 / between / ≥25). Same thresholds as anchor legs for N9. |
| **`scoutMultiAnchorDayN9`** | **N9 only:** cross–anchor-zone penalty for **non-local** slots on days with **two+** anchor legs before this visit. **0** when not applied. |
| **`scoutPreservedEmptyDayPenalty`** | Additive hit when this option **consumes a preserved empty anchor-seed day**. **0** when not applied. |
| **`scoutZoneAwareScoreDelta`** | Server **total** of zone-aware **horizon** add-ons: **`scoutMultiAnchorDayN9` + `scoutPreservedEmptyDayPenalty`** (plus any future horizon terms the API adds). **Not** N9-only anymore. Use **total ranking score** as authority; this field is transparency—optionally show **N9** and **preserved** separately when both are present. |
| **`scoutWeekPanelBalanceN6`**, **`scoutPackDayReserveN7`**, **`scoutZoneHourPackN8`** | Usually **0** (shape-stable). Show only when **> 0** unless debugging. |
| **`scoutAnchorPanelShare`** | Often **not set** on slim paths—do **not** rely on it from routing; use **zone-percentages** / My Week if you need panel share. |
| **`scoutLiaisonPrimaryLabel`**, **`scoutLiaisonLabels`**, **`scoutLiaisonLabelIds`** | Unchanged; preserve may **append** liaison entries when it fires. |

### Root: `scoutPreservedEmptyDayWeeks` (optional)

When **`SCOUT_EMPTY_DAY_POLICY=zone_aware`** and there is **at least one candidate**, the fleet routing v2 JSON may include **`scoutPreservedEmptyDayWeeks`**: an array of **one object per doctor × ISO week** used in the preserve pass.

Each entry includes (among others): **`doctorId`**, **`isoWeekMonday`**, **`timeZone`**, **`workingDaysInWeek`**, **`targetPreservedEmpties`**, **`seedAnchorZoneCount`**, **`emptyWorkingIsoDates`**, **`seedAnchorZones`**, **`seedAnchorZonesVisitedThisWeek`**, **`anchorZonesStillNeedingPreservation`** (`{ zoneId, zoneName }[]` — main list for UI copy next to the preserved chip).

Omitted when policy is **legacy**, there are **no candidates**, or zone-aware preserve **did not run**. **Do not recompute** this structure client-side.

---

## Liaison (when preserve fires)

Stable **`scoutLiaisonLabelIds`** may include (in addition to existing ids):

| `scoutLiaisonLabelIds` | Typical meaning |
|------------------------|-----------------|
| `consumes_preserved_anchor_seed_day` | Consumes a preserved empty anchor-seed day. |
| `breaks_empty_day_integrity` | Breaks empty-day integrity under preserve rules. |
| `low_cluster_value_preserved_day` | Low cluster value on a preserved day. |

Matching strings are in **`scoutLiaisonLabels`**; **`scoutLiaisonPrimaryLabel`** may be the first label in the merged list (same as other multi-label cases).

### Other id → English (reference)

| id | Typical copy |
|----|----------------|
| `balances_week` | Busy-day spread (N4 only). |
| `keeps_week_panel_mix` | Week vs panel (N6). |
| `fits_far_run_day` | Fits a day that already runs farther from home. |
| `fits_zone_pack_day` | Fits a day concentrated in this zone (N8 story, heavier scorer). |
| `outside_zones_drive_fit` | Address not in a zone polygon. |
| `earliest_available` | Earliest available (fallback). |

Prefer **`scoutLiaisonPrimaryLabel`** / **`scoutLiaisonLabels`** from the API when in doubt.

---

## Product one-liners

- **N9:** Non-local visit on a day that already has **two+ long (anchor) drives** from depot before this visit → **“Adds Another Anchor Zone”** in UI when N9 > 0.
- **Preserve:** When **`scoutPreservedEmptyDayPenalty` > 0**, explain with server liaison + **“Uses preserved empty day”** chip; never re-derive the penalty client-side.

---

## Frontend (`src/pages/Routing.tsx`)

- Purple **Zone-aware** callout when root policy is `zone_aware`; combined **polygon + drive class** chip in Results header when data allows.
- **Client Liaison Note** + id tooltips (`SCOUT_LIAISON_LABEL_ID_COPY` / long tooltips).
- One flex row: **day stat badges** + **N9** (indigo, when > 0) + **preserved** (amber chip, when penalty > 0).
- When preserved chip shows and **`scoutPreservedEmptyDayWeeks`** matches this **doctor + ISO week**, a note lists **`anchorZonesStillNeedingPreservation`** zone names under the label **This uses one of the remaining flexible days Scout is trying to preserve for other far-away zones this week.**
- **Zone-aware Δ:** single total with tooltip listing **N9** and **preserved** parts when the API sends them.
- **`gaps[]` / `routingGaps`:** same diagnostics + optional Δ line per gap.
