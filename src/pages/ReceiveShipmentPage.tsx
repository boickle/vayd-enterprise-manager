import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import {
  addShipmentLine,
  createShipment,
  createSupplier,
  deleteReceivedShipment,
  finalizeShipment,
  getShipment,
  listShipments,
  listSuppliers,
  getShipmentInvoiceFile,
  parseInventoryInvoice,
  patchShipment,
  removeShipmentLine,
  uploadShipmentInvoice,
  upsertVendorItemMap,
  type InventoryShipment,
  type InventoryShipmentLine,
  type InventorySupplier,
  type ParsedInvoiceLine,
} from '../api/inventoryOps';
import {
  listInventoryBranchLocations,
  listPracticeBranches,
  type InventoryBranchLocation,
  type PracticeBranch,
} from '../api/branchInventory';
import { searchItems, type InventoryItem, type SearchResultItem } from '../api/quantityPriceBreaks';
import {
  loadInventoryItem,
  useStockItemGroups,
  type StockItemGroup,
} from '../hooks/useStockItemGroups';
import { appConfirm } from '../utils/appDialog';
import { resolvePracticeIdFromToken } from '../utils/practiceIdFromToken';
import { sellUnitLabel, suggestedReceiveQuantity } from '../utils/vendorPackSize';
import './Settings.css';

type DraftLine = InventoryShipmentLine;

function invoiceQtyOf(line: ParsedInvoiceLine): number {
  return line.quantity != null && Number(line.quantity) > 0 ? Number(line.quantity) : 1;
}

function applyItemToParsedLine(
  line: ParsedInvoiceLine,
  item: InventoryItem,
  rememberedPerVendorQty?: number | null
): ParsedInvoiceLine {
  const suggested = suggestedReceiveQuantity({
    invoiceQty: line.quantity,
    description: line.description,
    rememberedPerVendorQty: rememberedPerVendorQty ?? line.receiveUnitsPerVendorQty,
    unitsPerPackage:
      item.unitsPerPackage != null ? Number(item.unitsPerPackage) : line.unitsPerPackage,
  });
  return {
    ...line,
    status: 'matched',
    inventoryItemId: item.id,
    inventoryItemName: String(item.name),
    sellUnitType: item.sellUnitType ?? null,
    sellUnitTypeDetail: item.sellUnitTypeDetail ?? null,
    unitsPerPackage:
      item.unitsPerPackage != null ? Number(item.unitsPerPackage) : line.unitsPerPackage ?? null,
    trackLots: item.trackLots === true,
    requireExpirationOnLots: item.requireExpirationOnLots === true,
    receiveQuantity: line.receiveQuantity ?? suggested.receiveQuantity,
    receiveUnitsPerVendorQty: suggested.receiveUnitsPerVendorQty,
  };
}

type LineIssueField = 'qty' | 'lot' | 'exp';
type LineIssue = { field: LineIssueField; message: string };

function parsedLineIssue(line: ParsedInvoiceLine): LineIssue | null {
  if (line.status !== 'matched' || line.inventoryItemId == null) return null;
  const q = Number(line.receiveQuantity);
  if (!Number.isFinite(q) || q <= 0) {
    return {
      field: 'qty',
      message: `Enter how many ${sellUnitLabel(line.sellUnitType, line.sellUnitTypeDetail)} to receive`,
    };
  }
  if (line.trackLots && !line.lotNumber?.trim()) {
    return { field: 'lot', message: 'Enter a lot #' };
  }
  if (line.requireExpirationOnLots && !line.expirationDate?.trim()) {
    return { field: 'exp', message: 'Enter an expiration date' };
  }
  return null;
}

function parsedLineReady(line: ParsedInvoiceLine): boolean {
  return parsedLineIssue(line) == null && line.status === 'matched' && line.inventoryItemId != null;
}

