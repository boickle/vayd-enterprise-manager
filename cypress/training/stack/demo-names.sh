#!/bin/bash
# Give the seeded scheduling world the made-up names from the training video script.
# Usage: demo-names.sh <test db> <world.json>. Refuses any database without "test" in its name.
set -euo pipefail
DB="$1"; W="$2"
case "$DB" in *test*) ;; *) echo "Refusing: $DB is not a test database"; exit 2;; esac
export PGPASSWORD=vayd
j() { python3 -I -c "import json,sys; d=json.load(open(sys.argv[1])); print(eval(sys.argv[2], {}, {'w': d}))" "$W" "$1"; }
q() { psql -h localhost -U vayd -d "$DB" -v ON_ERROR_STOP=1 -q -c "$1"; }
[ "$(psql -h localhost -U vayd -d "$DB" -Atc 'select current_database()')" = "$DB" ]

emp() { q "UPDATE employees SET \"firstName\"='$2', \"lastName\"='$3' WHERE id=$1"; }
emp "$(j "w['employees']['doctorA']")"   Avery  Lane
q "UPDATE employees SET \"licenseNumber\"='NC-VET-00417', \"isLicensed\"=true, \"licenseType\"='veterinarian' WHERE id=$(j "w['employees']['doctorA']")"
emp "$(j "w['employees']['doctorB']")"   Priya  Shah
emp "$(j "w['employees']['technician']")" Jordan Pike
emp "$(j "w['employees']['cl']")"        Casey  Morgan
emp "$(j "w['employees']['manager']")"   Robin  Hale

q "UPDATE clients SET \"firstName\"='Maria', \"lastName\"='Rivera', email='maria.rivera@example.com' WHERE id=$(j "w['households']['A']['clientId']")"
q "UPDATE clients SET \"firstName\"='Tom', \"lastName\"='Chen', email='tom.chen@example.com' WHERE id=$(j "w['households']['B']['clientId']")"

q "UPDATE patients SET name='Maple', species='Canine' WHERE id=$(j "w['households']['A']['activePetIds'][0]")"
q "UPDATE patients SET name='Juniper', species='Feline' WHERE id=$(j "w['households']['A']['activePetIds'][1]")"
q "UPDATE patients SET name='Pepper', species='Canine', \"isActive\"=true WHERE id=$(j "w['households']['A']['inactivePetId']")"
q "UPDATE patients SET name='Biscuit', species='Canine' WHERE id=$(j "w['households']['B']['petId']")"

q "UPDATE practices SET name='Vet At Your Door', address1='4500 Demo Park Drive', city='Raleigh', state='NC', zipcode='27606', phone1='9195550100' WHERE id=1"
q "UPDATE practice_branch SET name='Raleigh office' WHERE name LIKE 'hsch-%'"
q "UPDATE zones SET name='North' WHERE id=$(j "w['zoneId']")"

# A catalog exam to charge at checkout (the test catalog has none).
q "INSERT INTO procedures (name, price, cost, \"practiceId\", \"isActive\", \"isDeleted\", \"pimsType\") SELECT 'Office exam', 75, 0, 1, true, false, 'scout' WHERE NOT EXISTS (SELECT 1 FROM procedures WHERE name='Office exam' AND \"isDeleted\"=false)"

# In-house cytologies (V7): the specs attach a "Describe what you saw" lab form to them.
for n in 'Ear cytology' 'Skin cytology'; do
  q "INSERT INTO procedures (name, price, cost, \"practiceId\", \"isActive\", \"isDeleted\", \"pimsType\") SELECT '$n', 45, 0, 1, true, false, 'scout' WHERE NOT EXISTS (SELECT 1 FROM procedures WHERE name='$n' AND \"isDeleted\"=false)"
  q "INSERT INTO lab_form_templates (\"practiceId\", name, category, mode, \"seedKey\") SELECT 1, '$n', 'Cytology', 'summary', 'training-$n' WHERE NOT EXISTS (SELECT 1 FROM lab_form_templates WHERE \"seedKey\"='training-$n')"
  q "INSERT INTO lab_form_template_procedures (\"labFormTemplateId\", \"procedureId\") SELECT t.id, p.id FROM lab_form_templates t, procedures p WHERE t.\"seedKey\"='training-$n' AND p.name='$n' AND p.\"isDeleted\"=false ON CONFLICT DO NOTHING"
done

