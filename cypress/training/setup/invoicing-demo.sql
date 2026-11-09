-- Invoicing training demo catalog + Maple's membership (vayd_api_test_inv only).
INSERT INTO inventory_items (name, price, cost, "taxLevelValue", "practiceId", "pimsId", "pimsType", "isActive", "isDeleted", "isVaccine")
SELECT 'DHPP vaccine', 32, 0, 0, 1, 'inv-train-dhpp', 'scout', true, false, true WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE "pimsId"='inv-train-dhpp');
INSERT INTO inventory_items (name, price, cost, "taxLevelValue", "practiceId", "pimsId", "pimsType", "isActive", "isDeleted", "isVaccine")
SELECT 'Dental chews', 24, 0, 1, 1, 'inv-train-chews', 'scout', true, false, false WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE "pimsId"='inv-train-chews');
INSERT INTO inventory_items (name, price, cost, "taxLevelValue", "practiceId", "pimsId", "pimsType", "isActive", "isDeleted", "isVaccine")
SELECT 'Prescription diet, 8 lb bag', 60, 0, 0, 1, 'inv-train-diet', 'scout', true, false, false WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE "pimsId"='inv-train-diet');
INSERT INTO procedures (name, price, cost, "taxLevelValue", "practiceId", "pimsId", "pimsType", "isActive", "isDeleted", "hideOnInvoice")
SELECT 'Biohazard disposal', 8, 0, 0, 1, 'inv-train-biohaz', 'scout', true, false, true WHERE NOT EXISTS (SELECT 1 FROM procedures WHERE "pimsId"='inv-train-biohaz');
INSERT INTO procedures (name, price, cost, "taxLevelValue", "practiceId", "pimsId", "pimsType", "isActive", "isDeleted")
SELECT 'Nail trim', 25, 0, 0, 1, 'inv-train-nails', 'scout', true, false WHERE NOT EXISTS (SELECT 1 FROM procedures WHERE "pimsId"='inv-train-nails');
INSERT INTO procedures (name, price, cost, "taxLevelValue", "practiceId", "pimsId", "pimsType", "isActive", "isDeleted")
SELECT 'Dental cleaning', 450, 0, 0, 1, 'inv-train-dental', 'scout', true, false WHERE NOT EXISTS (SELECT 1 FROM procedures WHERE "pimsId"='inv-train-dental');
INSERT INTO procedures (name, price, cost, "taxLevelValue", "practiceId", "pimsId", "pimsType", "isActive", "isDeleted")
SELECT 'Dental X-rays', 180, 0, 0, 1, 'inv-train-dentalxr', 'scout', true, false WHERE NOT EXISTS (SELECT 1 FROM procedures WHERE "pimsId"='inv-train-dentalxr');
-- Maple: Adult Wellness plan covering one Office exam and one DHPP, 10% off everything else.
INSERT INTO packages (name, "practiceId", "pimsType", "outOfPlanDiscount")
SELECT 'Membership - Adult - Annual', 1, 'inv-train', 10 WHERE NOT EXISTS (SELECT 1 FROM packages WHERE "pimsType"='inv-train');
-- Maple's plan items: Office exam and DHPP included once each (found by name, so it works on any seeded copy).
DO $$
DECLARE pkg int := (SELECT id FROM packages WHERE "pimsType"='inv-train' LIMIT 1); plan int; pi1 int; pi2 int;
  maple int := (SELECT id FROM patients WHERE name='Maple' ORDER BY id LIMIT 1);
  exam int := (SELECT id FROM procedures WHERE name='Office exam' AND "isDeleted"=false ORDER BY id LIMIT 1);
  dhpp int := (SELECT id FROM inventory_items WHERE "pimsId"='inv-train-dhpp' LIMIT 1);
BEGIN
  IF EXISTS (SELECT 1 FROM wellness_plans WHERE "pimsType"='inv-train') THEN RETURN; END IF;
  INSERT INTO package_items ("packageId","practiceId","procedureId",quantity,coverage,"pimsType") VALUES (pkg,1,exam,1,'included','inv-train') RETURNING id INTO pi1;
  INSERT INTO package_items ("packageId","practiceId","inventoryItemId",quantity,coverage,"pimsType") VALUES (pkg,1,dhpp,1,'included','inv-train') RETURNING id INTO pi2;
  INSERT INTO wellness_plans ("wellnessPlanStatusValue","patientId","packageId","practiceId","startDate","pimsType") VALUES (1,maple,pkg,1, now() - interval '30 days','inv-train') RETURNING id INTO plan;
  INSERT INTO wellness_plan_items ("wellnessPlanId","packageItemId","includedQuantity",coverage,"practiceId","pimsType") VALUES (plan,pi1,1,'included',1,'inv-train'),(plan,pi2,1,'included',1,'inv-train');
