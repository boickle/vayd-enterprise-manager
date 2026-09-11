import { useEffect, useMemo, useState } from 'react';
import { fetchAllEmployees, type Employee } from '../../api/appointmentSettings';
import { getPracticeSettings, updatePracticeSettings } from '../../api/practiceSettings';
import { listOnlineStoreListings, type StoreAdminListing } from '../../api/onlineStore';
import { searchItems, type SearchableItem } from '../../api/roomLoader';
import {
  ASH_RETURN_LABEL_FIELDS,
  DEFAULT_ASH_RETURN_LABELS,
  DEFAULT_MEMORIAL_SUBCATEGORY,
  DEFAULT_PRIVATE_CREMATION_URNS,
  EUTHANASIA_ASH_RETURN_LABELS_KEY,
  EUTHANASIA_MEMORIAL_DEFAULT_SUBCATEGORY_KEY,
  EUTHANASIA_PAW_PRINT_ITEMS_KEY,
  EUTHANASIA_PRIVATE_CREMATION_URNS_KEY,
  EUTHANASIA_PROVIDER_PAW_PRINTS_KEY,
  blankPawPrintItems,
  defaultOfferingForProviderName,
  parseAshReturnLabels,
  parseMemorialDefaultSubcategory,
  parsePawPrintItems,
  parsePrivateCremationUrns,
  parseProviderPawPrintMap,
  serializeAshReturnLabels,
  serializePawPrintItems,
  serializePrivateCremationUrns,
  serializeProviderPawPrintMap,
  type AshReturnLabels,
  type CatalogItemRef,
  type EuthanasiaPawPrintItems,
  type PrivateCremationUrns,
  type ProviderPawPrintMap,
  type ProviderPawPrintOffering,
  type StoreListingRef,
} from '../../utils/euthanasiaConsentSettings';

const PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

function employeeName(emp: Employee): string {
  return [emp.firstName, emp.lastName].filter(Boolean).join(' ').trim() || `Employee #${emp.id}`;
}

function catalogRefFromSearch(row: SearchableItem): CatalogItemRef | null {
  const itemType =
    row.itemType === 'inventory' || row.itemType === 'lab' ? row.itemType : 'procedure';
  const itemId = Number(row.inventoryItem?.id ?? row.procedure?.id ?? row.lab?.id);
  if (!Number.isFinite(itemId) || itemId <= 0) return null;
  return { itemType, itemId, name: row.name || `#${itemId}` };
}