# Stock locations for the demo branch, so a medication has somewhere to be filled from (V8).
for loc in "CAR|Car|0|true" "MAIN|Office shelf|1|false"; do
  IFS='|' read -r code name sort def <<< "$loc"
  q "INSERT INTO inventory_branch_location (\"branchId\", code, name, \"sortOrder\", \"isDefault\") SELECT b.id, '$code', '$name', $sort, $def FROM practice_branch b WHERE b.name='Raleigh office' AND NOT EXISTS (SELECT 1 FROM inventory_branch_location l WHERE l.\"branchId\"=b.id AND l.code='$code')"
done

# Medications (V8): an ear medication with default directions, and the seed's Carprofen without its test tag.
q "UPDATE inventory_items SET name='Carprofen 75 mg caplet' WHERE name LIKE 'Carprofen 75mg caplet EMRTEST-%'"
q "INSERT INTO inventory_items (name, price, \"isMedication\", \"isActive\", \"practiceId\", \"pimsType\", \"dispenseNote\", \"staffDiscountMode\", \"storeAvailability\") SELECT 'Mometamax otic 15 g', 38, true, true, 1, 'scout', 'Clean the ear, then put 8 drops in the right ear once a day for 7 days.', 'charge', 'always' WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE name='Mometamax otic 15 g')"
# No stock is counted on the test stack, so the demo medication skips lot tracking (V4 covers lots).
q "UPDATE inventory_items SET \"trackLots\"=false WHERE name='Mometamax otic 15 g'"

# Visit types: drop the seed's tag prefix so the screens read "Recheck", "Medical Visit", ...
for k in $(j "' '.join(w['types'].keys())"); do
  id=$(j "w['types']['$k']")
  q "UPDATE appointment_types SET name=regexp_replace(name, '^hsch-[0-9-]+ ', ''), \"prettyName\"=regexp_replace(coalesce(\"prettyName\", name), '^hsch-[0-9-]+ ', '') WHERE id=$id"
done

# Scheduling and Routing videos (docs/training/scheduling-routing.md, section 4).
# Doctors need an eVet-style id, or Get Best Route shows "Doctor <number>" instead of the name.
q "UPDATE employees SET \"pimsId\"='90417' WHERE id=$(j "w['employees']['doctorA']") AND \"pimsId\" IS NULL"
q "UPDATE employees SET \"pimsId\"='90418' WHERE id=$(j "w['employees']['doctorB']") AND \"pimsId\" IS NULL"
# Clean record numbers on the demo pets (the seed's are long test tags).
q "UPDATE patients SET \"pimsId\"='10' || id WHERE id IN ($(j "','.join(str(x) for x in w['households']['A']['activePetIds'] + [w['households']['A']['inactivePetId'], w['households']['B']['petId']])")) AND \"pimsId\" LIKE 'hsch-%'"
# Only the demo staff show in doctor and staff pickers (the copied test database holds hundreds of test providers).
q "UPDATE employees SET \"isActive\"=false WHERE \"isProvider\"=true AND id NOT IN ($(j "','.join(str(v) for v in w['employees'].values())"))"
# Maria's portal login uses the same email as her client record, or a portal request makes a second household.
q "UPDATE users SET email='maria.rivera@example.com', \"allowText\"=true, \"allowEmail\"=true WHERE id=$(j "w['users']['client']")"
# Messages to the demo families are allowed (the stack captures email, and texts with TRAINING_SMS_CAPTURE=1).
q "UPDATE clients SET \"doNotEmail\"=false, \"doNotSms\"=false, \"doNotSendReminders\"=false, \"smsOptOut\"=false WHERE id IN ($(j "w['households']['A']['clientId']"),$(j "w['households']['B']['clientId']"))"
# The online request form offers these visit types.
q "UPDATE appointment_types SET \"showInApptRequestForm\"=true, \"newPatientAllowed\"=true WHERE id IN ($(j "w['types']['medical']"),$(j "w['types']['recheck']"),$(j "w['types']['wellness']"))"
# Client liaisons may book these types by hand on the calendar (Settings -> Roles).
q "INSERT INTO employee_role_appointment_types (\"roleId\", \"appointmentTypeId\") SELECT a.\"roleId\", t.id FROM employee_role_assignments a, appointment_types t WHERE a.\"employeeId\"=$(j "w['employees']['cl']") AND t.id IN ($(j "w['types']['medical']"),$(j "w['types']['recheck']"),$(j "w['types']['wellness']")) ON CONFLICT DO NOTHING"

psql -h localhost -U vayd -d "$DB" -Atc "select 'types: ' || string_agg(name, ', ') from appointment_types where id in ($(j "','.join(str(v) for v in w['types'].values())"))"
echo "demo names applied to $DB"
