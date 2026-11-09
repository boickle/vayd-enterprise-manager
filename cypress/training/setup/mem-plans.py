#!/usr/bin/env python3
"""Membership videos (MEM-xx): give the TEST database the practice's real membership plans (Foundations, Golden,
Puppy/Kitten; dog and cat; monthly and annual), so enrolment, coverage, plan change and renewal show real plans.

  mem-plans.py <test db>

Reads plan definitions only (packages, package_item_group, package_items) and the catalog rows those plans
cover (procedures, inventory items, labs: name, code, price) from vayd_api_local, read-only. No client or patient
data. A covered item the test catalog lacks is added to it by code. Plan-to-plan links (renewal and age-out
successors) are remapped to the copies. Stripe ids are dropped: the stack's Stripe is a fake or test mode.
The test database's other membership plans are archived and renamed, so only these are offered and priced.
"""
import json
import subprocess
import sys

DB = sys.argv[1]
if not DB.startswith('vayd_api_test'):
    sys.exit(f'Refusing: {DB} is not a vayd_api_test* database')
SOURCE = 'vayd_api_local'
TAG = 'MEM_TRAINING'
ENV = {'PGPASSWORD': 'vayd', 'PATH': '/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin'}


def q(db: str, sql: str):
    out = subprocess.run(
        ['psql', '-h', 'localhost', '-U', 'vayd', db, '-tA', '-v', 'ON_ERROR_STOP=1', '-c', sql],
        check=True, capture_output=True, text=True, env=ENV,
    ).stdout.strip()
    return json.loads(out) if out else None


def lit(v) -> str:
    return "'" + str(v).replace("'", "''") + "'"


# Every live (not archived, not deleted) membership plan.
packages = q(SOURCE, """select json_agg(p order by p.name) from packages p where kind='membership'
  and not coalesce("isDeleted",false) and not coalesce("isArchived",false)""") or []
if not packages:
    sys.exit(f'No live membership plans in {SOURCE}')
ids = ','.join(str(p['id']) for p in packages)
groups = q(SOURCE, f"""select json_agg(g) from package_item_group g where "packageId" in ({ids}) and not coalesce("isDeleted",false)""") or []
items = q(SOURCE, f"""select json_agg(x) from (select pi.*, coalesce(pr.code, ii.code, l.code) as "itemCode",
  coalesce(pr.name, ii.name, l.name) as "itemName", coalesce(pr.price, ii.price, l.price) as "itemPrice"
  from package_items pi left join procedures pr on pr.id=pi."procedureId" left join inventory_items ii on ii.id=pi."inventoryItemId"
  left join labs l on l.id=pi."labId" where pi."packageId" in ({ids}) and not coalesce(pi."isDeleted",false)) x""") or []

TABLES = (('procedures', 'procedureId'), ('inventory_items', 'inventoryItemId'), ('labs', 'labId'))


def test_catalog():
    cat = {}
    for table, col in TABLES:
        rows = q(DB, f"""select json_agg(r) from (select distinct on (code) code, id from {table}
          where code is not null and not coalesce("isDeleted",false) order by code, id desc) r""") or []
        cat[col] = {r['code']: r['id'] for r in rows}
    return cat


# Add covered catalog items the test catalog lacks (catalog rows only: name, code, price).
catalog = test_catalog()
added = 0
for it in items:
    for table, col in TABLES:
        if it.get(col) is None or not it.get('itemCode') or it['itemCode'] in catalog[col]:
            continue
        extra = ', "isMedication"' if table == 'inventory_items' else ''
        extra_v = ', false' if table == 'inventory_items' else ''
        subprocess.run(
            ['psql', '-h', 'localhost', '-U', 'vayd', DB, '-q', '-v', 'ON_ERROR_STOP=1', '-c',
             f"""insert into {table} (name, code, price, "practiceId", "isActive", "isDeleted", "pimsType"{extra})
                 values ({lit(it['itemName'])}, {lit(it['itemCode'])}, {it['itemPrice'] or 0}, 1, true, false, {lit(TAG)}{extra_v})"""],
            check=True, capture_output=True, text=True, env=ENV,
        )
        catalog[col][it['itemCode']] = -1
        added += 1
catalog = test_catalog()