function normalizeInvoiceNo(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

export default function ReceiveShipmentPage() {
  const { token } = useAuth() as { token: string | null };
  const practiceId = useMemo(() => resolvePracticeIdFromToken(token), [token]);

  const [branches, setBranches] = useState<PracticeBranch[]>([]);
  const [locations, setLocations] = useState<InventoryBranchLocation[]>([]);
  const [suppliers, setSuppliers] = useState<InventorySupplier[]>([]);
  const [branchId, setBranchId] = useState<number | ''>('');
  const [supplierId, setSupplierId] = useState<number | ''>('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [defaultLocId, setDefaultLocId] = useState<number | ''>('');
  const [shipment, setShipment] = useState<InventoryShipment | null>(null);
  const [lines, setLines] = useState<DraftLine[]>([]);

  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResultItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<{
    id: number;
    name: string;
    trackLots?: boolean;
    requireExpirationOnLots?: boolean;
    sellUnitType?: string | null;
    cost?: string | number | null;
    /** Set when the searched code draws stock from this item. */
    viaName?: string | null;
  } | null>(null);
  const [qty, setQty] = useState('1');
  const [lot, setLot] = useState('');
  const [exp, setExp] = useState('');
  /** Invoice-friendly entry: total line cost or cost per unit. Stored as costPerUnit. */
  const [costMode, setCostMode] = useState<'total' | 'perUnit'>('total');
  const [cost, setCost] = useState('');
  const [lineLocId, setLineLocId] = useState<number | ''>('');
  const [addingSupplier, setAddingSupplier] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [invoiceFileName, setInvoiceFileName] = useState<string | null>(null);
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const [invoiceStoredOnShipmentId, setInvoiceStoredOnShipmentId] = useState<number | null>(null);
  const [parsedLines, setParsedLines] = useState<ParsedInvoiceLine[]>([]);
  const [parseMeta, setParseMeta] = useState<{
    supplierName: string | null;
    shipToName: string | null;
    shipToAddress: string | null;
  } | null>(null);
  const shipmentSectionRef = useRef<HTMLDivElement>(null);
  const receivedSectionRef = useRef<HTMLDivElement>(null);
  const [received, setReceived] = useState<InventoryShipment[]>([]);
  const [receivedOpenId, setReceivedOpenId] = useState<number | null>(null);
  const [receivedLines, setReceivedLines] = useState<InventoryShipmentLine[]>([]);
  const [receivedBusy, setReceivedBusy] = useState(false);
  const [receivedPage, setReceivedPage] = useState(1);
  const RECEIVED_PAGE_SIZE = 20;
  const parsedLineRefs = useRef<Record<number, HTMLLIElement | null>>({});
  const [lineIssues, setLineIssues] = useState<Record<number, LineIssue>>({});
  const [approveError, setApproveError] = useState<string | null>(null);
  const [matchSearchKey, setMatchSearchKey] = useState<number | null>(null);
  const [matchSearchQ, setMatchSearchQ] = useState('');
  const [matchSearchResults, setMatchSearchResults] = useState<SearchResultItem[]>([]);

  const headerReady =
    branchId !== '' &&
    defaultLocId !== '' &&
    supplierId !== '' &&
    invoiceNumber.trim().length > 0;
  const canFinalize = headerReady && lines.length > 0;
  const duplicateInvoice = useMemo(() => {
    const key = normalizeInvoiceNo(invoiceNumber);
    if (!key) return null;
    return (
      received.find((row) => {
        if (row.status === 'deleted') return false;
        if (shipment && row.id === shipment.id) return false;
        return normalizeInvoiceNo(row.invoiceNumber) === key;
      }) ?? null
    );
  }, [invoiceNumber, received, shipment]);

  function requireHeader(): boolean {
    if (branchId === '') {
      setError('Choose destination office');
      return false;
    }
    if (defaultLocId === '') {
      setError('Choose default location');
      return false;
    }
    if (supplierId === '') {
      setError('Supplier is required');
      return false;
    }
    if (!invoiceNumber.trim()) {
      setError('Invoice / packing slip # is required');
      return false;
    }
    return true;
  }

  useEffect(() => {
    void (async () => {
      try {
        const [b, s] = await Promise.all([
          listPracticeBranches(practiceId),
          listSuppliers(practiceId),
        ]);
        setBranches(b.filter((x) => x.isActive !== false));
        setSuppliers(s.filter((x) => x.isActive !== false));
        const def = b.find((x) => x.isDefault) ?? b[0];
        if (def) setBranchId(def.id);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Failed to load');
      }
    })();
  }, [practiceId]);

  useEffect(() => {
    let cancelled = false;
    void listShipments(practiceId, 'finalized,deleted')
      .then((rows) => {
        if (!cancelled) setReceived(rows);
      })
      .catch(() => {
        if (!cancelled) setReceived([]);
      });
    return () => {
      cancelled = true;
    };
  }, [practiceId]);

  useEffect(() => {
    if (branchId === '') {
      setLocations([]);
      return;
    }
    void (async () => {
      const locs = await listInventoryBranchLocations(practiceId, Number(branchId));
      setLocations(locs);
      const def = locs.find((l) => l.isDefault) ?? locs[0];
      if (def) {
        setDefaultLocId(def.id);
        setLineLocId(def.id);
      }
    })();
  }, [practiceId, branchId]);

  useEffect(() => {
    if (!shipment?.id) return;
    let cancelled = false;
    void getShipment(practiceId, shipment.id)
      .then((bundle) => {
        if (cancelled) return;
        setShipment(bundle.shipment);
        setLines(bundle.lines);
      })
      .catch(() => {
        /* draft may not exist yet */
      });
    return () => {
      cancelled = true;
    };
  }, [practiceId, shipment?.id]);

  useEffect(() => {
    const q = matchSearchQ.trim();
    if (matchSearchKey == null || q.length < 2) {
      setMatchSearchResults([]);
      return;
    }
    const t = window.setTimeout(() => {
      void searchItems(q, practiceId, 40)
        .then((rows) => setMatchSearchResults(rows.filter((r) => r.itemType === 'inventory')))
        .catch(() => setMatchSearchResults([]));
    }, 250);
    return () => window.clearTimeout(t);
  }, [practiceId, matchSearchKey, matchSearchQ]);

  useEffect(() => {
    const q = searchQ.trim();
    if (q.length < 2) {
      setSearchResults([]);
      return;
    }
    const t = window.setTimeout(() => {
      void searchItems(q, practiceId, 40)
        .then((rows) => setSearchResults(rows.filter((r) => r.itemType === 'inventory')))
        .catch(() => setSearchResults([]));
    }, 250);
    return () => window.clearTimeout(t);
  }, [practiceId, searchQ]);

  const searchGroups = useStockItemGroups(searchResults, practiceId);
  const matchSearchGroups = useStockItemGroups(matchSearchResults, practiceId);

  async function chooseStockItem(group: StockItemGroup) {
    if (!requireHeader()) return;
    setError(null);
    try {
      const item = group.item ?? (await loadInventoryItem(practiceId, group.stockItemId));
      setSelectedItem({
        id: item.id,
        name: String(item.name),
        trackLots: item.trackLots,
        requireExpirationOnLots: item.requireExpirationOnLots,
        sellUnitType: item.sellUnitType,
        cost: item.cost,
        viaName: group.viaNames[0] ?? null,
      });
      // Don't pre-fill cost — staff enter it from the invoice (total or per unit).
      setCost('');
      setCostMode('total');
      setSearchResults([]);
      setSearchQ('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not load item');
    }
  }

  async function ensureDraft(): Promise<InventoryShipment> {
    if (shipment) return shipment;
    if (!requireHeader()) throw new Error('Supplier and invoice are required');
    const created = await createShipment(practiceId, {
      branchId: Number(branchId),
      supplierId: Number(supplierId),
      invoiceNumber: invoiceNumber.trim(),
      defaultToBranchLocationId: Number(defaultLocId),
    });
    setShipment(created);
    return persistInvoiceOnShipment(created);
  }

  async function persistInvoiceOnShipment(
    draft: InventoryShipment,
    file = invoiceFile
  ): Promise<InventoryShipment> {
    if (!file) return draft;
    if (invoiceStoredOnShipmentId === draft.id && draft.invoicePdfKey && file === invoiceFile) {
      return draft;
    }
    const updated = await uploadShipmentInvoice(practiceId, draft.id, file);
    setInvoiceStoredOnShipmentId(draft.id);
    setShipment(updated);
    return updated;
  }

  async function refreshLines(shipmentId: number) {
    const bundle = await getShipment(practiceId, shipmentId);
    setShipment(bundle.shipment);
    setLines(bundle.lines);
  }

  function clearLineIssue(index: number, field?: LineIssueField) {
    setLineIssues((prev) => {
      const cur = prev[index];
      if (!cur) return prev;
      if (field && cur.field !== field) return prev;
      const next = { ...prev };
      delete next[index];
      return next;
    });
    setApproveError(null);
  }

  function resetReceiveForm() {
    setShipment(null);
    setLines([]);
    setInvoiceNumber('');
    setInvoiceFileName(null);
    setInvoiceFile(null);
    setInvoiceStoredOnShipmentId(null);
    setParseMeta(null);
    setParsedLines([]);
    setLineIssues({});
    setApproveError(null);
    setSelectedItem(null);
    setSearchQ('');
    setSearchResults([]);
    setMatchSearchKey(null);
    setMatchSearchQ('');
    setMatchSearchResults([]);
    setQty('1');
    setLot('');
    setExp('');
    setCost('');
    setCostMode('total');
    setAddingSupplier(false);
    setNewSupplierName('');
  }

  async function clearInvoiceLines() {
    const ok = await appConfirm({
      title: 'Clear invoice lines?',
      message:
        'Remove these invoice lines from the screen? An already-received shipment is not changed.',
      confirmLabel: 'Clear invoice lines',
      cancelLabel: 'Keep lines',
    });
    if (!ok) return;
    setParsedLines([]);
    setInvoiceFileName(null);
    setInvoiceFile(null);
    setInvoiceStoredOnShipmentId(null);
    setParseMeta(null);
    setLineIssues({});
    setApproveError(null);
    setMatchSearchKey(null);
    setMatchSearchQ('');
    setMatchSearchResults([]);
    setToast('Invoice lines cleared');
    window.setTimeout(() => setToast(null), 2500);
  }

  async function reloadReceived() {
    const rows = await listShipments(practiceId, 'finalized,deleted');
    setReceived(rows);
    setReceivedPage(1);
    setReceivedOpenId(null);
    setReceivedLines([]);
  }

  async function onDeleteReceived(row: InventoryShipment) {
    const ok = await appConfirm({
      title: 'Delete this receive?',
      message:
        'This removes the received quantity from inventory and keeps the shipment here, marked deleted.',
      confirmLabel: 'Delete receive',
      cancelLabel: 'Keep',
      danger: true,
    });
    if (!ok) return;
    setReceivedBusy(true);
    setError(null);
    try {
      const bundle = await deleteReceivedShipment(practiceId, row.id);
      setReceived((prev) => prev.map((r) => (r.id === row.id ? bundle.shipment : r)));
      if (receivedOpenId === row.id) setReceivedLines(bundle.lines);
      setToast('Receive deleted. Stock reversed.');
      window.setTimeout(() => setToast(null), 3000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not delete shipment');
    } finally {
      setReceivedBusy(false);
    }
  }

  async function toggleReceived(id: number) {
    if (receivedOpenId === id) {
      setReceivedOpenId(null);
      setReceivedLines([]);
      return;
    }
    await openReceivedShipment(id);
  }

  async function openReceivedShipment(id: number) {
    const idx = received.findIndex((r) => r.id === id);
    if (idx >= 0) {
      setReceivedPage(Math.floor(idx / RECEIVED_PAGE_SIZE) + 1);
    }
    setReceivedBusy(true);
    try {
      const bundle = await getShipment(practiceId, id);
      setReceivedOpenId(id);
      setReceivedLines(bundle.lines);
      window.requestAnimationFrame(() => {
        receivedSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not load shipment');
    } finally {
      setReceivedBusy(false);
    }
  }

  function scrollToShipment() {
    window.requestAnimationFrame(() => {
      shipmentSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  async function addLine() {
    if (!requireHeader()) return;
    if (!selectedItem) {
      setError('Search and select an item first');
      return;
    }
    const quantity = Number(qty);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setError('Quantity received is required and must be positive');
      return;
    }
    if (selectedItem.trackLots && !lot.trim()) {
      setError('Lot # is required for this item');
      return;
    }
    if (selectedItem.requireExpirationOnLots && !exp.trim()) {
      setError('Expiration date is required for this item');
      return;
    }
    if (cost.trim() === '') {
      setError(costMode === 'total' ? 'Total cost is required' : 'Cost per unit is required');
      return;
    }
    const costEntered = Number(cost);
    if (!Number.isFinite(costEntered) || costEntered < 0) {
      setError('Cost must be a valid number (0 or greater)');
      return;
    }
    const costPerUnit =
      costMode === 'total' ? costEntered / quantity : costEntered;
    if (!Number.isFinite(costPerUnit)) {
      setError('Could not calculate cost per unit');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      let draft = await ensureDraft();
      draft = await patchShipment(practiceId, draft.id, {
        supplierId: Number(supplierId),
        invoiceNumber: invoiceNumber.trim(),
        defaultToBranchLocationId: Number(defaultLocId),
      });
      draft = await persistInvoiceOnShipment(draft);
      setShipment(draft);
      await addShipmentLine(practiceId, draft.id, {
        inventoryItemId: selectedItem.id,
        quantity,
        costPerUnit: Number(costPerUnit.toFixed(4)),
        lotNumber: lot.trim(),
        expirationDate: exp.trim(),
        toBranchLocationId:
          lineLocId === '' ? Number(defaultLocId) : Number(lineLocId),
        barcodeScanned: null,
      });
      await refreshLines(draft.id);
      scrollToShipment();
      setSelectedItem(null);
      setQty('1');
      setLot('');
      setExp('');
      setCost('');
      setCostMode('total');
      setToast('Added to shipment');
      window.setTimeout(() => setToast(null), 2000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not add line');
    } finally {
      setBusy(false);
    }
  }

  async function onInvoiceFile(file: File | undefined) {
    if (!file) return;
    setParsing(true);
    setError(null);
    try {
      const parsed = await parseInventoryInvoice(
        practiceId,
        file,
        supplierId === '' ? null : Number(supplierId)
      );
      setInvoiceFile(file);
      setInvoiceFileName(file.name);
      setInvoiceStoredOnShipmentId(null);
      setParseMeta({
        supplierName: parsed.supplierName,
        shipToName: parsed.shipToName,
        shipToAddress: parsed.shipToAddress,
      });
      const incoming = parsed.lines ?? [];
      const hydrated = await Promise.all(
        incoming.map(async (line) => {
          if (line.status !== 'matched' || line.inventoryItemId == null) return line;
          if (
            line.receiveQuantity != null &&
            line.trackLots != null &&
            line.sellUnitType !== undefined
          ) {
            return line;
          }
          try {
            const item = await loadInventoryItem(practiceId, line.inventoryItemId);
            return applyItemToParsedLine(line, item, line.receiveUnitsPerVendorQty);
          } catch {
            return line;
          }
        })
      );
      setParsedLines(hydrated);
      if (parsed.invoiceNumber) setInvoiceNumber(parsed.invoiceNumber);
      if (parsed.suggestedSupplierId != null) {
        setSupplierId(parsed.suggestedSupplierId);
      } else if (parsed.supplierName?.trim()) {
        const existing = suppliers.find(
          (s) => s.name.toLowerCase() === parsed.supplierName!.trim().toLowerCase()
        );
        if (existing) setSupplierId(existing.id);
        else {
          const created = await createSupplier(practiceId, { name: parsed.supplierName.trim() });
          setSuppliers((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
          setSupplierId(created.id);
        }
      }
      if (parsed.suggestedBranchId != null) setBranchId(parsed.suggestedBranchId);
      if (shipment) {
        await persistInvoiceOnShipment(shipment, file);
      }
      setToast(
        parsed.lines.length
          ? `Read ${parsed.lines.length} line${parsed.lines.length === 1 ? '' : 's'} from the invoice.`
          : 'Invoice read — no product lines found.'
      );
      window.setTimeout(() => setToast(null), 4000);
    } catch (err: unknown) {
      const axiosErr = err as {
        response?: { status?: number; data?: { message?: string | string[] } };
      };
      const status = axiosErr.response?.status;
      const nestMsg = axiosErr.response?.data?.message;
      const detail = Array.isArray(nestMsg)
        ? nestMsg.join(' ')
        : typeof nestMsg === 'string'
          ? nestMsg
          : null;
      if (status === 404) {
        setError(
          'Invoice reading is not on the API that is running. Restart vayd-api (the parse route is new) and try again.'
        );
      } else {
        setError(detail || (err instanceof Error ? err.message : 'Could not read invoice'));
      }
    } finally {
      setParsing(false);
    }
  }

  async function rememberLine(
    line: ParsedInvoiceLine,
    ignored: boolean,
    itemId?: number | null,
    receiveUnitsPerVendorQty?: number | null
  ) {
    const invoiceQty = invoiceQtyOf(line);
    const receiveQty = Number(line.receiveQuantity);
    const perVendor =
      receiveUnitsPerVendorQty != null && receiveUnitsPerVendorQty > 0
        ? receiveUnitsPerVendorQty
        : Number.isFinite(receiveQty) && receiveQty > 0
          ? receiveQty / invoiceQty
          : line.receiveUnitsPerVendorQty ?? null;
    await upsertVendorItemMap(practiceId, {
      supplierId: supplierId === '' ? null : Number(supplierId),
      vendorSku: line.vendorSku,
      vendorDescription: line.description,
      barcode: line.barcode,
      inventoryItemId: ignored ? null : itemId ?? line.inventoryItemId,
      ignored,
      receiveUnitsPerVendorQty: ignored ? null : perVendor,
    });
  }

  async function matchParsedLineToGroup(index: number, group: StockItemGroup) {
    const item = group.item ?? (await loadInventoryItem(practiceId, group.stockItemId));
    const line = parsedLines[index];
    if (!line) return;
    const next = {
      ...applyItemToParsedLine({ ...line, receiveQuantity: null }, item),
      matchVia: 'staff' as const,
    };
    setError(null);
    try {
      await rememberLine(next, false, item.id);
      setParsedLines((prev) => prev.map((row, i) => (i === index ? next : row)));
      setMatchSearchKey(null);
      setMatchSearchQ('');
      setMatchSearchResults([]);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not save match');
    }
  }

  async function ignoreParsedLine(index: number) {
    const line = parsedLines[index];
    if (!line) return;
    setError(null);
    try {
      await rememberLine(line, true);
      setParsedLines((prev) =>
        prev.map((row, i) =>
          i === index
            ? {
                ...row,
                status: 'ignored',
                inventoryItemId: null,
                inventoryItemName: null,
                matchVia: 'ignored_map',
              }
            : row
        )
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not ignore line');
    }
  }

  async function addParsedToShipment() {
    const matched = parsedLines.filter((l) => l.status === 'matched' && l.inventoryItemId != null);
    if (matched.length === 0) {
      setError('Match at least one line, or add items manually below');
      return;
    }
    const issues: Record<number, LineIssue> = {};
    let firstIssueIndex: number | null = null;
    parsedLines.forEach((line, index) => {
      if (line.status !== 'matched' || line.inventoryItemId == null) return;
      const issue = parsedLineIssue(line);
      if (!issue) return;
      issues[index] = issue;
      if (firstIssueIndex == null) firstIssueIndex = index;
    });
    if (firstIssueIndex != null) {
      setLineIssues(issues);
      setApproveError('Fill the highlighted fields on the lines above, then try again.');
      setError(null);
      window.requestAnimationFrame(() => {
        parsedLineRefs.current[firstIssueIndex!]?.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      });
      return;
    }
    setLineIssues({});
    setApproveError(null);
    if (!requireHeader()) return;
    setBusy(true);
    setError(null);
    try {
      let draft = await ensureDraft();
      draft = await patchShipment(practiceId, draft.id, {
        supplierId: Number(supplierId),
        invoiceNumber: invoiceNumber.trim(),
        defaultToBranchLocationId: Number(defaultLocId),
      });
      draft = await persistInvoiceOnShipment(draft);
      setShipment(draft);
      for (const line of matched) {
        const receiveQty = Number(line.receiveQuantity);
        const packQty = invoiceQtyOf(line);
        const lineTotal =
          line.lineTotal != null && Number.isFinite(Number(line.lineTotal))
            ? Number(line.lineTotal)
            : line.costPerUnit != null
              ? Number(line.costPerUnit) * packQty
              : null;
        const costPerUnit =
          lineTotal != null && receiveQty > 0
            ? Number((lineTotal / receiveQty).toFixed(4))
            : line.costPerUnit != null
              ? Number(Number(line.costPerUnit).toFixed(4))
              : null;
        await addShipmentLine(practiceId, draft.id, {
          inventoryItemId: line.inventoryItemId,
          quantity: receiveQty,
          costPerUnit,
          lotNumber: line.lotNumber?.trim() || null,
          expirationDate: line.expirationDate?.trim() || null,
          toBranchLocationId: Number(defaultLocId),
          vendorSku: line.vendorSku,
          barcodeScanned: line.barcode,
        });
        await rememberLine(line, false, line.inventoryItemId, receiveQty / packQty);
      }
      await refreshLines(draft.id);
      setToast('Approved invoice lines added to the shipment. Review the list below, then finalize.');
      scrollToShipment();
      window.setTimeout(() => setToast(null), 4000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not add invoice lines');
    } finally {
      setBusy(false);
    }
  }

  async function onAddSupplier() {
    if (!newSupplierName.trim()) return;
    setBusy(true);
    try {
      const s = await createSupplier(practiceId, { name: newSupplierName.trim() });
      setSuppliers((prev) => [...prev, s].sort((a, b) => a.name.localeCompare(b.name)));
      setSupplierId(s.id);
      setAddingSupplier(false);
      setNewSupplierName('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not add supplier');
    } finally {
      setBusy(false);
    }
  }

  async function onFinalize() {
    if (!requireHeader()) return;
    if (!shipment || lines.length === 0) {
      setError('Add at least one item before finalizing');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const patched = await patchShipment(practiceId, shipment.id, {
        supplierId: Number(supplierId),
        invoiceNumber: invoiceNumber.trim(),
        defaultToBranchLocationId: Number(defaultLocId),
      });
      await persistInvoiceOnShipment(patched);
      await finalizeShipment(practiceId, shipment.id);
      resetReceiveForm();
      await reloadReceived();
      setToast(
        'Shipment finalized — stock updated. You can upload another invoice. Lower costs go to Cost Reviews.'
      );
      window.setTimeout(() => setToast(null), 5000);
      window.requestAnimationFrame(() => {
        receivedSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Finalize failed');
    } finally {
      setBusy(false);
    }
  }

  async function openStoredInvoice(shipmentId: number) {
    try {
      const { url } = await getShipmentInvoiceFile(practiceId, shipmentId);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not open invoice');
    }
  }

  async function onRemoveLine(lineId: number) {
    if (!shipment) return;
    await removeShipmentLine(practiceId, shipment.id, lineId);
    await refreshLines(shipment.id);
  }

  const units = lines.reduce((s, l) => s + Number(l.quantity || 0), 0);
  const receivedPageCount = Math.max(1, Math.ceil(received.length / RECEIVED_PAGE_SIZE));
  const receivedPageSafe = Math.min(receivedPage, receivedPageCount);
  const receivedPageRows = received.slice(
    (receivedPageSafe - 1) * RECEIVED_PAGE_SIZE,
    receivedPageSafe * RECEIVED_PAGE_SIZE
  );

  return (
    <div className="settings-card" style={{ maxWidth: 720, margin: '0 auto', padding: 16 }}>
      <h2 style={{ marginTop: 0 }}>Receive Shipment</h2>
      {toast && (
        <div className="settings-message" style={{ marginBottom: 10 }}>
          {toast}
        </div>
      )}
      {error && (
        <div className="settings-message settings-error-message" style={{ marginBottom: 10 }}>
          {error}
        </div>
      )}

      <div className="settings-card" style={{ marginBottom: 16, padding: 12 }}>
        <label className="settings-label" style={{ marginBottom: 8 }}>
          Upload invoice
          <input
            className="settings-input"
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp"
            disabled={parsing || busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              void onInvoiceFile(file);
            }}
          />
        </label>
        <p className="settings-muted" style={{ margin: '6px 0 0', fontSize: 13 }}>
          PDF or photo. We read invoice #, ship-to office, and lines. Match once and we remember
          that supplier description; ignore syringes and other things you do not track.
        </p>
        {parsing && (
          <p className="settings-muted" style={{ marginTop: 8 }}>
            Reading invoice…
          </p>
        )}
        {invoiceFileName && !parsing && (
          <p className="settings-muted" style={{ marginTop: 8, fontSize: 13 }}>
            {invoiceFileName}
            {parseMeta?.supplierName ? ` · ${parseMeta.supplierName}` : ''}
            {parseMeta?.shipToName ? ` · Ship to ${parseMeta.shipToName}` : ''}
            {shipment?.invoicePdfKey || invoiceStoredOnShipmentId === shipment?.id
              ? ' · Stored with this shipment'
              : ' · Stored when you add lines or finalize'}
          </p>
        )}
      </div>

      {parsedLines.length > 0 && (
        <div className="settings-card" style={{ marginBottom: 16, padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>Invoice lines to approve</h3>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {parsedLines.map((line, index) => {
              const isMatched = line.status === 'matched';
              const isIgnored = line.status === 'ignored';
              const rematching = matchSearchKey === index;
              const issue = lineIssues[index];
              return (
              <li
                key={`${line.vendorSku ?? line.description}-${index}`}
                ref={(el) => {
                  parsedLineRefs.current[index] = el;
                }}
                style={{
                  padding: 12,
                  margin: '0 0 8px',
                  borderRadius: 6,
                  border: issue
                    ? '1px solid #dc2626'
                    : isMatched
                      ? '1px solid #4caf50'
                      : isIgnored
                        ? '1px solid #e0e0e0'
                        : '1px solid var(--border, #e5e7eb)',
                  backgroundColor: issue
                    ? '#fef2f2'
                    : isMatched
                      ? '#e8f5e9'
                      : isIgnored
                        ? '#f5f5f5'
                        : undefined,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                  <div>
                    <strong>{line.description}</strong>
                    <div className="settings-muted" style={{ fontSize: 13 }}>
                      {[
                        line.vendorSku ? `SKU ${line.vendorSku}` : null,
                        line.quantity != null ? `Qty ${line.quantity}` : null,
                        line.costPerUnit != null ? `$${Number(line.costPerUnit).toFixed(2)}/unit` : null,
                        line.lotNumber ? `Lot ${line.lotNumber}` : null,
                        line.expirationDate ? `Exp ${line.expirationDate}` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                    {isMatched && (
                      <div
                        style={{
                          marginTop: 8,
                          padding: '6px 8px',
                          backgroundColor: '#c8e6c9',
                          borderRadius: 4,
                          fontSize: 14,
                          color: '#2e7d32',
                          fontWeight: 500,
                          display: 'inline-block',
                        }}
                      >
                        ✓ Matched: {line.inventoryItemName}
                      </div>
                    )}
                    {isIgnored && (
                      <div className="settings-muted" style={{ fontSize: 13, marginTop: 6 }}>
                        Ignored — will not receive
                      </div>
                    )}
                    {!isMatched && !isIgnored && (
                      <div className="settings-muted" style={{ fontSize: 13, marginTop: 2 }}>
                        Needs a match or ignore
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                    {isMatched && !rematching && (
                      <span
                        className="btn secondary"
                        style={{
                          pointerEvents: 'none',
                          backgroundColor: '#c8e6c9',
                          borderColor: '#81c784',
                          color: '#2e7d32',
                          fontWeight: 600,
                        }}
                      >
                        Matched
                      </span>
                    )}
                    {!isIgnored && (
                      <button
                        type="button"
                        className="btn secondary"
                        onClick={() => {
                          if (rematching) {
                            setMatchSearchKey(null);
                            setMatchSearchQ('');
                            setMatchSearchResults([]);
                            return;
                          }
                          setMatchSearchKey(index);
                          setMatchSearchQ(line.description);
                        }}
                      >
                        {rematching ? 'Cancel' : isMatched ? 'Re-match' : 'Match'}
                      </button>
                    )}
                    {isIgnored ? (
                      <button
                        type="button"
                        className="btn secondary"
                        onClick={() => {
                          setParsedLines((prev) =>
                            prev.map((row, i) =>
                              i === index
                                ? { ...row, status: 'unmatched', matchVia: null }
                                : row
                            )
                          );
                          setMatchSearchKey(index);
                          setMatchSearchQ(line.description);
                        }}
                      >
                        Undo
                      </button>
                    ) : (
                      <button type="button" className="btn secondary" onClick={() => void ignoreParsedLine(index)}>
                        Ignore
                      </button>
                    )}
                  </div>
                </div>
                {isMatched && (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                      gap: 8,
                      marginTop: 10,
                    }}
                  >
                    <label className="settings-label">
                      Qty received ({sellUnitLabel(line.sellUnitType, line.sellUnitTypeDetail)}) *
                      <input
                        className="settings-input"
                        type="number"
                        min={0.01}
                        step="any"
                        value={line.receiveQuantity ?? ''}
                        style={issue?.field === 'qty' ? { borderColor: '#dc2626' } : undefined}
                        onChange={(e) => {
                          const raw = e.target.value;
                          const n = Number(raw);
                          const receiveQuantity =
                            raw.trim() === '' || !Number.isFinite(n) ? null : n;
                          const per =
                            receiveQuantity != null && receiveQuantity > 0
                              ? receiveQuantity / invoiceQtyOf(line)
                              : line.receiveUnitsPerVendorQty ?? null;
                          clearLineIssue(index, 'qty');
                          setParsedLines((prev) =>
                            prev.map((row, i) =>
                              i === index
                                ? { ...row, receiveQuantity, receiveUnitsPerVendorQty: per }
                                : row
                            )
                          );
                        }}
                        required
                      />
                      {issue?.field === 'qty' && (
                        <span style={{ display: 'block', marginTop: 4, color: '#dc2626', fontSize: 13 }}>
                          {issue.message}
                        </span>
                      )}
                    </label>
                    {line.trackLots && (
                      <label className="settings-label">
                        Lot # *
                        <input
                          className="settings-input"
                          value={line.lotNumber ?? ''}
                          style={issue?.field === 'lot' ? { borderColor: '#dc2626' } : undefined}
                          onChange={(e) => {
                            const lotNumber = e.target.value;
                            clearLineIssue(index, 'lot');
                            setParsedLines((prev) =>
                              prev.map((row, i) => (i === index ? { ...row, lotNumber } : row))
                            );
                          }}
                          required
                        />
                        {issue?.field === 'lot' && (
                          <span style={{ display: 'block', marginTop: 4, color: '#dc2626', fontSize: 13 }}>
                            {issue.message}
                          </span>
                        )}
                      </label>
                    )}
                    {line.requireExpirationOnLots && (
                      <label className="settings-label">
                        Exp date *
                        <input
                          className="settings-input"
                          type="date"
                          value={line.expirationDate ?? ''}
                          style={issue?.field === 'exp' ? { borderColor: '#dc2626' } : undefined}
                          onChange={(e) => {
                            const expirationDate = e.target.value;
                            clearLineIssue(index, 'exp');
                            setParsedLines((prev) =>
                              prev.map((row, i) => (i === index ? { ...row, expirationDate } : row))
                            );
                          }}
                          required
                        />
                        {issue?.field === 'exp' && (
                          <span style={{ display: 'block', marginTop: 4, color: '#dc2626', fontSize: 13 }}>
                            {issue.message}
                          </span>
                        )}
                      </label>
                    )}
                    <p className="settings-muted" style={{ gridColumn: '1 / -1', margin: 0, fontSize: 13 }}>
                      Invoice qty {invoiceQtyOf(line)}
                      {/\b\d+\s*[xX×]\s*1/i.test(line.description) ||
                      /\b\d+\s*(?:ds|doses)\b/i.test(line.description)
                        ? ` from “${line.description}”`
                        : ''}
                      {line.receiveUnitsPerVendorQty != null &&
                      Number(line.receiveUnitsPerVendorQty) !== 1
                        ? ` — we'll remember ${Number(line.receiveUnitsPerVendorQty)} ${sellUnitLabel(line.sellUnitType, line.sellUnitTypeDetail)} per invoice qty.`
                        : '.'}
                    </p>
                  </div>
                )}
                {matchSearchKey === index && (
                  <div style={{ marginTop: 8 }}>
                    <input
                      className="settings-input"
                      value={matchSearchQ}
                      onChange={(e) => setMatchSearchQ(e.target.value)}
                      placeholder="Search inventory to match"
                    />
                    {matchSearchGroups.length > 0 && (
                      <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0' }}>
                        {matchSearchGroups.slice(0, 8).map((g) => (
                          <li key={`match-stock-${g.stockItemId}`}>
                            <button
                              type="button"
                              className="btn secondary"
                              style={{ width: '100%', textAlign: 'left', marginBottom: 4 }}
                              onClick={() => void matchParsedLineToGroup(index, g)}
                            >
                              <span style={{ display: 'block' }}>{g.label}</span>
                              {g.viaNames.length > 0 ? (
                                <span style={{ display: 'block', fontSize: 12, opacity: 0.75 }}>
                                  Draws stock for {g.viaNames.slice(0, 2).join(', ')}
                                  {g.viaNames.length > 2 ? ` +${g.viaNames.length - 2} more` : ''}
                                </span>
                              ) : g.noStockLink ? (
                                <span style={{ display: 'block', fontSize: 12, opacity: 0.75 }}>
                                  No stock link — draws on itself
                                </span>
                              ) : (
                                <span style={{ display: 'block', fontSize: 12, opacity: 0.75 }}>
                                  Stock item
                                </span>
                              )}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {matchSearchQ.trim().length >= 2 && matchSearchGroups.length === 0 && (
                      <p className="settings-muted" style={{ marginTop: 6 }}>
                        No matching stock items. Linked charge codes resolve to their stock item;
                        unlinked ones still appear.
                      </p>
                    )}
                  </div>
                )}
              </li>
              );
            })}
          </ul>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 8,
              alignItems: 'center',
              marginTop: 12,
            }}
          >
            <button
              type="button"
              className="btn primary"
              disabled={busy || parsing || !parsedLines.some((l) => parsedLineReady(l))}
              onClick={() => void addParsedToShipment()}
            >
              Add approved lines to shipment
            </button>
            <button
              type="button"
              className="btn secondary"
              disabled={busy || parsing}
              onClick={() => void clearInvoiceLines()}
            >
              Clear all invoice lines
            </button>
          </div>
          {approveError && (
            <p className="settings-error-message" style={{ margin: '8px 0 0', fontSize: 13 }}>
              {approveError}
            </p>
          )}
        </div>
      )}

      <label className="settings-label">
        Destination office *
        <select
          className="settings-input"
          value={branchId}
          onChange={(e) => setBranchId(e.target.value ? Number(e.target.value) : '')}
          disabled={!!shipment}
          required
        >
          <option value="">Select…</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
      {shipment ? (
        <p className="settings-muted" style={{ marginTop: -8, marginBottom: 12, fontSize: 13 }}>
          Locked because this shipment is already started for this office — not because the invoice
          named it. Stock will receive here. Start a new receive to use a different office.
        </p>
      ) : null}

      <label className="settings-label">
        Default location *
        <select
          className="settings-input"
          value={defaultLocId}
          onChange={(e) => {
            const v = e.target.value ? Number(e.target.value) : '';
            setDefaultLocId(v);
            setLineLocId(v);
          }}
          required
        >
          <option value="">Select…</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </label>

      <label className="settings-label">
        Supplier *
        <select
          className="settings-input"
          value={supplierId}
          onChange={(e) => setSupplierId(e.target.value ? Number(e.target.value) : '')}
          required
        >
          <option value="">Select…</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      {!addingSupplier ? (
        <button type="button" className="btn secondary" onClick={() => setAddingSupplier(true)}>
          Add new supplier
        </button>
      ) : (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input
            className="settings-input"
            placeholder="Supplier name"
            value={newSupplierName}
            onChange={(e) => setNewSupplierName(e.target.value)}
          />
          <button type="button" className="btn primary" disabled={busy} onClick={() => void onAddSupplier()}>
            Save
          </button>
        </div>
      )}

      <label className="settings-label">
        Invoice / packing slip # *
        <input
          className="settings-input"
          value={invoiceNumber}
          onChange={(e) => setInvoiceNumber(e.target.value)}
          required
        />
      </label>
      {duplicateInvoice && (
        <div
          className="settings-message"
          style={{
            marginTop: -4,
            marginBottom: 12,
            backgroundColor: '#fff7ed',
            border: '1px solid #fdba74',
            color: '#9a3412',
          }}
        >
          Invoice {duplicateInvoice.invoiceNumber} was already unpacked
          {duplicateInvoice.receivedByName ? ` by ${duplicateInvoice.receivedByName}` : ''}
          {duplicateInvoice.finalizedAt
            ? ` on ${new Date(duplicateInvoice.finalizedAt).toLocaleString()}`
            : ''}
          .{' '}
          <button
            type="button"
            className="btn secondary"
            style={{ marginLeft: 6 }}
            onClick={() => void openReceivedShipment(duplicateInvoice.id)}
          >
            View that shipment
          </button>
        </div>
      )}

      {!headerReady && (
        <p className="settings-muted" style={{ marginTop: 8 }}>
          Complete supplier and invoice # before searching items.
        </p>
      )}

      <label className="settings-label" style={{ marginTop: 16 }}>
        Search item *
        <input
          className="settings-input"
          value={searchQ}
          onChange={(e) => setSearchQ(e.target.value)}
          placeholder="Stock item name (e.g. FVRCP)"
          disabled={!headerReady}
          required
        />
        {searchGroups.length > 0 && (
          <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0' }}>
            {searchGroups.slice(0, 8).map((g) => (
              <li key={`stock-${g.stockItemId}`}>
                <button
                  type="button"
                  className="btn secondary"
                  style={{ width: '100%', textAlign: 'left', marginBottom: 4 }}
                  onClick={() => void chooseStockItem(g)}
                >
                  <span style={{ display: 'block' }}>{g.label}</span>
                  {g.viaNames.length > 0 ? (
                    <span style={{ display: 'block', fontSize: 12, opacity: 0.75 }}>
                      Draws stock for {g.viaNames.slice(0, 2).join(', ')}
                      {g.viaNames.length > 2 ? ` +${g.viaNames.length - 2} more` : ''}
                    </span>
                  ) : g.noStockLink ? (
                    <span style={{ display: 'block', fontSize: 12, opacity: 0.75 }}>
                      No stock link — draws on itself
                    </span>
                  ) : (
                    <span style={{ display: 'block', fontSize: 12, opacity: 0.75 }}>
                      Stock item
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
        {headerReady && searchQ.trim().length >= 2 && searchGroups.length === 0 && (
          <p className="settings-muted" style={{ marginTop: 6 }}>
            No matching stock items. Linked charge codes resolve to their stock item; unlinked
            ones still appear so you can receive them or set “Draws from” in Catalog.
          </p>
        )}
      </label>

      {selectedItem && (
        <div className="settings-card" style={{ marginTop: 12, padding: 12 }}>
          <strong>{selectedItem.name}</strong>
          {selectedItem.viaName && (
            <div className="settings-muted" style={{ fontSize: 13, marginTop: 2 }}>
              Receiving into the stock item that {selectedItem.viaName} draws from.
            </div>
          )}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
              gap: 8,
              marginTop: 8,
            }}
          >
            <label className="settings-label">
              Qty received ({sellUnitLabel(selectedItem.sellUnitType)}) *
              <input
                className="settings-input"
                type="number"
                min={0.01}
                step="any"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                required
              />
            </label>
            {selectedItem.trackLots && (
            <label className="settings-label">
              Lot # *
              <input
                className="settings-input"
                value={lot}
                onChange={(e) => setLot(e.target.value)}
                required
              />
            </label>
            )}
            {selectedItem.requireExpirationOnLots && (
            <label className="settings-label">
              Exp date *
              <input
                className="settings-input"
                type="date"
                value={exp}
                onChange={(e) => setExp(e.target.value)}
                required
              />
            </label>
            )}
            <label className="settings-label">
              Location *
              <select
                className="settings-input"
                value={lineLocId}
                onChange={(e) => setLineLocId(e.target.value ? Number(e.target.value) : '')}
                required
              >
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div style={{ marginTop: 12 }}>
            <div className="settings-label" style={{ marginBottom: 6 }}>
              Cost * (from invoice)
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <button
                type="button"
                className={`btn ${costMode === 'total' ? 'primary' : 'secondary'}`}
                onClick={() => setCostMode('total')}
              >
                Total cost
              </button>
              <button
                type="button"
                className={`btn ${costMode === 'perUnit' ? 'primary' : 'secondary'}`}
                onClick={() => setCostMode('perUnit')}
              >
                Cost / unit
              </button>
            </div>
            <label className="settings-label" style={{ maxWidth: 220 }}>
              {costMode === 'total' ? 'Total cost for this line *' : 'Cost per unit *'}
              <input
                className="settings-input"
                type="number"
                min={0}
                step="0.01"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                placeholder={costMode === 'total' ? 'e.g. invoice line total' : 'e.g. 8.35'}
                required
              />
            </label>
            {(() => {
              const q = Number(qty);
              const c = Number(cost);
              if (!Number.isFinite(q) || q <= 0 || cost.trim() === '' || !Number.isFinite(c) || c < 0) {
                return null;
              }
              if (costMode === 'total') {
                const per = c / q;
                return (
                  <p className="settings-muted" style={{ margin: '6px 0 0', fontSize: 13 }}>
                    ≈ ${per.toFixed(4)} per unit ({q} × ${per.toFixed(4)})
                  </p>
                );
              }
              return (
                <p className="settings-muted" style={{ margin: '6px 0 0', fontSize: 13 }}>
                  Line total ≈ ${(c * q).toFixed(2)}
                </p>
              );
            })()}
          </div>

          <button
            type="button"
            className="btn primary"
            style={{ marginTop: 10 }}
            disabled={busy || !headerReady}
            onClick={() => void addLine()}
          >
            Add to shipment
          </button>
        </div>
      )}

      {(shipment || lines.length > 0) && (
        <>
          <div ref={shipmentSectionRef} style={{ marginTop: 24 }}>
            <h3 style={{ marginBottom: 8 }}>
              Shipment ({lines.length} items, {units} units)
            </h3>
            {lines.length === 0 ? (
              <p className="settings-muted">
                No lines yet — search and add at least one item (required).
              </p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0 }}>
                {lines.map((l) => (
                  <li
                    key={l.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      gap: 12,
                      padding: '8px 0',
                      borderBottom: '1px solid var(--border, #e5e7eb)',
                    }}
                  >
                    <div>
                      <div>
                        {l.itemName ?? `Item #${l.inventoryItemId}`} × {Number(l.quantity)}
                        {l.lotNumber ? ` · Lot ${l.lotNumber}` : ''}
                        {l.expirationDate ? ` · Exp ${String(l.expirationDate).slice(0, 10)}` : ''}
                        {l.costPerUnit != null
                          ? ` · $${Number(l.costPerUnit).toFixed(4)}/unit`
                          : ''}
                      </div>
                      {l.willUpdatePrice ? (
                        <div style={{ marginTop: 2, fontSize: 13, fontWeight: 600, color: '#2e7d32' }}>
                          Will update price
                          {l.catalogCost != null
                            ? ` (catalog $${Number(l.catalogCost).toFixed(4)} → $${Number(l.costPerUnit).toFixed(4)})`
                            : ''}
                        </div>
                      ) : l.willQueueCostReview ? (
                        <div style={{ marginTop: 2, fontSize: 13, color: '#9a3412' }}>
                          Lower than catalog — manager will review on Cost Reviews
                        </div>
                      ) : null}
                    </div>
                    <button type="button" className="btn secondary" onClick={() => void onRemoveLine(l.id)}>
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p className="settings-muted" style={{ marginTop: 16 }}>
            Finalizing records your signed-in account and the current time automatically.
          </p>

          <button
            type="button"
            className="btn primary"
            style={{ width: '100%', marginTop: 12, minHeight: 48 }}
            disabled={busy || !canFinalize}
            onClick={() => void onFinalize()}
          >
            {busy ? 'Working…' : 'Finalize shipment'}
          </button>
        </>
      )}

      <div ref={receivedSectionRef} style={{ marginTop: 32 }}>
        <h3 style={{ marginBottom: 8 }}>Shipments received</h3>
        {received.length === 0 ? (
          <p className="settings-muted">No finalized shipments yet.</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {receivedPageRows.map((row) => {
              const office = branches.find((b) => b.id === row.branchId)?.name;
              const supplier = suppliers.find((s) => s.id === row.supplierId)?.name;
              const when = row.finalizedAt
                ? new Date(row.finalizedAt).toLocaleString()
                : null;
              const deleted = row.status === 'deleted';
              const deletedWhen = row.deletedAt
                ? new Date(row.deletedAt).toLocaleString()
                : null;
              const open = receivedOpenId === row.id;
              return (
                <li
                  key={row.id}
                  style={{
                    padding: '10px 0',
                    borderBottom: '1px solid var(--border, #e5e7eb)',
                  }}
                >
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <button
                      type="button"
                      className="btn secondary"
                      style={{
                        flex: 1,
                        textAlign: 'left',
                        ...(deleted
                          ? {
                              background: '#fef2f2',
                              borderColor: '#fca5a5',
                              color: '#991b1b',
                            }
                          : null),
                      }}
                      onClick={() => void toggleReceived(row.id)}
                    >
                      <span style={{ display: 'block', fontWeight: 600 }}>
                        {row.invoiceNumber?.trim() || `Shipment #${row.id}`}
                        {deleted ? ' · Deleted' : ''}
                      </span>
                      <span style={{ display: 'block', fontSize: 13, opacity: 0.8 }}>
                        {[
                          supplier,
                          office,
                          row.receivedByName
                            ? `Received by ${row.receivedByName}`
                            : row.receivedByEmployeeId != null
                              ? `Received by staff #${row.receivedByEmployeeId}`
                              : null,
                          when,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                      {deleted ? (
                        <span
                          style={{
                            display: 'block',
                            fontSize: 13,
                            fontWeight: 700,
                            color: '#b91c1c',
                            marginTop: 4,
                          }}
                        >
                          {[
                            row.deletedByName
                              ? `Deleted by ${row.deletedByName}`
                              : 'Deleted',
                            deletedWhen,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      ) : null}
                    </button>
                    {row.invoicePdfKey ? (
                      <button
                        type="button"
                        className="btn secondary"
                        onClick={() => void openStoredInvoice(row.id)}
                      >
                        View invoice
                      </button>
                    ) : null}
                    {!deleted ? (
                      <button
                        type="button"
                        className="btn secondary"
                        disabled={receivedBusy}
                        onClick={() => void onDeleteReceived(row)}
                      >
                        Delete
                      </button>
                    ) : null}
                  </div>
                  {open && (
                    <ul style={{ listStyle: 'none', padding: '8px 0 0 8px', margin: 0 }}>
                      {receivedBusy && receivedLines.length === 0 ? (
                        <li className="settings-muted">Loading…</li>
                      ) : receivedLines.length === 0 ? (
                        <li className="settings-muted">No lines</li>
                      ) : (
                        receivedLines.map((l) => (
                          <li key={l.id} style={{ fontSize: 14, padding: '4px 0' }}>
                            {l.itemName ?? `Item #${l.inventoryItemId}`} × {Number(l.quantity)}
                            {l.lotNumber ? ` · Lot ${l.lotNumber}` : ''}
                            {l.expirationDate
                              ? ` · Exp ${String(l.expirationDate).slice(0, 10)}`
                              : ''}
                            {l.costPerUnit != null
                              ? ` · $${Number(l.costPerUnit).toFixed(4)}/unit`
                              : ''}
                          </li>
                        ))
                      )}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {received.length > RECEIVED_PAGE_SIZE && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              marginTop: 12,
            }}
          >
            <button
              type="button"
              className="btn secondary"
              disabled={receivedPageSafe <= 1}
              onClick={() => {
                setReceivedPage((p) => Math.max(1, p - 1));
                setReceivedOpenId(null);
                setReceivedLines([]);
                receivedSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
            >
              Previous
            </button>
            <span className="settings-muted" style={{ fontSize: 14 }}>
              Page {receivedPageSafe} of {receivedPageCount}
            </span>
            <button
              type="button"
              className="btn secondary"
              disabled={receivedPageSafe >= receivedPageCount}
              onClick={() => {
                setReceivedPage((p) => Math.min(receivedPageCount, p + 1));
                setReceivedOpenId(null);
                setReceivedLines([]);
                receivedSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
