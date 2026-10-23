# Inventory Control Tower — Phase 2 & 3 backlog

Follow-up after Phase 1 (Receive / Move / Waste / Suppliers / Waste Admin) is validated in production.

Do not start these until receive-at-box, vendor SKU learning, and waste audit trail are trusted by staff.

## Phase 2 — Pars & replenish

**Goal:** Know what is below par and move or order without leaving Inventory.

- **Par templates + per-location pars** — practice templates; override by branch location (fridge, shelf, vehicle).
- **Inventory Below Par** — list short locations by item; filter by office / category / ABC class if present.
- **Replenish** — batch transfer from surplus locations first; stub “order list” for what cannot be filled internally.
- **Re-order rules admin** — round-to-pack, preferred supplier, allow backorders, internal-first preference (supplier prefs already on `inventory_suppliers`).

Schema hints (not implemented): `inventory_par_templates`, `inventory_location_pars`, optional `reorder_rules` linking item ↔ supplier.

## Phase 3 — ABC cycle counts & expiring

**Goal:** Catch what process missed after inflow/move/waste are sealed.

- **Weekly ABC snapshot** — classify items; drive “This Week’s Counts” worklist.
- **Blind / visibility count modes** — phone-friendly count entry; variance vs system QOH.
- **Pending Count Reviews** — manager approve / recount; post `adjustment_*` only after approval.
- **Expiring Soon** — lot-aware list with deep-link to Waste / Adjust.
- **Optional later**
  - Invoice PDF upload + parse → suggest shipment lines + mismatch report
  - Attach `purchaseOrderId` / order PDF (column already nullable on `inventory_shipments`)
  - Controlled-substance DEA log (waste reasons still apply in Phase 1)

## Validation gates before Phase 2

1. Staff receive full invoices via Receive Shipment (not ad-hoc Catalog receive).
2. Vendor barcode/SKU maps stabilize (few duplicate creates).
3. Waste events include reason + actor; manager alerts fire when thresholds set.
4. Move Items covers inter-location transfers without raw movement form for routine work.
