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

q "UPDATE zones SET name='North' WHERE id=$(j "w['zoneId']")"

# A catalog exam to charge at checkout (the test catalog has none).
q "INSERT INTO procedures (name, price, cost, \"practiceId\", \"isActive\", \"isDeleted\", \"pimsType\") SELECT 'Office exam', 75, 0, 1, true, false, 'scout' WHERE NOT EXISTS (SELECT 1 FROM procedures WHERE name='Office exam' AND \"isDeleted\"=false)"

# Visit types: drop the seed's tag prefix so the screens read "Recheck", "Medical Visit", ...
for k in $(j "' '.join(w['types'].keys())"); do
  id=$(j "w['types']['$k']")
  q "UPDATE appointment_types SET name=regexp_replace(name, '^hsch-[0-9-]+ ', ''), \"prettyName\"=regexp_replace(coalesce(\"prettyName\", name), '^hsch-[0-9-]+ ', '') WHERE id=$id"
done
psql -h localhost -U vayd -d "$DB" -Atc "select 'types: ' || string_agg(name, ', ') from appointment_types where id in ($(j "','.join(str(v) for v in w['types'].values())"))"
echo "demo names applied to $DB"
