-- The practice's "Euthanasia Group" package (V9), copied from the live catalog (names, prices, aftercare
-- flags only; no client data). TEST stack only. Rows have pimsId 'training-euthpkg-…'; a re-run replaces them.
\set ON_ERROR_STOP on
BEGIN;
UPDATE package_items SET "isDeleted"=true, "pimsId"='training-old-' || id WHERE "packageId" IN (SELECT id FROM packages WHERE "pimsId"='training-euthpkg');
UPDATE package_item_group SET "isDeleted"=true, "pimsId"='training-old-' || id WHERE "packageId" IN (SELECT id FROM packages WHERE "pimsId"='training-euthpkg');
UPDATE packages SET "isDeleted"=true, "isActive"=false, "pimsId"='training-old-' || id WHERE "pimsId"='training-euthpkg';
INSERT INTO packages (name, kind, price, "practiceId", "pimsId", "pimsType", "isActive", "isDeleted")
VALUES ('Euthanasia Group', 'bundle', 0, 1, 'training-euthpkg', 'scout', true, false);
INSERT INTO package_item_group ("practiceId","packageId",name,"selectionMode","allowedQuantity","isRequired","sortOrder","pimsId","pimsType","isActive","isDeleted")
SELECT 1, id, 'Pick Euthanasia Service', 'choice', 1, true, 0, 'training-euthpkg-g157', 'scout', true, false FROM packages WHERE "pimsId"='training-euthpkg';
INSERT INTO package_item_group ("practiceId","packageId",name,"selectionMode","allowedQuantity","isRequired","sortOrder","pimsId","pimsType","isActive","isDeleted")
SELECT 1, id, 'Pick Cremation', 'choice', 1, false, 1, 'training-euthpkg-g158', 'scout', true, false FROM packages WHERE "pimsId"='training-euthpkg';
INSERT INTO package_item_group ("practiceId","packageId",name,"selectionMode","allowedQuantity","isRequired","sortOrder","pimsId","pimsType","isActive","isDeleted")
SELECT 1, id, 'Urgency?', 'any', 1, false, 2, 'training-euthpkg-g159', 'scout', true, false FROM packages WHERE "pimsId"='training-euthpkg';
INSERT INTO procedures (name, price, cost, "taxLevelValue", "practiceId", "pimsId", "pimsType", "isActive", "isDeleted", "isAftercare", "aftercareType")
SELECT 'Euthanasia Procedure - Feline', 498, 0, 0, 1, 'training-euthpkg-p1', 'scout', true, false, false, NULL
 WHERE NOT EXISTS (SELECT 1 FROM procedures WHERE "pimsId"='training-euthpkg-p1');
INSERT INTO package_items ("practiceId","packageId","groupId","procedureId",quantity,"sortOrder","pimsId","pimsType","isActive","isDeleted")
SELECT 1, g."packageId", g.id, p.id, 1, 0, 'training-euthpkg-i1', 'scout', true, false
  FROM package_item_group g, procedures p
 WHERE g."pimsId"='training-euthpkg-g157' AND g."isDeleted"=false AND p."pimsId"='training-euthpkg-p1';
INSERT INTO procedures (name, price, cost, "taxLevelValue", "practiceId", "pimsId", "pimsType", "isActive", "isDeleted", "isAftercare", "aftercareType")
SELECT 'Euthanasia - Pocket Pet / Bird', 347, 0, 0, 1, 'training-euthpkg-p867', 'scout', true, false, false, NULL
 WHERE NOT EXISTS (SELECT 1 FROM procedures WHERE "pimsId"='training-euthpkg-p867');
INSERT INTO package_items ("practiceId","packageId","groupId","procedureId",quantity,"sortOrder","pimsId","pimsType","isActive","isDeleted")
SELECT 1, g."packageId", g.id, p.id, 1, 1, 'training-euthpkg-i867', 'scout', true, false
  FROM package_item_group g, procedures p
 WHERE g."pimsId"='training-euthpkg-g157' AND g."isDeleted"=false AND p."pimsId"='training-euthpkg-p867';
INSERT INTO procedures (name, price, cost, "taxLevelValue", "practiceId", "pimsId", "pimsType", "isActive", "isDeleted", "isAftercare", "aftercareType")
SELECT 'Euthanasia Procedure - Canine,  < 40lb', 549, 0, 0, 1, 'training-euthpkg-p836', 'scout', true, false, false, NULL
 WHERE NOT EXISTS (SELECT 1 FROM procedures WHERE "pimsId"='training-euthpkg-p836');