sql = [
    'begin;',
    # Re-runs replace the previous copy.
    f"delete from package_items where \"packageId\" in (select id from packages where \"pimsType\"='{TAG}');",
    f"delete from package_item_group where \"packageId\" in (select id from packages where \"pimsType\"='{TAG}');",
    f"update packages set \"renewalSuccessorPackageId\"=null, \"ageLimitSuccessorPackageId\"=null where \"pimsType\"='{TAG}';",
    f"delete from packages where \"pimsType\"='{TAG}' and id not in (select \"packageId\" from wellness_plans where \"packageId\" is not null);",
    f"update packages set \"pimsType\"='{TAG}_OLD', \"isArchived\"=true, \"isActive\"=false, name='Old test plan ' || id where \"pimsType\"='{TAG}';",
    # The API looks plans up by name and includes archived ones, so the old empty test plans must not match.
    f"update packages set \"isArchived\"=true, \"isActive\"=false, name='Old test plan ' || id where kind='membership' and \"pimsType\" is distinct from '{TAG}';",
]
SKIP_PKG = {'id', 'renewalSuccessorPackageId', 'ageLimitSuccessorPackageId', 'createdByEmployeeId', 'updatedByEmployeeId',
            'stripeProductId', 'stripeMonthlyPriceId', 'stripeAnnualPriceId'}
for p in packages:
    cols = [k for k in p if k not in SKIP_PKG]
    rec = {k: p[k] for k in cols}
    rec['practiceId'] = 1
    rec['pimsType'] = TAG
    sql.append(
        f"insert into packages ({','.join(chr(34) + c + chr(34) for c in cols)}) "
        f"select {','.join(chr(34) + c + chr(34) for c in cols)} from json_populate_record(null::packages, {lit(json.dumps(rec))}::json) "
        f"returning id \\gset pkg{p['id']}_"
    )
for p in packages:
    for col in ('renewalSuccessorPackageId', 'ageLimitSuccessorPackageId'):
        if p.get(col) is not None and any(x['id'] == p[col] for x in packages):
            sql.append(f"update packages set \"{col}\"=:pkg{p[col]}_id where id=:pkg{p['id']}_id;")
for g in groups:
    cols = [k for k in g if k not in ('id', 'packageId')]
    rec = {k: g[k] for k in cols}
    rec['practiceId'] = 1
    sql.append(
        f"insert into package_item_group ({','.join(chr(34) + c + chr(34) for c in cols)}, \"packageId\") "
        f"select {','.join(chr(34) + c + chr(34) for c in cols)}, :pkg{g['packageId']}_id "
        f"from json_populate_record(null::package_item_group, {lit(json.dumps(rec))}::json) returning id \\gset grp{g['id']}_"
    )
kept = skipped = 0
for it in items:
    target = None
    for _table, col in TABLES:
        if it.get(col) is not None:
            target = (col, catalog[col].get(it['itemCode']))
    if not target or target[1] is None:
        skipped += 1
        continue
    kept += 1
    cols = [k for k in it if k not in ('id', 'itemCode', 'itemName', 'itemPrice', 'createdByEmployeeId', 'packageId', 'groupId',
                                       'procedureId', 'inventoryItemId', 'labId')]
    rec = {k: it[k] for k in cols}
    rec['practiceId'] = 1
    grp = f":grp{it['groupId']}_id" if it.get('groupId') is not None else 'null'
    sql.append(
        f"insert into package_items ({','.join(chr(34) + c + chr(34) for c in cols)}, \"packageId\", \"groupId\", \"{target[0]}\") "
        f"select {','.join(chr(34) + c + chr(34) for c in cols)}, :pkg{it['packageId']}_id, {grp}, {target[1]} "
        f"from json_populate_record(null::package_items, {lit(json.dumps(rec))}::json);"
    )
sql.append('commit;')
res = subprocess.run(
    ['psql', '-h', 'localhost', '-U', 'vayd', DB, '-q', '-v', 'ON_ERROR_STOP=1'],
    input="\n".join(sql), check=False, text=True, env=ENV, capture_output=True,
)
if res.returncode or 'ERROR' in res.stderr:
    sys.exit(res.stderr[-1500:])
print(f'mem plans: {len(packages)} plans, {len(groups)} groups, {kept} items ({skipped} skipped), {added} catalog items added')
