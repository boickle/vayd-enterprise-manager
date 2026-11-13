import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INVOICE_CATEGORY_ORDER,
  invoiceCategoryFor,
  isStandardInvoiceOrder,
  mergeClientLinesIntoStaffOrder,
  moveInvoiceOrderKey,
  normalizeInvoiceCategoryOrder,
  placeLineInOrder,
  reconcileInvoiceOrder,
  sortByKeyOrder,
  standardInvoiceOrderKeys,
  type InvoiceOrderLine,
} from './roomLoaderInvoiceOrder';

const ORDER = DEFAULT_INVOICE_CATEGORY_ORDER;

describe('invoiceCategoryFor (RLO-01)', () => {
  it.each([
    [{ name: 'Trip Fee', itemType: 'procedure' }, 'trip'],
    [{ name: 'CV-Tier 2 Trip Fee', itemType: 'procedure' }, 'trip'],
    [{ name: 'Something', code: 'TRIPFEEOFFICE', itemType: 'procedure' }, 'trip'],
    [{ name: 'Annual Wellness Visit', itemType: 'procedure' }, 'exam'],
    [{ name: 'Medical/Sick Visit', itemType: 'procedure' }, 'exam'],
    [{ name: 'Domestic Health Certificate Exam', itemType: 'procedure' }, 'exam'],
    [{ name: 'Telehealth - Virtual Consult', itemType: 'procedure' }, 'exam'],
    [{ name: 'Pedicure with Exam', itemType: 'procedure' }, 'procedure'],
    [{ name: 'Cytology - Ear Recheck', itemType: 'procedure' }, 'procedure'],
    [{ name: 'Nail Trim', itemType: 'procedure' }, 'procedure'],
    [
      {
        name: 'DAPP (Distemper) Vaccine - 1 year',
        itemType: 'inventory',
        categoryName: 'Vaccines',
      },
      'vaccine',
    ],
    [
      {
        name: 'Wellness Clinic - Rabies Vaccine - 3 year',
        itemType: 'inventory',
        categoryName: 'CVB- Wellness Clinic',
      },
      'vaccine',
    ],
    [
      { name: 'Bar Vac CDT Vaccine', itemType: 'inventory', categoryName: 'Farm / Lg Animal' },
      'vaccine',
    ],
    [
      { name: 'Wellness Clinic- 4dx', itemType: 'inventory', categoryName: 'CVB- Wellness Clinic' },
      'lab',
    ],
    [{ name: 'Home Fecal Check Kit', itemType: 'inventory', categoryName: 'Lab - Outside' }, 'lab'],
    [{ name: '4Dx Plus', itemType: 'lab' }, 'lab'],
    [
      {
        name: 'Simparica Trio',
        itemType: 'inventory',
        categoryName: 'FDA Rx HW or Combo HW/Parasite',
      },
      'med',
    ],
    [{ name: 'Cytopoint 20mg', itemType: 'Inventory', categoryName: 'Injections' }, 'med'],
    [
      { name: 'Profender Small', itemType: 'inventory', categoryName: 'CVB- Wellness Clinic' },
      'med',
    ],
    [{ name: 'Dog food 30 lb', isStore: true }, 'store'],
    [{ name: 'Senior Wellness Visit' }, 'exam'],
    [{ name: 'Rabies vaccine' }, 'vaccine'],
    [{ name: 'Mystery line' }, 'other'],
    [{ name: 'Sharps Disposal Fee', itemType: 'procedure' }, 'sharps'],
  ])('%j → %s', (input, expected) => {
    expect(invoiceCategoryFor(input)).toBe(expected);
  });
});

describe('normalizeInvoiceCategoryOrder (RLO-02)', () => {
  it('keeps a saved order and appends missing categories', () => {
    expect(normalizeInvoiceCategoryOrder(['exam', 'trip', 'bogus', 'exam'])).toEqual([
      'exam',
      'trip',
      'vaccine',
      'lab',
      'procedure',
      'med',
      'store',
    ]);
  });
  it('falls back to the default for junk', () => {
    expect(normalizeInvoiceCategoryOrder(null)).toEqual(ORDER);
    expect(normalizeInvoiceCategoryOrder('trip')).toEqual(ORDER);
  });
});

const L = (key: string, category: InvoiceOrderLine['category']): InvoiceOrderLine => ({
  key,
  category,
});

// Today's Room Loader shows reminders first, then added items.
const lines: InvoiceOrderLine[] = [
  L('r:dhpp', 'vaccine'),
  L('r:4dx', 'lab'),
  L('r:simparica', 'med'),
  L('r:rabies', 'vaccine'),
  L('a:exam', 'exam'),
  L('a:nails', 'procedure'),
  L('a:trip', 'trip'),
  L('a:odd', 'other'),
];

describe('standard order (RLO-03)', () => {
  it('sorts by category and keeps each category in arrival order', () => {
    expect(standardInvoiceOrderKeys(lines, ORDER)).toEqual([
      'a:trip',
      'a:exam',
      'r:dhpp',
      'r:rabies',
      'r:4dx',
      'a:nails',
      'r:simparica',
      'a:odd',
    ]);
  });
  it('follows a practice order from Settings', () => {
    const order = normalizeInvoiceCategoryOrder(['exam', 'trip']);
    expect(standardInvoiceOrderKeys(lines, order).slice(0, 2)).toEqual(['a:exam', 'a:trip']);
  });
});