INSERT INTO package_items ("practiceId","packageId","groupId","procedureId",quantity,"sortOrder","pimsId","pimsType","isActive","isDeleted")
SELECT 1, g."packageId", g.id, p.id, 1, 2, 'training-euthpkg-i836', 'scout', true, false
  FROM package_item_group g, procedures p
 WHERE g."pimsId"='training-euthpkg-g157' AND g."isDeleted"=false AND p."pimsId"='training-euthpkg-p836';
INSERT INTO procedures (name, price, cost, "taxLevelValue", "practiceId", "pimsId", "pimsType", "isActive", "isDeleted", "isAftercare", "aftercareType")
SELECT 'Euthanasia Procedure - Canine, 40-90lb', 585, 0, 0, 1, 'training-euthpkg-p837', 'scout', true, false, false, NULL
 WHERE NOT EXISTS (SELECT 1 FROM procedures WHERE "pimsId"='training-euthpkg-p837');
INSERT INTO package_items ("practiceId","packageId","groupId","procedureId",quantity,"sortOrder","pimsId","pimsType","isActive","isDeleted")
SELECT 1, g."packageId", g.id, p.id, 1, 3, 'training-euthpkg-i837', 'scout', true, false
  FROM package_item_group g, procedures p
 WHERE g."pimsId"='training-euthpkg-g157' AND g."isDeleted"=false AND p."pimsId"='training-euthpkg-p837';
INSERT INTO procedures (name, price, cost, "taxLevelValue", "practiceId", "pimsId", "pimsType", "isActive", "isDeleted", "isAftercare", "aftercareType")
SELECT 'Euthanasia Procedure - Canine, 90 lb to 119 lb', 624, 0, 0, 1, 'training-euthpkg-p838', 'scout', true, false, false, NULL
 WHERE NOT EXISTS (SELECT 1 FROM procedures WHERE "pimsId"='training-euthpkg-p838');
INSERT INTO package_items ("practiceId","packageId","groupId","procedureId",quantity,"sortOrder","pimsId","pimsType","isActive","isDeleted")
SELECT 1, g."packageId", g.id, p.id, 1, 4, 'training-euthpkg-i838', 'scout', true, false
  FROM package_item_group g, procedures p
 WHERE g."pimsId"='training-euthpkg-g157' AND g."isDeleted"=false AND p."pimsId"='training-euthpkg-p838';
INSERT INTO procedures (name, price, cost, "taxLevelValue", "practiceId", "pimsId", "pimsType", "isActive", "isDeleted", "isAftercare", "aftercareType")
SELECT 'Euthanasia Procedure - Canine,  > 120', 674, 0, 0, 1, 'training-euthpkg-p1607', 'scout', true, false, false, NULL
 WHERE NOT EXISTS (SELECT 1 FROM procedures WHERE "pimsId"='training-euthpkg-p1607');
INSERT INTO package_items ("practiceId","packageId","groupId","procedureId",quantity,"sortOrder","pimsId","pimsType","isActive","isDeleted")
SELECT 1, g."packageId", g.id, p.id, 1, 5, 'training-euthpkg-i1607', 'scout', true, false
  FROM package_item_group g, procedures p
 WHERE g."pimsId"='training-euthpkg-g157' AND g."isDeleted"=false AND p."pimsId"='training-euthpkg-p1607';
INSERT INTO procedures (name, price, cost, "taxLevelValue", "practiceId", "pimsId", "pimsType", "isActive", "isDeleted", "isAftercare", "aftercareType")
SELECT 'Burial at Sea (Cremation - NO Ashes Returned) - Canine < 40 lb', 299, 0, 0, 1, 'training-euthpkg-p1616', 'scout', true, false, true, 'burial_at_sea'
 WHERE NOT EXISTS (SELECT 1 FROM procedures WHERE "pimsId"='training-euthpkg-p1616');
INSERT INTO package_items ("practiceId","packageId","groupId","procedureId",quantity,"sortOrder","pimsId","pimsType","isActive","isDeleted")
SELECT 1, g."packageId", g.id, p.id, 1, 0, 'training-euthpkg-i1616', 'scout', true, false
  FROM package_item_group g, procedures p
 WHERE g."pimsId"='training-euthpkg-g158' AND g."isDeleted"=false AND p."pimsId"='training-euthpkg-p1616';
