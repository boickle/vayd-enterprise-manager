-- Labs training demo (vayd_api_test_* only): catalog labs, the practice's in-house lab forms (no number ranges,
-- owner decision Nov 8, 2026), IDEXX labs with the real catalog's codes, one archived form, and Maple's eVet 4Dx
-- from last year. Idempotent (keyed on pimsId 'labs-train-*'). Run: psql -d <db> -v maple=<id> -f labs-demo.sql
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'vayd_api_test%' THEN RAISE EXCEPTION 'labs-demo.sql runs only on a vayd_api_test* database'; END IF;
END $$;

-- Catalog labs.
CREATE TEMP TABLE _labs(pims text, name text, price numeric, code text);
INSERT INTO _labs VALUES
  ('labs-train-glucose', 'Blood glucose (in-house)', 25, NULL),
  ('labs-train-4dx',     'Heartworm 4Dx (in-house)', 48, NULL),
  ('labs-train-dip',     'Urine dipstick (in-house)', 20, NULL),
  ('labs-train-fecal',   'Fecal float', 30, NULL),
  ('labs-train-cbc',     'CBC - standard', 186.36, '375'),
  ('labs-train-ua',      'Urinalysis', 115.37, '910');
INSERT INTO labs (name, code, price, cost, "practiceId", "pimsType", "pimsId", "isActive", "isDeleted", "taxLevelValue",
  "isIntegratedLabItem", "integrationCompany", "integrationOrderType", "integrationOrderCode", "integrationOrderCodes")
SELECT l.name, l.code, l.price, 1, 1, 'labs-train', l.pims, true, false, 0,
  l.code IS NOT NULL, CASE WHEN l.code IS NOT NULL THEN 'idexx' END, CASE WHEN l.code IS NOT NULL THEN 'IDEXXREF' END, l.code,
  CASE WHEN l.code IS NOT NULL THEN jsonb_build_array(jsonb_build_object('company','idexx','orderType','IDEXXREF','code',l.code)) END
FROM _labs l WHERE NOT EXISTS (SELECT 1 FROM labs x WHERE x."pimsId" = l.pims);

-- In-house lab forms, named as in the practice; no min/max on number rows.
CREATE TEMP TABLE _forms(pims text, name text, sort int, elements jsonb, lab text, published boolean);
INSERT INTO _forms VALUES
  ('labs-train-form-glucose', 'BLOOD GLUCOSE', 10,
   '[{"key":"blood-glucose","name":"BLOOD GLUCOSE","valueType":"number","min":null,"max":null,"units":"mg/dl"}]', 'labs-train-glucose', true),
  ('labs-train-form-4dx', 'Heartworm 4dx', 40,
   '[{"key":"heartworm","name":"Heartworm","valueType":"select","min":null,"max":null,"units":null,"options":["Negative","Positive"],"abnormalOptions":["Positive"],"defaultValue":"Negative"},
     {"key":"e-canis","name":"E. canis","valueType":"select","min":null,"max":null,"units":null,"options":["Negative","Positive"],"abnormalOptions":["Positive"],"defaultValue":"Negative"},
     {"key":"e-ewingii","name":"E. ewingii","valueType":"select","min":null,"max":null,"units":null,"options":["Negative","Positive"],"abnormalOptions":["Positive"],"defaultValue":"Negative"},
     {"key":"b-burgdorferi","name":"B. burgdorferi (Lyme)","valueType":"select","min":null,"max":null,"units":null,"options":["Negative","Positive"],"abnormalOptions":["Positive"],"defaultValue":"Negative"},
     {"key":"anaplasma","name":"Anaplasma spp","valueType":"select","min":null,"max":null,"units":null,"options":["Negative","Positive"],"abnormalOptions":["Positive"],"defaultValue":"Negative"}]', 'labs-train-4dx', true),
  ('labs-train-form-dip', 'Urine Dipstick', 70,
   '[{"key":"specific-gravity","name":"Specific gravity","valueType":"number","min":null,"max":null,"units":null},
     {"key":"ph","name":"pH","valueType":"number","min":null,"max":null,"units":"pH"},
     {"key":"protein","name":"Protein","valueType":"number","min":null,"max":null,"units":"mg/dl"},
     {"key":"glucose","name":"Glucose","valueType":"number","min":null,"max":null,"units":"mg/dl"},
     {"key":"leukocytes","name":"Leukocytes","valueType":"select","min":null,"max":null,"units":null,"options":["Negative","Trace","Positive"],"abnormalOptions":["Positive"],"defaultValue":"Negative"}]', 'labs-train-dip', true),
  ('labs-train-form-old', 'Glucose curve (old)', 90,
   '[{"key":"glucose","name":"Glucose","valueType":"number","min":null,"max":null,"units":"mg/dl"}]', NULL, false);
