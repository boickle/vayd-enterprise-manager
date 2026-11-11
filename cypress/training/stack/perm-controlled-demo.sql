-- ROLE-09 demo data (TEST database only): three controlled drugs with stock at both offices, one weekly
-- count at Raleigh three days ago (Butorphanol 1 mL short), and one witnessed waste. Made-up rows, marked
-- pimsType 'PERMDEMO' so each run removes the last run's rows first.
BEGIN;

DELETE FROM inventory_waste_events WHERE "inventoryItemId" IN (SELECT id FROM inventory_items WHERE "pimsType" = 'PERMDEMO');
DELETE FROM inventory_count_line_locations WHERE "lineId" IN (
  SELECT l.id FROM inventory_count_lines l JOIN inventory_items i ON i.id = l."inventoryItemId" WHERE i."pimsType" = 'PERMDEMO');
DELETE FROM inventory_count_sessions WHERE id IN (
  SELECT l."sessionId" FROM inventory_count_lines l JOIN inventory_items i ON i.id = l."inventoryItemId" WHERE i."pimsType" = 'PERMDEMO');
DELETE FROM inventory_count_lines WHERE "inventoryItemId" IN (SELECT id FROM inventory_items WHERE "pimsType" = 'PERMDEMO');
DELETE FROM inventory_location_balance WHERE "inventoryItemId" IN (SELECT id FROM inventory_items WHERE "pimsType" = 'PERMDEMO');
DELETE FROM inventory_items WHERE "pimsType" = 'PERMDEMO';

INSERT INTO inventory_items (name, "practiceId", "pimsType", "pimsId", "isActive", "isDeleted", "isControlled", "isMedication",
                             "controlledMeasure", cost, price, "sellUnitType", "assignedAbc")
VALUES
  ('Butorphanol 10 mg/mL injection', 1, 'PERMDEMO', 'permdemo-butorphanol', true, false, true, true, 'volume', 4.20, 12.00, 'mL', 'A'),
  ('Buprenorphine 0.3 mg/mL injection', 1, 'PERMDEMO', 'permdemo-buprenorphine', true, false, true, true, 'volume', 2.10, 8.00, 'mL', 'A'),
  ('Ketamine 100 mg/mL injection', 1, 'PERMDEMO', 'permdemo-ketamine', true, false, true, true, 'volume', 0.90, 4.00, 'mL', 'A');

-- Stock on hand: Raleigh office shelf and Durham main.
INSERT INTO inventory_location_balance ("inventoryItemId", "branchLocationId", "quantityOnHand")
SELECT i.id, bl.id, q.qty
  FROM (VALUES ('permdemo-butorphanol', 'Raleigh office', 29), ('permdemo-buprenorphine', 'Raleigh office', 18),
               ('permdemo-ketamine', 'Raleigh office', 45), ('permdemo-butorphanol', 'Durham office', 20),
               ('permdemo-buprenorphine', 'Durham office', 12), ('permdemo-ketamine', 'Durham office', 30)) AS q(pims, office, qty)
  JOIN inventory_items i ON i."pimsId" = q.pims AND i."pimsType" = 'PERMDEMO'
  JOIN practice_branch pb ON pb.name = q.office AND pb."practiceId" = 1 AND pb."isActive"
  JOIN LATERAL (SELECT id FROM inventory_branch_location WHERE "branchId" = pb.id AND "isActive"
                 ORDER BY ("name" = 'Office shelf') DESC, "isDefault" DESC, id LIMIT 1) bl ON true;

-- One submitted weekly count at Raleigh, three days ago, by Tess Holt.
WITH s AS (
  INSERT INTO inventory_count_sessions ("practiceId", "branchId", status, kind, "countedByEmployeeId", "submittedAt", created)
  SELECT 1, pb.id, 'submitted', 'weekly',
         (SELECT id FROM employees WHERE "firstName" = 'Tess' AND "lastName" = 'Holt' ORDER BY id DESC LIMIT 1),
         now() - interval '3 days', now() - interval '3 days'
    FROM practice_branch pb WHERE pb.name = 'Raleigh office' AND pb."practiceId" = 1 AND pb."isActive" LIMIT 1
  RETURNING id, "branchId", "countedByEmployeeId"
), lines AS (
  INSERT INTO inventory_count_lines ("sessionId", "inventoryItemId", "effectiveAbc", "expectedTotal", "actualTotal", variance,
                                     "submittedAt", "unitCost", "varianceCost", "flaggedAt", created)
  SELECT s.id, i.id, 'A', c.expected, c.actual, c.actual - c.expected, now() - interval '3 days', i.cost,
         (c.actual - c.expected) * i.cost, CASE WHEN c.actual <> c.expected THEN now() - interval '3 days' END,
         now() - interval '3 days'
    FROM s
    CROSS JOIN (VALUES ('permdemo-butorphanol', 30, 29), ('permdemo-buprenorphine', 18, 18), ('permdemo-ketamine', 45, 45)) AS c(pims, expected, actual)
    JOIN inventory_items i ON i."pimsId" = c.pims AND i."pimsType" = 'PERMDEMO'
  RETURNING id, "inventoryItemId", "expectedTotal", "actualTotal"
)
INSERT INTO inventory_count_line_locations ("lineId", "branchLocationId", "expectedQty", "actualQty", "countedAt",
                                            "countedByEmployeeId", "countedByName")
SELECT lines.id, b."branchLocationId", lines."expectedTotal", lines."actualTotal", now() - interval '3 days',
       s."countedByEmployeeId", 'Tess Holt'
  FROM lines CROSS JOIN s
  JOIN inventory_location_balance b ON b."inventoryItemId" = lines."inventoryItemId"
  JOIN inventory_branch_location bl ON bl.id = b."branchLocationId" AND bl."branchId" = s."branchId";

-- One witnessed waste: 0.5 mL ketamine drawn up and not given, yesterday.
INSERT INTO inventory_waste_events ("practiceId", "branchId", "inventoryItemId", "fromBranchLocationId", quantity, "reasonCode",
                                    "disposedByName", "costSnapshot", notes, created, "witnessedAt")
SELECT 1, bl."branchId", i.id, bl.id, 0.5, 'drawn_not_given', 'Dr. Maya Ortiz', 0.5 * i.cost,
       'Drawn up for sedation, not needed', now() - interval '1 day', now() - interval '1 day'
  FROM inventory_items i
  JOIN inventory_location_balance b ON b."inventoryItemId" = i.id
  JOIN inventory_branch_location bl ON bl.id = b."branchLocationId"
  JOIN practice_branch pb ON pb.id = bl."branchId" AND pb.name = 'Raleigh office'
 WHERE i."pimsId" = 'permdemo-ketamine' AND i."pimsType" = 'PERMDEMO'
 LIMIT 1;

COMMIT;