INSERT INTO procedures (name, price, cost, "taxLevelValue", "practiceId", "pimsId", "pimsType", "isActive", "isDeleted", "isAftercare", "aftercareType")
SELECT 'Burial at Sea (Cremation - NO Ashes Returned) - Canine 40-90 lb', 338, 0, 0, 1, 'training-euthpkg-p1617', 'scout', true, false, true, 'burial_at_sea'
 WHERE NOT EXISTS (SELECT 1 FROM procedures WHERE "pimsId"='training-euthpkg-p1617');
INSERT INTO package_items ("practiceId","packageId","groupId","procedureId",quantity,"sortOrder","pimsId","pimsType","isActive","isDeleted")
SELECT 1, g."packageId", g.id, p.id, 1, 1, 'training-euthpkg-i1617', 'scout', true, false
  FROM package_item_group g, procedures p
 WHERE g."pimsId"='training-euthpkg-g158' AND g."isDeleted"=false AND p."pimsId"='training-euthpkg-p1617';
INSERT INTO procedures (name, price, cost, "taxLevelValue", "practiceId", "pimsId", "pimsType", "isActive", "isDeleted", "isAftercare", "aftercareType")
SELECT 'Burial at Sea (Cremation - NO Ashes Returned) - Canine > 120 lb', 414, 0, 0, 1, 'training-euthpkg-p1619', 'scout', true, false, true, 'burial_at_sea'
 WHERE NOT EXISTS (SELECT 1 FROM procedures WHERE "pimsId"='training-euthpkg-p1619');
INSERT INTO package_items ("practiceId","packageId","groupId","procedureId",quantity,"sortOrder","pimsId","pimsType","isActive","isDeleted")
SELECT 1, g."packageId", g.id, p.id, 1, 2, 'training-euthpkg-i1619', 'scout', true, false
  FROM package_item_group g, procedures p
 WHERE g."pimsId"='training-euthpkg-g158' AND g."isDeleted"=false AND p."pimsId"='training-euthpkg-p1619';
INSERT INTO procedures (name, price, cost, "taxLevelValue", "practiceId", "pimsId", "pimsType", "isActive", "isDeleted", "isAftercare", "aftercareType")
SELECT 'Burial at Sea (Cremation - NO Ashes Returned) - Exotic / Pocket Pet', 160, 0, 0, 1, 'training-euthpkg-p1614', 'scout', true, false, true, 'burial_at_sea'
 WHERE NOT EXISTS (SELECT 1 FROM procedures WHERE "pimsId"='training-euthpkg-p1614');
INSERT INTO package_items ("practiceId","packageId","groupId","procedureId",quantity,"sortOrder","pimsId","pimsType","isActive","isDeleted")
SELECT 1, g."packageId", g.id, p.id, 1, 3, 'training-euthpkg-i1614', 'scout', true, false
  FROM package_item_group g, procedures p
 WHERE g."pimsId"='training-euthpkg-g158' AND g."isDeleted"=false AND p."pimsId"='training-euthpkg-p1614';
INSERT INTO procedures (name, price, cost, "taxLevelValue", "practiceId", "pimsId", "pimsType", "isActive", "isDeleted", "isAftercare", "aftercareType")
SELECT 'Burial at Sea (Cremation - NO Ashes Returned) - Feline', 262, 0, 0, 1, 'training-euthpkg-p1615', 'scout', true, false, true, 'burial_at_sea'
 WHERE NOT EXISTS (SELECT 1 FROM procedures WHERE "pimsId"='training-euthpkg-p1615');
INSERT INTO package_items ("practiceId","packageId","groupId","procedureId",quantity,"sortOrder","pimsId","pimsType","isActive","isDeleted")
SELECT 1, g."packageId", g.id, p.id, 1, 4, 'training-euthpkg-i1615', 'scout', true, false
  FROM package_item_group g, procedures p
 WHERE g."pimsId"='training-euthpkg-g158' AND g."isDeleted"=false AND p."pimsId"='training-euthpkg-p1615';
