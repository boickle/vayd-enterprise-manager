#!/usr/bin/env python3
"""Room Loader video (rl-v1): give the TEST database the practice's real Foundations membership plans, so the
membership pitch on the client's summary shows real coverage.

  rl-v1-plans.py <test db>

Reads plan definitions only (packages, package_item_group, package_items) from vayd_api_local, read-only.
No client or patient data. Each plan item is matched to the test catalog by code; items the test catalog does
not have are skipped. The test database's other membership plans are archived and renamed, so only these are offered and priced.
"""
import json
import subprocess
import sys

DB = sys.argv[1]
if not DB.startswith('vayd_api_test'):
    sys.exit(f'Refusing: {DB} is not a vayd_api_test* database')
SOURCE = 'vayd_api_local'
PLANS = [
    'Membership - Canine Foundations - Annual',
    'Membership - Canine Foundations - Monthly',
    'Membership - Feline Foundations - Annual',
    'Membership - Feline Foundations - Monthly',
]
ENV = {'PGPASSWORD': 'vayd', 'PATH': '/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin'}


def q(db: str, sql: str):
    out = subprocess.run(
        ['psql', '-h', 'localhost', '-U', 'vayd', db, '-tA', '-v', 'ON_ERROR_STOP=1', '-c', sql],
        check=True, capture_output=True, text=True, env=ENV,
    ).stdout.strip()
    return json.loads(out) if out else None


def lit(v) -> str:
    return "'" + str(v).replace("'", "''") + "'"


names = ','.join(lit(n) for n in PLANS)
packages = q(SOURCE, f"""select json_agg(p) from (select distinct on (name) * from packages
  where name in ({names}) and kind='membership' and not coalesce("isDeleted",false) order by name, id desc) p""") or []
if len(packages) != len(PLANS):
    sys.exit(f'Expected {len(PLANS)} plans in {SOURCE}, found {len(packages)}')
ids = ','.join(str(p['id']) for p in packages)
groups = q(SOURCE, f"""select json_agg(g) from package_item_group g where "packageId" in ({ids}) and not coalesce("isDeleted",false)""") or []
items = q(SOURCE, f"""select json_agg(x) from (select pi.*, coalesce(pr.code, ii.code, l.code) as "itemCode"
  from package_items pi left join procedures pr on pr.id=pi."procedureId" left join inventory_items ii on ii.id=pi."inventoryItemId"
  left join labs l on l.id=pi."labId" where pi."packageId" in ({ids}) and not coalesce(pi."isDeleted",false)) x""") or []

# Test catalog ids by code (newest non-deleted row wins).
catalog = {}
for table, col in (('procedures', 'procedureId'), ('inventory_items', 'inventoryItemId'), ('labs', 'labId')):
    rows = q(DB, f"""select json_agg(r) from (select distinct on (code) code, id from {table}
      where code is not null and not coalesce("isDeleted",false) order by code, id desc) r""") or []
    catalog[col] = {r['code']: r['id'] for r in rows}

sql = [
    'begin;',
    # Re-runs replace the previous copy.
    "delete from package_items where \"packageId\" in (select id from packages where \"pimsType\"='RL_TRAINING');",
    "delete from package_item_group where \"packageId\" in (select id from packages where \"pimsType\"='RL_TRAINING');",
    "delete from packages where \"pimsType\"='RL_TRAINING';",
    # The API looks plans up by name and includes archived ones, so the old empty test plans must not match.
    "update packages set \"isArchived\"=true, \"isActive\"=false, name='Old test plan ' || id where kind='membership';",
]
SKIP_PKG = {'id', 'renewalSuccessorPackageId', 'ageLimitSuccessorPackageId', 'createdByEmployeeId', 'updatedByEmployeeId'}
for p in packages:
    cols = [k for k in p if k not in SKIP_PKG]
    rec = {k: p[k] for k in cols}
    rec['practiceId'] = 1
    rec['pimsType'] = 'RL_TRAINING'
    sql.append(
        f"insert into packages ({','.join(chr(34) + c + chr(34) for c in cols)}) "
        f"select {','.join(chr(34) + c + chr(34) for c in cols)} from json_populate_record(null::packages, {lit(json.dumps(rec))}::json) "
        f"returning id \\gset pkg{p['id']}_"
    )
kept = skipped = 0
for g in groups:
    cols = [k for k in g if k not in ('id', 'packageId')]
    rec = {k: g[k] for k in cols}
    rec['practiceId'] = 1
    sql.append(
        f"insert into package_item_group ({','.join(chr(34) + c + chr(34) for c in cols)}, \"packageId\") "
        f"select {','.join(chr(34) + c + chr(34) for c in cols)}, :pkg{g['packageId']}_id "
        f"from json_populate_record(null::package_item_group, {lit(json.dumps(rec))}::json) returning id \\gset grp{g['id']}_"
    )
for it in items:
    target = None
    for col in ('procedureId', 'inventoryItemId', 'labId'):
        if it.get(col) is not None:
            target = (col, catalog[col].get(it['itemCode']))
    if not target or target[1] is None:
        skipped += 1
        continue
    kept += 1
    cols = [k for k in it if k not in ('id', 'itemCode', 'createdByEmployeeId', 'packageId', 'groupId', 'procedureId', 'inventoryItemId', 'labId')]
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
print(f'rl-v1 plans: {len(packages)} plans, {len(groups)} groups, {kept} items ({skipped} not in the test catalog)')
