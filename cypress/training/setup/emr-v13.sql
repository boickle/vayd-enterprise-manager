-- V13 demo data: Maple's staff-only History tab. Builds on V11's eVet Carprofen script and rabies dose, then logs
-- the steps the app itself logs (directions entered by the tech for the vet, approval, label, a dose fixed after
-- sign-off, a lab result entered and completed). TEST stack only:
--   psql -d vayd_api_test_e2e -v pet=<Maple id> -v vet=<Dr. Lane id> -v tech=<Jordan Pike id> -f emr-v13.sql
\set ON_ERROR_STOP on
\ir emr-v11.sql
BEGIN;
DELETE FROM clinical_record_events WHERE "patientId"=:pet;
INSERT INTO clinical_record_events ("practiceId","entityType","entityId","patientId",kind,"actorEmployeeId","actorName","actorRole","forEmployeeId","forName","rxNumber","before","after",created)
SELECT 1,'prescription',p.id::text,:pet,'directions_entered',:tech,'Jordan Pike','tech',:vet,'Dr. Avery Lane',971204,NULL::jsonb,
  '{"instructions":"Give 1 caplet by mouth every 12 hours with food.","qty":30,"refill":2,"refillExpiration":null}'::jsonb, now() - interval '3 days 2 hours'
  FROM prescriptions p WHERE p."pimsId"='training-v11-rx-carprofen'
UNION ALL
SELECT 1,'prescription',p.id::text,:pet,'approved_for_dispensing',:vet,'Avery Lane','vet',NULL,NULL,971204,NULL,NULL, now() - interval '3 days 1 hour 50 minutes'
  FROM prescriptions p WHERE p."pimsId"='training-v11-rx-carprofen'
UNION ALL
SELECT 1,'prescription',p.id::text,:pet,'label_printed',:tech,'Jordan Pike','tech',NULL,NULL,971204,NULL,NULL, now() - interval '3 days 1 hour 45 minutes'
  FROM prescriptions p WHERE p."pimsId"='training-v11-rx-carprofen'
UNION ALL
SELECT 1,'vaccination',v.id::text,:pet,'dose_changed',:vet,'Avery Lane','vet',NULL,NULL,NULL,
  '{"vaccineName":"Rabies 3yr Vaccine","tagNumber":"R-20471"}'::jsonb,'{"vaccineName":"Rabies 3yr Vaccine","tagNumber":"R-20417"}'::jsonb, now() - interval '2 days 4 hours'
  FROM vaccination_logs v WHERE v."pimsId"='training-v11-rabies-dose'
UNION ALL
SELECT 1,'lab_result','training-v13-lab',:pet,'result_entered',:tech,'Jordan Pike','tech',NULL,NULL,NULL,NULL,
  '{"templateName":"Skin cytology","status":"pending","values":{},"summary":"Cocci, moderate numbers.","serviceDate":null}'::jsonb, now() - interval '5 hours'
UNION ALL
SELECT 1,'lab_result','training-v13-lab',:pet,'result_completed',:vet,'Avery Lane','vet',NULL,NULL,NULL,
  '{"templateName":"Skin cytology","status":"pending","values":{},"summary":"Cocci, moderate numbers.","serviceDate":null}'::jsonb,
  '{"templateName":"Skin cytology","status":"complete","values":{},"summary":"Cocci, moderate numbers. Superficial pyoderma.","serviceDate":null}'::jsonb, now() - interval '4 hours';
COMMIT;