INSERT INTO procedures (name, price, cost, "taxLevelValue", "practiceId", "pimsId", "pimsType", "isActive", "isDeleted", "isAftercare", "aftercareType")
SELECT 'Burial at Sea (Cremation - NO Ashes Returned) Canine 90 - 120 lb', 375, 0, 0, 1, 'training-euthpkg-p1618', 'scout', true, false, true, 'burial_at_sea'
 WHERE NOT EXISTS (SELECT 1 FROM procedures WHERE "pimsId"='training-euthpkg-p1618');
INSERT INTO package_items ("practiceId","packageId","groupId","procedureId",quantity,"sortOrder","pimsId","pimsType","isActive","isDeleted")
SELECT 1, g."packageId", g.id, p.id, 1, 5, 'training-euthpkg-i1618', 'scout', true, false
  FROM package_item_group g, procedures p
 WHERE g."pimsId"='training-euthpkg-g158' AND g."isDeleted"=false AND p."pimsId"='training-euthpkg-p1618';
INSERT INTO procedures (name, price, cost, "taxLevelValue", "practiceId", "pimsId", "pimsType", "isActive", "isDeleted", "isAftercare", "aftercareType")
SELECT 'Hold pet for Burial', 100, 0, 0, 1, 'training-euthpkg-p69183', 'scout', true, false, true, 'home_burial'
 WHERE NOT EXISTS (SELECT 1 FROM procedures WHERE "pimsId"='training-euthpkg-p69183');
INSERT INTO package_items ("practiceId","packageId","groupId","procedureId",quantity,"sortOrder","pimsId","pimsType","isActive","isDeleted")
SELECT 1, g."packageId", g.id, p.id, 1, 6, 'training-euthpkg-i69183', 'scout', true, false
  FROM package_item_group g, procedures p
 WHERE g."pimsId"='training-euthpkg-g158' AND g."isDeleted"=false AND p."pimsId"='training-euthpkg-p69183';
INSERT INTO procedures (name, price, cost, "taxLevelValue", "practiceId", "pimsId", "pimsType", "isActive", "isDeleted", "isAftercare", "aftercareType")
SELECT 'Private cremation (Ashes Returned) - Canine < 40 lb', 477, 0, 0, 1, 'training-euthpkg-p1610', 'scout', true, false, true, 'private_cremation'
 WHERE NOT EXISTS (SELECT 1 FROM procedures WHERE "pimsId"='training-euthpkg-p1610');
INSERT INTO package_items ("practiceId","packageId","groupId","procedureId",quantity,"sortOrder","pimsId","pimsType","isActive","isDeleted")
SELECT 1, g."packageId", g.id, p.id, 1, 7, 'training-euthpkg-i1610', 'scout', true, false
  FROM package_item_group g, procedures p
 WHERE g."pimsId"='training-euthpkg-g158' AND g."isDeleted"=false AND p."pimsId"='training-euthpkg-p1610';
INSERT INTO procedures (name, price, cost, "taxLevelValue", "practiceId", "pimsId", "pimsType", "isActive", "isDeleted", "isAftercare", "aftercareType")
SELECT 'Private cremation (Ashes Returned) - Canine > 120 lb', 617, 0, 0, 1, 'training-euthpkg-p1613', 'scout', true, false, true, 'private_cremation'
 WHERE NOT EXISTS (SELECT 1 FROM procedures WHERE "pimsId"='training-euthpkg-p1613');
INSERT INTO package_items ("practiceId","packageId","groupId","procedureId",quantity,"sortOrder","pimsId","pimsType","isActive","isDeleted")
SELECT 1, g."packageId", g.id, p.id, 1, 8, 'training-euthpkg-i1613', 'scout', true, false
  FROM package_item_group g, procedures p
 WHERE g."pimsId"='training-euthpkg-g158' AND g."isDeleted"=false AND p."pimsId"='training-euthpkg-p1613';
INSERT INTO procedures (name, price, cost, "taxLevelValue", "practiceId", "pimsId", "pimsType", "isActive", "isDeleted", "isAftercare", "aftercareType")
SELECT 'Private cremation (Ashes Returned) - Canine 40-90 lb', 516, 0, 0, 1, 'training-euthpkg-p1611', 'scout', true, false, true, 'private_cremation'
 WHERE NOT EXISTS (SELECT 1 FROM procedures WHERE "pimsId"='training-euthpkg-p1611');