END $$;

-- INV-16 (end of day and the bank deposit): payment types that "get deposited", a bank account, and today's
-- Cash, Check and card payments. Training/demo data only. Safe to run again: it adds nothing the second time.
INSERT INTO practice_payment_types ("practiceId", name, "optionType", "isDefault", "getsDeposited", "isActive", "sortOrder")
SELECT 1, 'Cash', 'cash', false, true, true, 1 WHERE NOT EXISTS (SELECT 1 FROM practice_payment_types WHERE "practiceId"=1 AND name='Cash');
INSERT INTO practice_payment_types ("practiceId", name, "optionType", "isDefault", "getsDeposited", "isActive", "sortOrder")
SELECT 1, 'Check', 'check', false, true, true, 2 WHERE NOT EXISTS (SELECT 1 FROM practice_payment_types WHERE "practiceId"=1 AND name='Check');
-- The practice's two deposit banks, by their real names (owner, Nov 9, 2026); the account numbers are made up.
INSERT INTO practice_deposit_bank_accounts ("practiceId", name, "accountNumber", "isActive", "sortOrder")
SELECT 1, 'Skowhegan Savings', '000123456', true, 1 WHERE NOT EXISTS (SELECT 1 FROM practice_deposit_bank_accounts WHERE "practiceId"=1 AND name='Skowhegan Savings');
INSERT INTO practice_deposit_bank_accounts ("practiceId", name, "accountNumber", "isActive", "sortOrder")
SELECT 1, 'Bath Savings Institution', '000654321', true, 2 WHERE NOT EXISTS (SELECT 1 FROM practice_deposit_bank_accounts WHERE "practiceId"=1 AND name='Bath Savings Institution');
UPDATE practice_deposit_bank_accounts SET "isActive"=false WHERE "practiceId"=1 AND name='Operating account';

-- The shared test database carries old cash payments with no client or payment type from other tests; set them
-- aside so the undeposited list shows only this demo's payments.
UPDATE visit_invoice_tenders SET "isDeleted"=true
 WHERE method IN ('cash','check') AND "paymentTypeName" IS NULL AND "receivedAt" < now() - interval '1 day' AND "isDeleted"=false;

