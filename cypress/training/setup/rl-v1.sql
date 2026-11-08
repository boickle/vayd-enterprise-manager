-- Room Loader video demo data: Maple (dog, 7) and Juniper (cat, 3), Maria Rivera's pets. TEST stack only:
--   psql -d vayd_api_test_e2e -v maple=<id> -v juniper=<id> -v practice=<id> -f rl-v1.sql
-- Reminders it adds have a pimsId starting "training-rl", so a re-run clears the last one first.
\set ON_ERROR_STOP on
BEGIN;
DELETE FROM reminders WHERE "pimsId" LIKE 'training-rl%';
-- Room Loaders from an earlier take, so the new visit gets a fresh, unsent one.
CREATE TEMP TABLE rl_old AS SELECT DISTINCT "roomLoaderId" AS id FROM room_loader_patients WHERE "patientId" IN (:maple, :juniper);
DELETE FROM room_loader_appointments WHERE "roomLoaderId" IN (SELECT id FROM rl_old);
DELETE FROM room_loader_patients WHERE "roomLoaderId" IN (SELECT id FROM rl_old);
DELETE FROM room_loader WHERE id IN (SELECT id FROM rl_old);
UPDATE reminders SET "isDeleted"=true WHERE "patientId" IN (:maple, :juniper);
UPDATE patients SET dob = now() - interval '7 years 2 months', "isActive"=true WHERE id=:maple;
UPDATE patients SET dob = now() - interval '3 years 5 months', "isActive"=true WHERE id=:juniper;

-- Catalog rows the story needs that the demo catalog lacks (names and prices as in the real catalog).
INSERT INTO procedures (created, updated, "isActive", "isDeleted", "pimsType", "pimsId", name, code, price, "practiceId",
                        "excludePercentageDiscount", "hideOnInvoice", "excludeFromProduction", "allowPriceChange",
                        "isShippingType", "staffDiscountEnabled", "staffDiscountMode", "isAftercare", "changePatientSex")
SELECT now(), now(), true, false, 'TRAINING', 'training-rl-proc-' || v.code, v.name, v.code, v.price, :practice,
       false, false, false, true, false, false, 'charge', false, false
FROM (VALUES ('WELLNESS', 'Annual Wellness Visit', 118), ('CVTIER1TRIPFEE', 'CV-Tier 1 Trip Fee', 108)) AS v(code, name, price)
WHERE NOT EXISTS (SELECT 1 FROM procedures p WHERE p.code = v.code AND NOT p."isDeleted");

-- Wellness visit due for both (a visit-type line), shown to staff.
INSERT INTO reminders (created, updated, "isActive", "isDeleted", "pimsType", "pimsId", "practiceId", "isHidden",
                       "patientId", description, "dueDate", "isSatisfied", "sourceCatalogItemType", "sourceCatalogItemId")
SELECT now(), now(), true, false, 'TRAINING', 'training-rl-wv-' || pet, :practice, false, pet, 'Annual Wellness Visit',
       now() + interval '3 days', false, 'procedure', (SELECT id FROM procedures WHERE code = 'WELLNESS' AND NOT "isDeleted" ORDER BY id LIMIT 1)
FROM (VALUES (:maple), (:juniper)) AS v(pet);

-- Due around the visit (shown to staff), and one not due for 6 months (Lepto: must NOT be offered).
INSERT INTO reminders (created, updated, "isActive", "isDeleted", "pimsType", "pimsId", "practiceId", "isHidden",
                       "patientId", description, "dueDate", "isSatisfied", "sourceInventoryItemId")
SELECT now(), now(), true, false, 'TRAINING', 'training-rl-' || v.k, :practice, false, v.pet, i.name,
       now() + v.due, false, i.id
FROM (VALUES
  ('m-dapp',  :maple,   'DAPP1',          interval '3 days'),
  ('m-rab',   :maple,   'RABIES3',        interval '3 days'),
  ('m-lyme',  :maple,   'LYMECR',         interval '3 days'),
  ('m-lepto', :maple,   'LEPTOANNUAL',    interval '6 months'),
  ('j-fvrcp', :juniper, 'FVRCP1',         interval '3 days'),
  ('j-rab',   :juniper, 'RABIESPUREVAX1', interval '3 days')
) AS v(k, pet, code, due)
JOIN LATERAL (SELECT id, name FROM inventory_items WHERE code = v.code ORDER BY id LIMIT 1) i ON true;
COMMIT;