INSERT INTO package_items ("practiceId","packageId","groupId","procedureId",quantity,"sortOrder","pimsId","pimsType","isActive","isDeleted")
SELECT 1, g."packageId", g.id, p.id, 1, 9, 'training-euthpkg-i1611', 'scout', true, false
  FROM package_item_group g, procedures p
 WHERE g."pimsId"='training-euthpkg-g158' AND g."isDeleted"=false AND p."pimsId"='training-euthpkg-p1611';
INSERT INTO procedures (name, price, cost, "taxLevelValue", "practiceId", "pimsId", "pimsType", "isActive", "isDeleted", "isAftercare", "aftercareType")
SELECT 'Private cremation (Ashes Returned) - Canine 91-120 lb', 579, 0, 0, 1, 'training-euthpkg-p1612', 'scout', true, false, true, 'private_cremation'
 WHERE NOT EXISTS (SELECT 1 FROM procedures WHERE "pimsId"='training-euthpkg-p1612');
INSERT INTO package_items ("practiceId","packageId","groupId","procedureId",quantity,"sortOrder","pimsId","pimsType","isActive","isDeleted")
SELECT 1, g."packageId", g.id, p.id, 1, 10, 'training-euthpkg-i1612', 'scout', true, false
  FROM package_item_group g, procedures p
 WHERE g."pimsId"='training-euthpkg-g158' AND g."isDeleted"=false AND p."pimsId"='training-euthpkg-p1612';
INSERT INTO procedures (name, price, cost, "taxLevelValue", "practiceId", "pimsId", "pimsType", "isActive", "isDeleted", "isAftercare", "aftercareType")
SELECT 'Private cremation (Ashes Returned) - Exotic / Pocket Pet', 375, 0, 0, 1, 'training-euthpkg-p1608', 'scout', true, false, true, 'private_cremation'
 WHERE NOT EXISTS (SELECT 1 FROM procedures WHERE "pimsId"='training-euthpkg-p1608');
INSERT INTO package_items ("practiceId","packageId","groupId","procedureId",quantity,"sortOrder","pimsId","pimsType","isActive","isDeleted")
SELECT 1, g."packageId", g.id, p.id, 1, 11, 'training-euthpkg-i1608', 'scout', true, false
  FROM package_item_group g, procedures p
 WHERE g."pimsId"='training-euthpkg-g158' AND g."isDeleted"=false AND p."pimsId"='training-euthpkg-p1608';
INSERT INTO procedures (name, price, cost, "taxLevelValue", "practiceId", "pimsId", "pimsType", "isActive", "isDeleted", "isAftercare", "aftercareType")
SELECT 'Private cremation (Ashes Returned) - Feline', 440, 0, 0, 1, 'training-euthpkg-p1609', 'scout', true, false, true, 'private_cremation'
 WHERE NOT EXISTS (SELECT 1 FROM procedures WHERE "pimsId"='training-euthpkg-p1609');
INSERT INTO package_items ("practiceId","packageId","groupId","procedureId",quantity,"sortOrder","pimsId","pimsType","isActive","isDeleted")
SELECT 1, g."packageId", g.id, p.id, 1, 12, 'training-euthpkg-i1609', 'scout', true, false
  FROM package_item_group g, procedures p
 WHERE g."pimsId"='training-euthpkg-g158' AND g."isDeleted"=false AND p."pimsId"='training-euthpkg-p1609';
INSERT INTO procedures (name, price, cost, "taxLevelValue", "practiceId", "pimsId", "pimsType", "isActive", "isDeleted", "isAftercare", "aftercareType")
SELECT 'Euthanasia - Same Day Emergent', 146, 0, 0, 1, 'training-euthpkg-p29', 'scout', true, false, false, NULL
 WHERE NOT EXISTS (SELECT 1 FROM procedures WHERE "pimsId"='training-euthpkg-p29');
INSERT INTO package_items ("practiceId","packageId","groupId","procedureId",quantity,"sortOrder","pimsId","pimsType","isActive","isDeleted")
SELECT 1, g."packageId", g.id, p.id, 1, 0, 'training-euthpkg-i29', 'scout', true, false
  FROM package_item_group g, procedures p
 WHERE g."pimsId"='training-euthpkg-g159' AND g."isDeleted"=false AND p."pimsId"='training-euthpkg-p29';
COMMIT;
