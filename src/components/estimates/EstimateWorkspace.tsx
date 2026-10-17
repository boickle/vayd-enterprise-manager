import { useCallback, useEffect, useRef, useState } from 'react';
import { Mail, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { apiErrorMessage } from '../../api/http';
import { searchItems, type SearchableItem } from '../../api/roomLoader';
import { VISIT_WORKFLOW_PRACTICE_ID } from '../../api/visitWorkflow';
import {
  addEstimateLine,
  removeEstimateLine,
  updateEstimateLine,
  type VisitEstimate,
  type VisitEstimateLine,
} from '../../api/visitEstimates';
import {
  getBundle,
  listBundles,
  type Bundle,
  type BundleSaleLine,
  type BundleSaleResolution,
} from '../../api/memberships';
import BundleSalePickerModal from '../catalog/BundleSalePickerModal';
import { getCatalogLinePrice } from '../../utils/catalogItemPricing';
import {
  estimateEmailModel,
  invoicePdfAttachment,
  invoiceTableHtml,
} from '../../utils/invoiceEmail';
import {
  applySystemSubject,
  applySystemTemplate,
} from '../../utils/messageTemplateCache';
import { firstNameFromDisplayName } from '../../utils/clientNamePrefix';
import {
  mergeValuesFromNames,
  withClinicDefaults,
  type MergeValues,
} from '../../utils/messageTemplateFields';
import { recordScoutChartCommunication } from '../../api/scoutChart';
import type { GmailComposeAttachment } from '../../api/gmail';
import { ClientEmailComposeModal } from '../ClientEmailComposeModal';
import './EstimateWorkspace.css';

export type EstimatePet = {
  id: number;
  name: string;
  isActive?: boolean;
};

type Props = {
  estimate: VisitEstimate;
  onChange: (next: VisitEstimate) => void;
  patientId?: number | null;
  clientId?: number | null;
  disabled?: boolean;
  clientName?: string | null;
  allowEmail?: boolean;
  /** Household pets. Shown as a charge-to picker unless {@link lockPatient}. */
  pets?: EstimatePet[];
  /** Euthanasia quotes stay on one pet — no household picker. */
  lockPatient?: boolean;
};

type LineBlock =
  | { kind: 'solo'; line: VisitEstimateLine }
  | { kind: 'bundle'; saleId: string; name: string; lines: VisitEstimateLine[] };

const money = (n: number) =>
  Number(n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

function catalogIdOf(item: SearchableItem): number | null {
  const catalog =
    item.itemType === 'inventory'
      ? item.inventoryItem
      : item.itemType === 'lab'
        ? item.lab
        : item.procedure;
  const id = catalog && typeof catalog === 'object' ? Number(catalog.id) : NaN;
  return Number.isFinite(id) ? id : null;
}

function newBundleSaleId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function groupLinesByBundle(lines: VisitEstimateLine[]): LineBlock[] {
  const blocks: LineBlock[] = [];
  const saleIndex = new Map<string, number>();
  for (const line of lines) {
    const saleId = (line.bundleSaleId ?? '').trim();
    if (!saleId) {
      blocks.push({ kind: 'solo', line });
      continue;
    }
    const existing = saleIndex.get(saleId);
    if (existing != null) {
      const block = blocks[existing];
      if (block?.kind === 'bundle') {
        block.lines.push(line);
        if (!block.name && line.sourceBundleName) {
          block.name = line.sourceBundleName;
        }
      }
      continue;
    }
    saleIndex.set(saleId, blocks.length);
    blocks.push({
      kind: 'bundle',
      saleId,
      name: (line.sourceBundleName ?? '').trim() || 'Package',
      lines: [line],
    });
  }
  return blocks;
}

function lineAllowsPriceEdit(
  line: Pick<VisitEstimateLine, 'catalogItemId' | 'catalogItemType' | 'catalogAllowPriceChange'>
): boolean {
  if (line.catalogItemId == null) return true;
  if (line.catalogItemType !== 'inventory' && line.catalogItemType !== 'procedure') {
    return true;
  }
  return line.catalogAllowPriceChange === true;
}

function petLabel(pets: EstimatePet[], id: number | null | undefined, fallback?: string | null) {
  if (id != null) {
    const known = pets.find((p) => p.id === id);
    if (known?.name?.trim()) return known.name.trim();
  }
  return fallback?.trim() || (id != null ? `Pet #${id}` : '—');
}

export default function EstimateWorkspace({
  estimate,
  onChange,
  patientId,
  clientId,
  disabled,
  clientName,
  allowEmail,
  pets = [],
  lockPatient,
}: Props) {
  const [query, setQuery] = useState('');
  const [emailDraft, setEmailDraft] = useState<{
    subject: string;
    body: string;
    merge: MergeValues;
    attachments: GmailComposeAttachment[];
  } | null>(null);
  const [hits, setHits] = useState<SearchableItem[]>([]);
  const [bundleHits, setBundleHits] = useState<Bundle[]>([]);
  const [bundlePicker, setBundlePicker] = useState<Bundle | null>(null);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [priceEditId, setPriceEditId] = useState<string | null>(null);
  const [linePatientId, setLinePatientId] = useState<number | null>(
    patientId ?? estimate.patientId ?? pets[0]?.id ?? null
  );
  const searchRef = useRef<HTMLInputElement | null>(null);

  const locked = disabled || estimate.status === 'converted';
  const showPetPicker = !lockPatient && pets.length > 0;
  const lines = estimate.lines ?? [];
  const blocks = groupLinesByBundle(lines);

  useEffect(() => {
    if (lockPatient) {
      setLinePatientId(patientId ?? estimate.patientId ?? null);
      return;
    }
    if (linePatientId != null && pets.some((p) => p.id === linePatientId)) return;
    setLinePatientId(patientId ?? estimate.patientId ?? pets[0]?.id ?? null);
  }, [lockPatient, patientId, estimate.patientId, pets, linePatientId]);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setHits([]);
      setBundleHits([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(() => {
      void Promise.all([
        searchItems({
          q: term,
          practiceId: VISIT_WORKFLOW_PRACTICE_ID,
          limit: 20,
          patientId: linePatientId ?? undefined,
          clientId: clientId ?? estimate.clientId ?? undefined,
        }),
        listBundles({ kind: 'bundle', q: term }).catch(() => [] as Bundle[]),
      ])
        .then(([results, bundles]) => {
          if (cancelled) return;
          setHits(results);
          const needle = term.toLowerCase();
          setBundleHits(
            bundles
              .filter(
                (b) =>
                  b.name.toLowerCase().includes(needle) ||
                  (b.code ?? '').toLowerCase().includes(needle)
              )
              .slice(0, 6)
          );
        })
        .catch(() => {
          if (!cancelled) {
            setHits([]);
            setBundleHits([]);
          }
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, linePatientId, clientId, estimate.clientId]);

  const addItem = useCallback(
    async (item: SearchableItem) => {
      if (showPetPicker && linePatientId == null) {
        setError('Pick a pet before adding a charge.');
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const priced = getCatalogLinePrice(item, 1);
        const listUnit = Number(
          item.originalPrice ?? item.wellnessPlanPricing?.originalPrice ?? priced.unitFinal
        );
        const next = await addEstimateLine(estimate.id, {
          description: item.name,
          qty: 1,
          unitPrice: priced.unitFinal,
          isCovered: priced.isCovered,
          catalogItemId: catalogIdOf(item),
          catalogItemType: item.itemType || null,
          listUnitPrice: listUnit > priced.unitFinal + 0.009 ? listUnit : null,
          patientId: linePatientId,
        });
        onChange(next);
        setQuery('');
        setHits([]);
        setBundleHits([]);
        searchRef.current?.focus();
      } catch (e) {
        setError(apiErrorMessage(e));
      } finally {
        setBusy(false);
      }
    },
    [estimate.id, linePatientId, onChange, showPetPicker]
  );

  const addBundleLines = useCallback(
    async (resolution: BundleSaleResolution) => {
      if (showPetPicker && linePatientId == null) {
        setError('Pick a pet before adding a charge.');
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const bundleSaleId = newBundleSaleId();
        let next = estimate;
        for (const line of resolution.lines as BundleSaleLine[]) {
          next = await addEstimateLine(estimate.id, {
            description: line.name,
            qty: line.quantity,
            unitPrice: line.unitPrice,
            catalogItemId: line.catalogItemId,
            catalogItemType: line.itemType,
            listUnitPrice:
              line.listUnitPrice > line.unitPrice + 0.009 ? line.listUnitPrice : null,
            patientId: linePatientId,
            bundleSaleId,
            sourceBundleId: resolution.bundleId,
            sourceBundleName: resolution.bundleName,
          });
        }
        onChange(next);
        setQuery('');
        setHits([]);
        setBundleHits([]);
        setBundlePicker(null);
        searchRef.current?.focus();
      } catch (e) {
        setError(apiErrorMessage(e));
      } finally {
        setBusy(false);
      }
    },
    [estimate, linePatientId, onChange, showPetPicker]
  );

  const pickBundle = useCallback(
    async (bundleHit: Bundle) => {
      if (busy) return;
      setError(null);
      try {
        // Always open the picker so optional add-ons (urgent / same-day) can be
        // chosen instead of landing on the quote automatically.
        setBundlePicker(await getBundle(bundleHit.id));
      } catch (e) {
        setError(apiErrorMessage(e));
      }
    },
    [busy]
  );

  const changePrice = async (lineId: string, unitPrice: number) => {
    if (!Number.isFinite(unitPrice) || unitPrice < 0) return;
    setBusy(true);
    setError(null);
    try {
      onChange(await updateEstimateLine(estimate.id, lineId, { unitPrice }));
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
      setPriceEditId(null);
    }
  };

  const changeLinePet = async (lineId: string, nextPatientId: number) => {
    setBusy(true);
    setError(null);
    try {
      onChange(await updateEstimateLine(estimate.id, lineId, { patientId: nextPatientId }));
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (lineId: string) => {
    setBusy(true);
    setError(null);
    try {
      onChange(await removeEstimateLine(estimate.id, lineId));
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const removeBundle = async (members: VisitEstimateLine[]) => {
    setBusy(true);
    setError(null);
    try {
      let next = estimate;
      for (const line of members) {
        next = await removeEstimateLine(estimate.id, line.id);
      }
      onChange(next);
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const emailClientId = clientId ?? estimate.clientId;

  const startEmail = async () => {
    setBusy(true);
    setError(null);
    try {
      const displayName = clientName?.trim() || 'there';
      const model = estimateEmailModel(estimate, displayName);
      const pdf = await invoicePdfAttachment(model);
      const merge = withClinicDefaults({
        ...mergeValuesFromNames({
          clientFullName: displayName,
          clientFirstName: firstNameFromDisplayName(displayName),
          patientName: estimate.lines.find((l) => l.patientName)?.patientName ?? null,
        }),
        invoice_total: money(Number(estimate.total)),
        invoice_labels: model.label,
        invoice_html: invoiceTableHtml(model),
      });
      setEmailDraft({
        subject: applySystemSubject(
          'estimate_email',
          merge,
          'Your estimate from Vet At Your Door'
        ),
        body: applySystemTemplate('estimate_email', merge),
        merge,
        attachments: [pdf],
      });
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const renderPrice = (line: VisitEstimateLine) => {
    const charged = Number(line.unitPrice) || 0;
    if (line.isCovered) return <span>Covered</span>;
    if (locked || !lineAllowsPriceEdit(line)) return <span>{money(charged)}</span>;
    if (priceEditId === line.id) {
      return (
        <input
          type="number"
          min={0}
          step="0.01"
          autoFocus
          defaultValue={charged}
          disabled={busy}
          onBlur={(e) => {
            const next = Number(e.target.value);
            if (Number.isFinite(next) && next !== charged) void changePrice(line.id, next);
            else setPriceEditId(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setPriceEditId(null);
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
      );
    }
    return (
      <span className="estimate-price-shown">
        {money(charged)}
        <button
          type="button"
          className="estimate-price-pencil"
          title="Edit unit price"
          disabled={busy}
          onClick={() => setPriceEditId(line.id)}
        >
          <Pencil size={12} />
        </button>
      </span>
    );
  };

  const renderPet = (line: VisitEstimateLine) => {
    const label = petLabel(pets, line.patientId, line.patientName);
    if (lockPatient || locked || pets.length < 2) {
      return label !== '—' ? <span className="estimate-line-pet">{label}</span> : null;
    }
    return (
      <select
        className="estimate-line-pet-select"
        value={line.patientId ?? ''}
        disabled={busy}
        onChange={(e) => {
          const next = Number(e.target.value);
          if (Number.isFinite(next) && next !== line.patientId) {
            void changeLinePet(line.id, next);
          }
        }}
      >
        {pets.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
            {p.isActive === false ? ' (inactive)' : ''}
          </option>
        ))}
      </select>
    );
  };

  const renderLineRow = (line: VisitEstimateLine, opts?: { nested?: boolean }) => (
    <tr key={line.id} className={opts?.nested ? 'estimate-line-nested' : undefined}>
      <td className="estimate-line-desc">
        <span>{line.description}</span>
        {renderPet(line)}
      </td>
      <td className="estimate-line-qty">{Number(line.qty) || 1}</td>
      <td className="estimate-line-price">{renderPrice(line)}</td>
      <td className="estimate-line-amount">
        {line.isCovered ? 'Covered' : money(Number(line.amount))}
      </td>
      <td className="estimate-line-remove">
        {!locked && (
          <button
            type="button"
            aria-label={`Remove ${line.description}`}
            onClick={() => void remove(line.id)}
            disabled={busy}
          >
            <Trash2 size={14} />
          </button>
        )}
      </td>
    </tr>
  );

  return (
    <div className="estimate-workspace">
      {!locked && showPetPicker && (
        <label className="estimate-charge-to">
          Charge to
          <select
            value={linePatientId ?? ''}
            disabled={busy}
            onChange={(e) => setLinePatientId(e.target.value ? Number(e.target.value) : null)}
          >
            {pets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.isActive === false ? ' (inactive)' : ''}
              </option>
            ))}
          </select>
        </label>
      )}

      {!locked && (
        <div className="estimate-search">
          <Search size={15} className="estimate-search-icon" />
          <input
            ref={searchRef}
            type="text"
            value={query}
            placeholder="Search services, packages, or products…"
            onChange={(e) => setQuery(e.target.value)}
            disabled={busy}
          />
          {searching && <span className="estimate-search-note">Searching…</span>}
          {bundleHits.length + hits.length > 0 && (
            <ul className="estimate-hits">
              {bundleHits.map((bundle) => {
                const choiceCount = bundle.groups.filter(
                  (g) => g.selectionMode === 'choice' || g.selectionMode === 'any'
                ).length;
                return (
                  <li key={`bundle-${bundle.id}`}>
                    <button type="button" onClick={() => void pickBundle(bundle)} disabled={busy}>
                      <span className="estimate-hit-name">
                        <Plus size={13} aria-hidden /> {bundle.name}
                        <span className="estimate-hit-meta">
                          {' '}
                          · Package
                          {choiceCount
                            ? ` · choose ${choiceCount} option group${choiceCount === 1 ? '' : 's'}`
                            : ''}
                        </span>
                      </span>
                      <span className="estimate-hit-price">
                        {bundle.price != null && bundle.price > 0
                          ? money(bundle.price)
                          : 'expand'}
                      </span>
                    </button>
                  </li>
                );
              })}
              {hits.map((item) => {
                const priced = getCatalogLinePrice(item, 1);
                return (
                  <li key={`${item.itemType}-${catalogIdOf(item)}-${item.name}`}>
                    <button type="button" onClick={() => void addItem(item)} disabled={busy}>
                      <span className="estimate-hit-name">{item.name}</span>
                      <span className="estimate-hit-price">
                        {priced.isCovered ? 'Covered' : money(priced.unitFinal)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {error && <div className="estimate-error">{error}</div>}

      {lines.length === 0 ? (
        <p className="estimate-empty">Nothing quoted yet.</p>
      ) : (
        <table className="estimate-lines">
          <tbody>
            {blocks.flatMap((block) => {
              if (block.kind === 'solo') return [renderLineRow(block.line)];
              const bundleAmount = block.lines.reduce(
                (sum, line) => sum + (line.isCovered ? 0 : Number(line.amount) || 0),
                0
              );
              return [
                <tr key={`bundle-${block.saleId}`} className="estimate-bundle-head">
                  <td className="estimate-line-desc" colSpan={3}>
                    <span className="estimate-bundle-name">{block.name}</span>
                    <span className="estimate-line-pet">
                      {block.lines.length} item{block.lines.length === 1 ? '' : 's'}
                    </span>
                  </td>
                  <td className="estimate-line-amount">{money(bundleAmount)}</td>
                  <td className="estimate-line-remove">
                    {!locked && (
                      <button
                        type="button"
                        aria-label={`Remove ${block.name}`}
                        onClick={() => void removeBundle(block.lines)}
                        disabled={busy}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                </tr>,
                ...block.lines.map((line) => renderLineRow(line, { nested: true })),
              ];
            })}
          </tbody>
        </table>
      )}

      <div className="estimate-totals">
        {Number(estimate.membershipAdjustments) < 0 && (
          <div className="estimate-total-row">
            <span>Membership savings</span>
            <span>{money(Number(estimate.membershipAdjustments))}</span>
          </div>
        )}
        {Number(estimate.taxTotal) > 0 && (
          <div className="estimate-total-row">
            <span>Tax</span>
            <span>{money(Number(estimate.taxTotal))}</span>
          </div>
        )}
        <div className="estimate-total-row is-grand">
          <span>Total</span>
          <span>{money(Number(estimate.total))}</span>
        </div>
      </div>

      {allowEmail && emailClientId != null && (
        <div className="estimate-email-row">
          <button
            type="button"
            className="estimate-quick-add"
            onClick={() => void startEmail()}
            disabled={busy || Number(estimate.total) <= 0}
          >
            <Mail size={13} /> Email estimate
          </button>
        </div>
      )}

      {emailClientId != null && (
        <ClientEmailComposeModal
          open={emailDraft != null}
          clientId={emailClientId}
          clientLabel={clientName ?? ''}
          title="Email estimate"
          initialSubject={emailDraft?.subject ?? ''}
          initialBodyText={emailDraft?.body ?? ''}
          mergeValues={emailDraft?.merge}
          initialAttachments={emailDraft?.attachments}
          onAfterSend={async ({ subject, bodyText, bodyHtml, to, from }) => {
            await recordScoutChartCommunication({
              clientId: emailClientId,
              patientIds: [],
              channel: 'email',
              body: bodyHtml || bodyText,
              subject,
              destination: to,
              sentFrom: from,
              typeLabel: 'Estimate email',
              includeOnMedicalRecord: false,
            });
          }}
          onClose={() => setEmailDraft(null)}
        />
      )}

      {bundlePicker && (
        <BundleSalePickerModal
          bundle={bundlePicker}
          allowOmitIncluded
          confirmLabel="Add to estimate"
          onCancel={() => setBundlePicker(null)}
          onResolved={(resolution) => void addBundleLines(resolution)}
        />
      )}
    </div>
  );
}