describe('staff arrangement (RLO-04)', () => {
  it('a moved order is not standard; moving it back is', () => {
    const standard = standardInvoiceOrderKeys(lines, ORDER);
    const moved = moveInvoiceOrderKey(standard, 'r:4dx', 0);
    expect(moved[0]).toBe('r:4dx');
    expect(isStandardInvoiceOrder(moved, lines, ORDER)).toBe(false);
    expect(isStandardInvoiceOrder(moveInvoiceOrderKey(moved, 'r:4dx', 4), lines, ORDER)).toBe(true);
  });

  it('ignores moves out of range', () => {
    const keys = ['a', 'b'];
    expect(moveInvoiceOrderKey(keys, 'a', 5)).toBe(keys);
    expect(moveInvoiceOrderKey(keys, 'zz', 0)).toBe(keys);
  });

  it('a newly confirmed line goes after the last line of its category', () => {
    const saved = ['r:4dx', 'a:trip', 'a:exam', 'r:dhpp', 'a:nails', 'r:simparica', 'a:odd'];
    const withRabies = reconcileInvoiceOrder(saved, lines, ORDER);
    expect(withRabies).toEqual([
      'r:4dx',
      'a:trip',
      'a:exam',
      'r:dhpp',
      'r:rabies',
      'a:nails',
      'r:simparica',
      'a:odd',
    ]);
  });

  it('a line with no category-mate goes after the last earlier category', () => {
    const categoryOf = (k: string) => lines.find((l) => l.key === k)?.category;
    expect(
      placeLineInOrder(['a:trip', 'r:4dx', 'r:simparica'], L('a:exam', 'exam'), categoryOf, ORDER)
    ).toEqual(['a:trip', 'a:exam', 'r:4dx', 'r:simparica']);
  });

  it('drops saved keys that are gone (removed or un-confirmed) and duplicates', () => {
    const saved = ['r:gone', 'a:trip', 'a:trip', 'a:exam'];
    const keys = reconcileInvoiceOrder(saved, lines, ORDER);
    expect(keys).not.toContain('r:gone');
    expect(keys.filter((k) => k === 'a:trip')).toHaveLength(1);
    expect(keys).toHaveLength(lines.length);
  });

  it('no saved arrangement is the standard order', () => {
    expect(reconcileInvoiceOrder(null, lines, ORDER)).toEqual(
      standardInvoiceOrderKeys(lines, ORDER)
    );
  });
});

describe('client form merge (RLO-05)', () => {
  it('staff lines keep the sent order; client-added lines slot in by category', () => {
    const keys = mergeClientLinesIntoStaffOrder(
      [
        { key: 'd:0', category: 'lab', staffPosition: 0 },
        { key: 'd:1', category: 'exam', staffPosition: 2 },
        { key: 't:0', category: 'trip', staffPosition: 1 },
        { key: 'c:lab:9', category: 'lab', staffPosition: null },
        { key: 'c:inventory:5', category: 'vaccine', staffPosition: null },
      ],
      ORDER
    );
    // Staff put the lab first; the panel the client added goes with it, the vaccine after the exam.
    expect(keys).toEqual(['d:0', 'c:lab:9', 't:0', 'd:1', 'c:inventory:5']);
  });

  it('a client line whose category comes first goes to the top', () => {
    const keys = mergeClientLinesIntoStaffOrder(
      [
        { key: 'd:0', category: 'lab', staffPosition: 0 },
        { key: 'c:procedure:3', category: 'trip', staffPosition: null },
      ],
      ORDER
    );
    expect(keys).toEqual(['c:procedure:3', 'd:0']);
  });

  it('a form sent before invoice order (no positions) is sorted by category', () => {
    const keys = mergeClientLinesIntoStaffOrder(
      [
        { key: 'd:0', category: 'vaccine', staffPosition: null },
        { key: 'd:1', category: 'exam', staffPosition: null },
        { key: 't:0', category: 'trip', staffPosition: null },
      ],
      ORDER
    );
    expect(keys).toEqual(['t:0', 'd:1', 'd:0']);
  });
});

describe('sharps disposal is always last (owner, Nov 13)', () => {
  it('in the standard order, after other', () => {
    expect(
      standardInvoiceOrderKeys(
        [L('s', 'sharps'), L('o', 'other'), L('t', 'trip'), L('v', 'vaccine')],
        ORDER
      )
    ).toEqual(['t', 'v', 'o', 's']);
  });
  it('even when staff saved it higher, or the client form sent it first', () => {
    const lines = [L('s', 'sharps'), L('t', 'trip'), L('v', 'vaccine')];
    expect(reconcileInvoiceOrder(['s', 'v', 't'], lines, ORDER)).toEqual(['v', 't', 's']);
    expect(
      mergeClientLinesIntoStaffOrder(
        [
          { key: 's', category: 'sharps', staffPosition: 0 },
          { key: 't', category: 'trip', staffPosition: 1 },
        ],
        ORDER
      )
    ).toEqual(['t', 's']);
  });
});

describe('sortByKeyOrder', () => {
  it('unknown keys keep their relative order at the end', () => {
    const rows = [{ k: 'x' }, { k: 'b' }, { k: 'y' }, { k: 'a' }];
    expect(sortByKeyOrder(rows, (r) => r.k, ['a', 'b']).map((r) => r.k)).toEqual([
      'a',
      'b',
      'x',
      'y',
    ]);
  });
});