DO $$
DECLARE chen int := (SELECT id FROM clients WHERE "lastName"='Chen' ORDER BY id LIMIT 1);
  biscuit int := (SELECT id FROM patients WHERE name='Biscuit' ORDER BY id LIMIT 1);
  rivera int := (SELECT id FROM clients WHERE "lastName"='Rivera' ORDER BY id LIMIT 1);
  maple int := (SELECT id FROM patients WHERE name='Maple' ORDER BY id LIMIT 1);
  doc int := (SELECT id FROM employees WHERE "firstName"='Avery' AND "lastName"='Lane' ORDER BY id LIMIT 1);
  cl int := (SELECT id FROM employees WHERE "firstName"='Casey' AND "lastName"='Morgan' ORDER BY id LIMIT 1);
  exam int := (SELECT id FROM procedures WHERE name='Office exam' AND "isDeleted"=false ORDER BY id LIMIT 1);
  nails int := (SELECT id FROM procedures WHERE "pimsId"='inv-train-nails' LIMIT 1);
  n int := COALESCE((SELECT max("scoutInvoiceNumber") FROM visit_invoices WHERE "practiceId"=1), 1000);
  inv uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM visit_invoices WHERE "practiceId"=1 AND "staffAudit"->>'seed'='inv-16-day') THEN RETURN; END IF;
  -- Chen bill, $75 office exam: $40 cash and a $35 check (#1042).
  INSERT INTO visit_invoices ("practiceId","clientId","patientId",status,subtotal,total,"amountPaid","paidAt","finalizedAt","scoutInvoiceNumber","createdByEmployeeId","staffAudit")
  VALUES (1,chen,biscuit,'paid',75,75,75,now(),now(),n+1,cl,'{"seed":"inv-16-day"}') RETURNING id INTO inv;
  INSERT INTO visit_invoice_lines ("practiceId","invoiceId",description,qty,"unitPrice",amount,"catalogItemId","catalogItemType","patientId","providerEmployeeId","taxableAmount")
  VALUES (1,inv,'Office exam',1,75,75,exam,'procedure',biscuit,doc,0);
  INSERT INTO visit_invoice_tenders ("practiceId","invoiceId",amount,method,"paymentTypeName","cashierEmployeeId","cashReceived","changeGiven","receivedAt")
  VALUES (1,inv,40,'cash','Cash',cl,40,0,now());
  INSERT INTO visit_invoice_tenders ("practiceId","invoiceId",amount,method,"paymentTypeName","cashierEmployeeId","checkNumber","receivedAt")
  VALUES (1,inv,35,'check','Check',cl,'1042',now());
  -- Rivera bill, $25 nail trim, paid by card (never deposited).
  INSERT INTO visit_invoices ("practiceId","clientId","patientId",status,subtotal,total,"amountPaid","paidAt","finalizedAt","scoutInvoiceNumber","createdByEmployeeId","staffAudit")
  VALUES (1,rivera,maple,'paid',25,25,25,now(),now(),n+2,cl,'{"seed":"inv-16-day"}') RETURNING id INTO inv;
  INSERT INTO visit_invoice_lines ("practiceId","invoiceId",description,qty,"unitPrice",amount,"catalogItemId","catalogItemType","patientId","providerEmployeeId","taxableAmount")
  VALUES (1,inv,'Nail trim',1,25,25,nails,'procedure',maple,doc,0);
  INSERT INTO visit_invoice_tenders ("practiceId","invoiceId",amount,method,"paymentTypeName","cashierEmployeeId","cardBrand","cardLast4","receivedAt")
  VALUES (1,inv,25,'card','Credit card',cl,'visa','4242',now());
END $$;

-- INV-11: a lot of prescription diet on the Raleigh office car shelf, so a bag can go on a bill and come back.
INSERT INTO inventory_lot_balances ("practiceId","inventoryItemId","branchId","branchLocationId","lotNumber","expirationDate","quantityOnHand")
SELECT 1, i.id, b.id, l.id, 'DIET-2611', DATE '2028-01-31', 40
  FROM inventory_items i, practice_branch b, inventory_branch_location l
 WHERE i."pimsId"='inv-train-diet' AND b.name='Raleigh office' AND l."branchId"=b.id AND l.code='CAR'
   AND NOT EXISTS (SELECT 1 FROM inventory_lot_balances x WHERE x."inventoryItemId"=i.id AND x."lotNumber"='DIET-2611');

-- INV-15: an employer promotion waiting for Tom Chen's first visit ($20 off, confirmed at checkout).
INSERT INTO appointment_request_promotion ("companyName", name, token, "discountType", "amountOffCents", "practiceId", "pimsType")
SELECT 'Northside Hospital', 'Employee welcome offer', 'inv-train-promo-token', 'fixed_amount', 2000, 1, 'scout'
 WHERE NOT EXISTS (SELECT 1 FROM appointment_request_promotion WHERE token='inv-train-promo-token');
INSERT INTO appointment_request_promotion_usage ("promotionId", token, "eventType", email, "clientId", "pimsType")
SELECT p.id, 'inv-train-promo-use', 'redemption', 'tom.chen@example.com', c.id, 'scout'
  FROM appointment_request_promotion p, clients c
 WHERE p.token='inv-train-promo-token' AND c."lastName"='Chen'
   AND NOT EXISTS (SELECT 1 FROM appointment_request_promotion_usage WHERE token='inv-train-promo-use');

-- INV-10: Tom Chen's old eVet invoice #48213 (Jun 10, 2025, $80, unpaid), with its line, so it shows what it was for.
INSERT INTO invoices ("pimsType", "pimsId", "invoiceNumber", "invoicedDate", "amountPaid", total, discount, "discountTypeValue", "invoiceStatusValue", "postCloseProcessComplete", "isTransferred", "practiceId", "clientId")
SELECT 'EVET', 'inv-train-evet-48213', 48213, TIMESTAMPTZ '2025-06-10 10:00:00-04', 0, 80, 0, 0, 1, false, false, 1, c.id
  FROM clients c WHERE c."lastName"='Chen'
   AND NOT EXISTS (SELECT 1 FROM invoices WHERE "pimsId"='inv-train-evet-48213');
INSERT INTO invoice_items ("pimsType", "pimsId", "invoiceId", "practiceId", sequence, percentage, quantity, price, "totalPrice", "procedureName", "serviceDate")
SELECT 'EVET', 'inv-train-evet-48213-1', i.id, 1, 1, 0, 1, 80, 80, 'Annual wellness exam', TIMESTAMPTZ '2025-06-10 10:00:00-04'
  FROM invoices i WHERE i."pimsId"='inv-train-evet-48213'
   AND NOT EXISTS (SELECT 1 FROM invoice_items WHERE "pimsId"='inv-train-evet-48213-1');
