-- V11 demo data: Maple's eVet prescriptions and rabies dose, stored the way the eVet importer stores them
-- (see vayd-api test/scripts/emr-e2e-seed.ts). Run on the TEST stack only:
--   psql -d vayd_api_test_e2e -v pet=<Maple id> -v vet=<Dr. Lane employee id> -f emr-v11.sql
-- Everything it adds has a pimsId starting "training-v11", so a re-run clears the last one first.
\set ON_ERROR_STOP on
BEGIN;
DELETE FROM prescriptions WHERE "pimsId" LIKE 'training-v11%';
DELETE FROM vaccination_logs WHERE "pimsId" LIKE 'training-v11%';
DELETE FROM treatment_items WHERE "pimsId" LIKE 'training-v11%'
   OR "treatmentId" IN (SELECT id FROM treatments WHERE "pimsId" LIKE 'training-v11%');
DELETE FROM treatments WHERE "pimsId" LIKE 'training-v11%';
DELETE FROM medical_records WHERE "pimsId" LIKE 'training-v11%';
DELETE FROM inventory_items WHERE "pimsId" LIKE 'training-v11%';
-- Scripts an earlier take wrote for Maple (New directions makes one).
UPDATE prescriptions SET "isDeleted"=true WHERE "patientId"=:pet AND coalesce("pimsId",'') NOT LIKE 'training-v11%';
-- Refills and refill lines from an earlier take.
UPDATE visit_invoice_lines SET "isDeleted"=true WHERE "patientId"=:pet AND "refillOfPrescriptionId" IS NOT NULL;

-- Carprofen's usual directions in the catalog: a new script (New directions) starts from these.
UPDATE inventory_items SET "dispenseNote"='Give 1 caplet by mouth once a day with food.'
 WHERE name='Carprofen 75 mg caplet';

INSERT INTO medical_records ("practiceId","patientId","pimsType","pimsId","isActive","isDeleted")
VALUES (1, :pet, 'EVET', 'training-v11-mr', true, false);

-- Medications on file: Carprofen (2 refills left) and Apoquel (none left).
INSERT INTO inventory_items ("practiceId","pimsType","pimsId",name,price,"taxLevelValue","isActive","trackLots","isMedication")
VALUES (1,'scout','training-v11-apoquel','Apoquel 16 mg tablet',2.10,0,true,false,true);
INSERT INTO treatments ("practiceId","patientId","pimsId","pimsType","isActive","isDeleted")
VALUES (1, :pet, 'training-v11-tx', 'EVET', true, false);
INSERT INTO treatment_items ("practiceId","treatmentId","inventoryItemId","serviceDate","pimsId","pimsType",quantity)
SELECT 1, t.id, i.id, now() - interval '60 days', '911000001', 'EVET', 30
  FROM treatments t, inventory_items i WHERE t."pimsId"='training-v11-tx' AND i.name='Carprofen 75 mg caplet';
INSERT INTO treatment_items ("practiceId","treatmentId","inventoryItemId","serviceDate","pimsId","pimsType",quantity)
SELECT 1, t.id, i.id, now() - interval '120 days', '911000002', 'EVET', 30
  FROM treatments t, inventory_items i WHERE t."pimsId"='training-v11-tx' AND i."pimsId"='training-v11-apoquel';
INSERT INTO prescriptions ("practiceId","pimsId","pimsType","planItem_Id",refill,"refillExpiration",name,instructions,
  "startDate","expirationPeriodValue","isOwned","employeeId","externalCreated","rxNumber",quantity)
VALUES
  (1,'training-v11-rx-carprofen','EVET',911000001,2,now() + interval '300 days','Carprofen 75 mg caplets',
   'Give 1 caplet by mouth every 12 hours with food.',now() - interval '60 days',0,false,:vet,now() - interval '60 days',971204,30),
  (1,'training-v11-rx-apoquel','EVET',911000002,0,now() + interval '240 days','Apoquel 16 mg tablets',
   'Give 1 tablet by mouth once a day.',now() - interval '120 days',0,false,:vet,now() - interval '120 days',968833,30);

-- Her rabies dose from eVet, given by Dr. Lane 8 months ago.
INSERT INTO inventory_items ("practiceId","pimsType","pimsId",name,price,"isActive","trackLots")
VALUES (1,'EVET','training-v11-rabies','Rabies 3yr Vaccine',30,true,false);
INSERT INTO treatment_items ("practiceId","inventoryItemId","pimsId","pimsType")
SELECT 1, id, 'training-v11-rabies-ti', 'EVET' FROM inventory_items WHERE "pimsId"='training-v11-rabies';
INSERT INTO vaccination_logs ("practiceId","pimsType","pimsId","patientId","treatmentItemId","employeeId","dateVaccinated","nextVaccinationDate",
  "sexValue",weight,"weightUnitValue","tagNumber","lotNumber","vaccineExpiration",manufacturer,"practiceName","usdaLicensingMonths","animalControlLicensingMonths","dosageType","isActive","isDeleted")
SELECT 1,'EVET','training-v11-rabies-dose',:pet,ti.id,:vet,now() - interval '240 days',now() + interval '855 days',
  2,48,1,'R-20417','RB-3Y-5521',now() + interval '400 days','Zoetis','Vet At Your Door',36,36,1,true,false
  FROM treatment_items ti WHERE ti."pimsId"='training-v11-rabies-ti';
COMMIT;
