export type ClientReachPhone = { label: string; phone: string; sms: boolean };
export type ClientReachEmail = { label: string; email: string };
export type ClientReachPet = { id: number; name: string };

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function readList(v: unknown): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) {
    const out: string[] = [];
    for (const item of v) {
      if (typeof item === 'string' || typeof item === 'number') {
        const s = String(item).trim();
        if (s) out.push(s);
      } else if (item && typeof item === 'object') {
        const o = item as Record<string, unknown>;
        const line =
          pickStr(o.phone) ??
          pickStr(o.number) ??
          pickStr(o.email) ??
          pickStr(o.label) ??
          pickStr(o.name);
        if (line) out.push(line);
      }
    }
    return out;
  }
  if (typeof v === 'string') return v.trim() ? [v.trim()] : [];
  return [];
}

export function clientReachPhones(c: Record<string, unknown> | null | undefined): ClientReachPhone[] {
  if (!c) return [];
  const rows: ClientReachPhone[] = [];
  const phone1 = pickStr(c.phone1) ?? pickStr(c.phone) ?? pickStr(c.mobilePhone) ?? pickStr(c.homePhone);
  const phone2 = pickStr(c.phone2);
  if (phone1) rows.push({ label: 'Primary', phone: phone1, sms: c.phone1SmsEnabled !== false });
  if (phone2 && phone2 !== phone1) {
    rows.push({ label: 'Alternate', phone: phone2, sms: c.phone2SmsEnabled !== false });
  }
  return rows;
}

export function clientReachEmails(c: Record<string, unknown> | null | undefined): ClientReachEmail[] {
  if (!c) return [];
  const primary = pickStr(c.email);
  const second = pickStr(c.secondEmail);
  const secondName = [pickStr(c.secondFirstName), pickStr(c.secondLastName)].filter(Boolean).join(' ');
  const seen = new Set<string>();
  const rows: ClientReachEmail[] = [];
  if (primary) {
    seen.add(primary.toLowerCase());
    rows.push({ label: 'Primary', email: primary });
  }
  if (second && !seen.has(second.toLowerCase())) {
    seen.add(second.toLowerCase());
    rows.push({ label: secondName || 'Second contact', email: second });
  }
  for (const extra of readList(c.emails)) {
    if (seen.has(extra.toLowerCase())) continue;
    seen.add(extra.toLowerCase());
    rows.push({ label: 'Also on file', email: extra });
  }
  return rows;
}

export function clientReachPets(patients: unknown): ClientReachPet[] {
  if (!Array.isArray(patients)) return [];
  return patients
    .filter((p): p is Record<string, unknown> => p != null && typeof p === 'object' && p.id != null)
    .map((p) => {
      const id = Number(p.id);
      return { id, name: pickStr(p.name) ?? `Pet #${id}` };
    })
    .filter((p) => Number.isFinite(p.id) && p.id > 0);
}
