-- V9 / V10 demo data: June Whitfield and her cat Clementine, the euthanasia catalog items, and a fresh
-- household each take (the last take's client, pet and visits are marked deleted). TEST stack only:
--   psql -d vayd_api_test_e2e -f emr-euth.sql
-- Everything it adds has a pimsId starting "training-euth".
\set ON_ERROR_STOP on
BEGIN;
UPDATE appointments SET "isDeleted"=true
 WHERE "patientId" IN (SELECT id FROM patients WHERE "pimsId" LIKE 'training-euth%');
UPDATE visit_estimates SET "isDeleted"=true
 WHERE "patientId" IN (SELECT id FROM patients WHERE "pimsId" LIKE 'training-euth%');
UPDATE patients SET "isDeleted"=true, "isActive"=false, "pimsId"='training-old-' || id
 WHERE "pimsId" LIKE 'training-euth%';
UPDATE clients SET "isDeleted"=true, "isActive"=false, "pimsId"='training-old-' || id
 WHERE "pimsId" LIKE 'training-euth%';

INSERT INTO procedures (name, price, cost, "taxLevelValue", "practiceId", "pimsId", "pimsType", "isActive", "isDeleted")
SELECT 'Euthanasia - at home', 350, 0, 0, 1, 'training-euth-euth', 'scout', true, false
 WHERE NOT EXISTS (SELECT 1 FROM procedures WHERE "pimsId"='training-euth-euth');
INSERT INTO procedures (name, price, cost, "taxLevelValue", "practiceId", "pimsId", "pimsType", "isActive", "isDeleted", "isAftercare", "aftercareType")
SELECT 'Private cremation', 165, 0, 0, 1, 'training-euth-cremation', 'scout', true, false, true, 'private_cremation'
 WHERE NOT EXISTS (SELECT 1 FROM procedures WHERE "pimsId"='training-euth-cremation');
INSERT INTO procedures (name, price, cost, "taxLevelValue", "practiceId", "pimsId", "pimsType", "isActive", "isDeleted")
SELECT 'Clay paw print', 45, 0, 0, 1, 'training-euth-paw', 'scout', true, false
 WHERE NOT EXISTS (SELECT 1 FROM procedures WHERE "pimsId"='training-euth-paw');

INSERT INTO clients ("firstName","lastName",email,phone1,"phone1Type","phone1SmsEnabled","practiceId","pimsId","pimsType",
  "isActive","isDeleted","doNotEmail","doNotSendReminders","smsOptOut","noEmail")
VALUES ('June','Whitfield','june.whitfield@example.com','+15555550188','Mobile',true,1,'training-euth-client','scout',
  true,false,false,false,false,false);
INSERT INTO patients (name, species, dob, weight, "practiceId","pimsId","pimsType","isActive","isDeleted")
VALUES ('Clementine','cat','2010-05-02T12:00:00Z','9.8',1,'training-euth-clementine','scout',true,false);
INSERT INTO clients_patients_patients ("clientsId","patientsId")
SELECT c.id, p.id FROM clients c, patients p
 WHERE c."pimsId"='training-euth-client' AND p."pimsId"='training-euth-clementine';
COMMIT;
SELECT c.id || ' ' || p.id FROM clients c, patients p
 WHERE c."pimsId"='training-euth-client' AND p."pimsId"='training-euth-clementine';