INSERT INTO lab_form_templates ("practiceId", name, category, mode, elements, "sortOrder", "isPublished", "pimsType", "pimsId")
SELECT 1, f.name, 'In-house lab work', 'analytes', f.elements, f.sort, f.published, 'labs-train', f.pims
FROM _forms f WHERE NOT EXISTS (SELECT 1 FROM lab_form_templates x WHERE x."pimsId" = f.pims);
INSERT INTO lab_form_template_labs ("labFormTemplateId", "labId")
SELECT t.id, l.id FROM _forms f
  JOIN lab_form_templates t ON t."pimsId" = f.pims
  JOIN labs l ON l."pimsId" = f.lab
WHERE NOT EXISTS (SELECT 1 FROM lab_form_template_labs x WHERE x."labFormTemplateId" = t.id AND x."labId" = l.id);

-- The write-up forms from demo-names.sh use the practice's names.
UPDATE lab_form_templates SET name = 'Ear Cytology' WHERE name = 'Ear cytology' AND "isDeleted" = false;
UPDATE lab_form_templates SET name = 'Skin Cytology' WHERE name = 'Skin cytology' AND "isDeleted" = false;

-- Maple's eVet 4Dx from a year ago (Anaplasma POSITIVE), with eVet's form and element names (LAB-10).
INSERT INTO evet_lab_form_definitions ("formPimsId", name) VALUES ('6809', 'Heartworm 4Dx') ON CONFLICT ("formPimsId") DO UPDATE SET name = EXCLUDED.name;
INSERT INTO evet_lab_form_elements ("elementPimsId", "formPimsId", name, units, "sortOrder") VALUES
  ('15876','6809','Heartworm Ag',NULL,1), ('15877','6809','Ehrlichia',NULL,2), ('15878','6809','Lyme',NULL,3),
  ('15879','6809','Control',NULL,4), ('15880','6809','Anaplasma',NULL,5)
ON CONFLICT ("elementPimsId") DO NOTHING;
SELECT set_config('labs_train.maple', :'maple', false) \gset
DO $$
DECLARE maple int := current_setting('labs_train.maple')::int; t int; ti int; r int;
  lab4dx int := (SELECT id FROM labs WHERE "pimsId" = 'labs-train-4dx');
BEGIN
  IF EXISTS (SELECT 1 FROM treatments WHERE "pimsId" = 'labs-train-evet-treatment') THEN RETURN; END IF;
  INSERT INTO treatments ("patientId","practiceId","pimsId","pimsType","isActive","isDeleted","isEstimate")
    VALUES (maple, 1, 'labs-train-evet-treatment', 'EVET', true, false, false) RETURNING id INTO t;
  INSERT INTO treatment_items ("treatmentId","labId","serviceDate",quantity,price,"practiceId","pimsId","pimsType","isActive","isDeleted")
    VALUES (t, lab4dx, now() - interval '1 year', 1, 48, 1, 'labs-train-evet-item', 'EVET', true, false) RETURNING id INTO ti;
  INSERT INTO lab_form_results ("treatmentItemId","labFormPimsId",summary,"pimsId","pimsType","isActive","isDeleted")
    VALUES (ti, '6809', NULL, 'labs-train-evet-result', 'EVET', true, false) RETURNING id INTO r;
  INSERT INTO lab_form_result_values ("labFormResultId","labFormElementPimsId",results,comments,"pimsId","pimsType","isActive","isDeleted")
  SELECT r, e::text, CASE WHEN e = 15880 THEN 'POSITIVE' ELSE 'NEGATIVE' END, NULL, 'labs-train-evet-v' || e, 'EVET', true, false
  FROM unnest(ARRAY[15876,15877,15878,15879,15880]) AS e;
END $$;
