-- LV-09: one IDEXX result Scout can't match (test DB only). A copy of a real sandbox result, sent under
-- "Biscuit (Chen-Lee)" with no Scout order and no pet, as a result ordered outside Scout would arrive.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'vayd_api_test%' THEN RAISE EXCEPTION 'labs-unmatched.sql runs only on a vayd_api_test* database'; END IF;
END $$;
DELETE FROM task_link WHERE "entityType"='idexx_result' AND "entityId" IN (SELECT id FROM idexx_results WHERE "idexxResultId" LIKE 'labs-train-unmatched-%');
DELETE FROM idexx_results WHERE "idexxResultId" LIKE 'labs-train-unmatched-%';
INSERT INTO idexx_results ("isActive","isDeleted","practiceId","idexxResultId","patientId","orderId","idexxOrderId","requisitionId",
  "accessionId","status","modality","veterinarian","patientName","clientLastName","hasOutOfRange","hasCritical","delayed","payload",
  "idexxUpdatedAt","specimenCollectionDate","receivedAt")
SELECT true, false, "practiceId", 'labs-train-unmatched-' || extract(epoch from now())::bigint, NULL, NULL, NULL, NULL,
  "accessionId", status, modality, 'Dr. Lane', 'Biscuit', 'Chen-Lee', "hasOutOfRange", "hasCritical", false,
  jsonb_set(jsonb_set(jsonb_set(payload, '{patient,name}', '"Biscuit"'), '{patient,clientLastName}', '"Chen-Lee"'), '{patient,patientId}', 'null'),
  now(), now(), now()
FROM idexx_results WHERE status='COMPLETE' AND "patientId" IS NOT NULL AND "idexxResultId" NOT LIKE 'labs-train-%' ORDER BY id LIMIT 1;