function CatalogItemPicker({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: CatalogItemRef | null;
  onChange: (next: CatalogItemRef | null) => void;
}) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchableItem[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const handle = window.setTimeout(() => {
      void searchItems({ q, practiceId: PRACTICE_ID, limit: 12 })
        .then((rows) => {
          if (!cancelled) setHits(rows);
        })
        .catch(() => {
          if (!cancelled) setHits([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [query]);

  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>{label}</label>
      <p className="settings-muted" style={{ margin: '0 0 8px', fontSize: 13 }}>
        {hint}
      </p>
      {value ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            border: '1px solid #e7e0d4',
            borderRadius: 8,
            padding: '8px 10px',
            marginBottom: 8,
          }}
        >
          <span>
            {value.name}{' '}
            <span className="settings-muted">
              ({value.itemType} #{value.itemId})
            </span>
          </span>
          <button type="button" className="btn secondary" onClick={() => onChange(null)}>
            Clear
          </button>
        </div>
      ) : null}
      <input
        className="input"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search catalog items…"
      />
      {searching ? <p className="settings-muted">Searching…</p> : null}
      {hits.length > 0 && (
        <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0 }}>
          {hits.map((row, i) => {
            const ref = catalogRefFromSearch(row);
            if (!ref) return null;
            return (
              <li key={`${ref.itemType}-${ref.itemId}-${i}`}>
                <button
                  type="button"
                  className="btn secondary"
                  style={{ width: '100%', textAlign: 'left', justifyContent: 'flex-start' }}
                  onClick={() => {
                    onChange(ref);
                    setQuery('');
                    setHits([]);
                  }}
                >
                  {ref.name}{' '}
                  <span className="settings-muted">
                    ({ref.itemType})
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function StoreListingPicker({
  label,
  hint,
  value,
  excludeIds,
  onChange,
}: {
  label: string;
  hint: string;
  value: StoreListingRef | null;
  excludeIds?: string[];
  onChange: (next: StoreListingRef | null) => void;
}) {
  const [query, setQuery] = useState('');
  const [listings, setListings] = useState<StoreAdminListing[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSearching(true);
    void listOnlineStoreListings(PRACTICE_ID)
      .then((rows) => {
        if (!cancelled) setListings(rows);
      })
      .catch(() => {
        if (!cancelled) setListings([]);
      })
      .finally(() => {
        if (!cancelled) setSearching(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const q = query.trim().toLowerCase();
  const blocked = new Set(excludeIds ?? []);
  const hits = listings
    .filter((row) => !blocked.has(row.listingId))
    .filter((row) => !q || row.name.toLowerCase().includes(q))
    .slice(0, 12);

  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>{label}</label>
      <p className="settings-muted" style={{ margin: '0 0 8px', fontSize: 13 }}>
        {hint}
      </p>
      {value ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            border: '1px solid #e7e0d4',
            borderRadius: 8,
            padding: '8px 10px',
            marginBottom: 8,
          }}
        >
          <span>
            {value.name} <span className="settings-muted">({value.listingId})</span>
          </span>
          <button type="button" className="btn secondary" onClick={() => onChange(null)}>
            Clear
          </button>
        </div>
      ) : null}
      <input
        className="input"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search store listings…"
      />
      {searching ? <p className="settings-muted">Loading store listings…</p> : null}
      {q.length >= 1 && hits.length > 0 ? (
        <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0 }}>
          {hits.map((row) => (
            <li key={row.listingId}>
              <button
                type="button"
                className="btn secondary"
                style={{ width: '100%', textAlign: 'left', justifyContent: 'flex-start' }}
                onClick={() => {
                  onChange({ listingId: row.listingId, name: row.name });
                  setQuery('');
                }}
              >
                {row.name} <span className="settings-muted">({row.listingId})</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export default function SettingsEuthanasiaConsent() {
  const [items, setItems] = useState<EuthanasiaPawPrintItems>(blankPawPrintItems());
  const [offerings, setOfferings] = useState<ProviderPawPrintMap>({});
  const [ashReturnLabels, setAshReturnLabels] =
    useState<AshReturnLabels>(DEFAULT_ASH_RETURN_LABELS);
  const [cremationUrns, setCremationUrns] = useState<PrivateCremationUrns>(
    DEFAULT_PRIVATE_CREMATION_URNS,
  );
  const [memorialDefaultSubcategory, setMemorialDefaultSubcategory] = useState(
    DEFAULT_MEMORIAL_SUBCATEGORY,
  );
  const [providers, setProviders] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void Promise.all([getPracticeSettings(PRACTICE_ID), fetchAllEmployees()])
      .then(([settings, employees]) => {
        if (cancelled) return;
        setItems(parsePawPrintItems(settings[EUTHANASIA_PAW_PRINT_ITEMS_KEY]));
        setOfferings(parseProviderPawPrintMap(settings[EUTHANASIA_PROVIDER_PAW_PRINTS_KEY]));
        setAshReturnLabels(parseAshReturnLabels(settings[EUTHANASIA_ASH_RETURN_LABELS_KEY]));
        setCremationUrns(parsePrivateCremationUrns(settings[EUTHANASIA_PRIVATE_CREMATION_URNS_KEY]));
        setMemorialDefaultSubcategory(
          parseMemorialDefaultSubcategory(settings[EUTHANASIA_MEMORIAL_DEFAULT_SUBCATEGORY_KEY]),
        );
        setProviders(
          employees
            .filter((e) => e.isProvider && e.isDeleted !== true)
            .sort((a, b) => employeeName(a).localeCompare(employeeName(b))),
        );
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load euthanasia settings.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = useMemo(
    () =>
      providers.map((emp) => {
        const saved = offerings[String(emp.id)];
        return {
          emp,
          offering: saved ?? defaultOfferingForProviderName(employeeName(emp)),
        };
      }),
    [providers, offerings],
  );

  const patchOffering = (employeeId: number, next: Partial<ProviderPawPrintOffering>) => {
    setOfferings((current) => {
      const provider = providers.find((p) => p.id === employeeId);
      const name = provider
        ? employeeName(provider)
        : `Provider #${employeeId}`;
      const prev = current[String(employeeId)] ?? defaultOfferingForProviderName(name);
      return { ...current, [String(employeeId)]: { ...prev, ...next } };
    });
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const nextMap: ProviderPawPrintMap = { ...offerings };
      for (const { emp, offering } of rows) {
        nextMap[String(emp.id)] = offering;
      }
      await updatePracticeSettings(PRACTICE_ID, {
        [EUTHANASIA_PAW_PRINT_ITEMS_KEY]: serializePawPrintItems(items),
        [EUTHANASIA_PROVIDER_PAW_PRINTS_KEY]: serializeProviderPawPrintMap(nextMap),
        [EUTHANASIA_ASH_RETURN_LABELS_KEY]: serializeAshReturnLabels(ashReturnLabels),
        [EUTHANASIA_PRIVATE_CREMATION_URNS_KEY]: serializePrivateCremationUrns(cremationUrns),
        [EUTHANASIA_MEMORIAL_DEFAULT_SUBCATEGORY_KEY]: parseMemorialDefaultSubcategory(
          memorialDefaultSubcategory,
        ),
      });
      setOfferings(nextMap);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="settings-card" style={{ marginBottom: 24 }}>
        <p className="settings-muted">Loading euthanasia consent settings…</p>
      </div>
    );
  }

  return (
    <div className="settings-card" style={{ marginBottom: 24 }}>
      <h3 className="settings-card-title">Euthanasia consent</h3>
      <p className="settings-muted" style={{ marginBottom: 16, fontSize: 13 }}>
        Clients complete this in Scout instead of Jotform. Link the catalog treatment items
        below, then choose which doctors offer ink (free), clay (charged), or clay (free). Julie
        Greenlaw defaults to free clay with no product photos; everyone else defaults to free ink
        plus charged clay (with photos).
      </p>
      {error ? <p className="settings-error-message">{error}</p> : null}
      {saved ? <p className="settings-success-message">Saved.</p> : null}

      <CatalogItemPicker
        label="Ink paw print (free)"
        hint="Search the catalog for the Ink Paw Print treatment item. Offered at no charge when a doctor’s ink option is on."
        value={items.ink}
        onChange={(ink) => {
          setItems((cur) => ({ ...cur, ink }));
          setSaved(false);
        }}
      />
      <CatalogItemPicker
        label="Clay paw print — charge"
        hint="Search for Final Gift Clay Paw Print. Stripe charges this amount when the client selects it and submits the consent form (Nina and most doctors)."
        value={items.clayCharge}
        onChange={(clayCharge) => {
          setItems((cur) => ({ ...cur, clayCharge }));
          setSaved(false);
        }}
      />
      <CatalogItemPicker
        label="Clay paw print — free"
        hint="Used when a doctor (for example Dr. Greenlaw) offers clay at no charge."
        value={items.clayFree}
        onChange={(clayFree) => {
          setItems((cur) => ({ ...cur, clayFree }));
          setSaved(false);
        }}
      />

      <h4 style={{ margin: '20px 0 8px' }}>Private cremation urns</h4>
      <p className="settings-muted" style={{ margin: '0 0 12px', fontSize: 13 }}>
        Shown with the memorial store on the consent form when the client chooses private
        cremation. The included urn is what they receive; substitute urns can replace it at no
        charge.
      </p>
      <StoreListingPicker
        label="Included urn"
        hint="Usually the Hand-crafted Rosewood Urn that comes with private cremation."
        value={cremationUrns.included}
        excludeIds={cremationUrns.substitutes.map((row) => row.listingId)}
        onChange={(included) => {
          setCremationUrns((cur) => ({ ...cur, included }));
          setSaved(false);
        }}
      />
      <p style={{ fontWeight: 600, margin: '8px 0 6px' }}>Substitute urns (no charge)</p>
      {cremationUrns.substitutes.map((urn, index) => (
        <div
          key={`${urn.listingId}-${index}`}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            border: '1px solid #e7e0d4',
            borderRadius: 8,
            padding: '8px 10px',
            marginBottom: 8,
          }}
        >
          <span>
            {urn.name} <span className="settings-muted">({urn.listingId})</span>
          </span>
          <button
            type="button"
            className="btn secondary"
            onClick={() => {
              setCremationUrns((cur) => ({
                ...cur,
                substitutes: cur.substitutes.filter((_, i) => i !== index),
              }));
              setSaved(false);
            }}
          >
            Remove
          </button>
        </div>
      ))}
      <StoreListingPicker
        label="Add a substitute urn"
        hint="Search the online store and add each no-charge substitute."
        value={null}
        excludeIds={[
          cremationUrns.included?.listingId,
          ...cremationUrns.substitutes.map((row) => row.listingId),
        ].filter((id): id is string => Boolean(id))}
        onChange={(next) => {
          if (!next) return;
          setCremationUrns((cur) => ({ ...cur, substitutes: [...cur.substitutes, next] }));
          setSaved(false);
        }}
      />

      <h4 style={{ margin: '20px 0 8px' }}>Memorial store default</h4>
      <p className="settings-muted" style={{ margin: '0 0 12px', fontSize: 13 }}>
        When a client opens memorial items on the consent form, this subcategory is selected
        first. Use the exact chip name from the store, for example Paw &amp; Nose Prints. Type
        All to start with every memorial item. Leave blank to keep the Paw &amp; Nose Prints
        default.
      </p>
      <label style={{ display: 'block', marginBottom: 16 }}>
        <span style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>
          Default subcategory
        </span>
        <input
          className="input"
          value={memorialDefaultSubcategory}
          onChange={(e) => {
            setMemorialDefaultSubcategory(e.target.value);
            setSaved(false);
          }}
          placeholder={DEFAULT_MEMORIAL_SUBCATEGORY}
        />
      </label>

      <h4 style={{ margin: '20px 0 8px' }}>Ash return wording</h4>
      <p className="settings-muted" style={{ margin: '0 0 12px', fontSize: 13 }}>
        Shown on the consent form when the client chooses private cremation. Mail and hand deliver
        are the two main choices. The follow-up question and its two answers appear only after they
        pick hand deliver.
      </p>
      {ASH_RETURN_LABEL_FIELDS.map((field) => (
        <label key={field.value} style={{ display: 'block', marginBottom: 12 }}>
          <span style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>{field.title}</span>
          <p className="settings-muted" style={{ margin: '0 0 6px', fontSize: 13 }}>
            {field.hint}
          </p>
          <textarea
            className="input"
            rows={3}
            value={ashReturnLabels[field.value]}
            onChange={(e) => {
              setAshReturnLabels((cur) => ({ ...cur, [field.value]: e.target.value }));
              setSaved(false);
            }}
          />
        </label>
      ))}

      <h4 style={{ margin: '20px 0 8px' }}>Offerings by doctor</h4>
      <div style={{ overflowX: 'auto' }}>
        <table className="settings-table" style={{ width: '100%', fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Doctor</th>
              <th>Ink (free)</th>
              <th>Clay (charge)</th>
              <th>Clay (free)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ emp, offering }) => (
              <tr key={emp.id}>
                <td>{employeeName(emp)}</td>
                <td style={{ textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={offering.ink}
                    onChange={(e) => patchOffering(emp.id, { ink: e.target.checked })}
                  />
                </td>
                <td style={{ textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={offering.clayCharge}
                    onChange={(e) => patchOffering(emp.id, { clayCharge: e.target.checked })}
                  />
                </td>
                <td style={{ textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={offering.clayFree}
                    onChange={(e) => patchOffering(emp.id, { clayFree: e.target.checked })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 16 }}>
        <button type="button" className="btn" disabled={saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save euthanasia settings'}
        </button>
      </div>
    </div>
  );
}
