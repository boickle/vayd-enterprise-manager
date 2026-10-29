/** INV-05-7: the "Shipments received" list shows who received each one, and when. */
import {
  deletedShipmentText,
  receivedByText,
  receivedShipmentSummary,
} from './receivedShipmentSummary';

describe('INV-05-7: who received a shipment', () => {
  const finalizedAt = '2026-10-28T18:11:17.000Z';

  it('shows "Received by {name}" and the time', () => {
    const text = receivedShipmentSummary(
      { receivedByName: 'Jane Tech', receivedByEmployeeId: 7, receivedByUserId: 3, finalizedAt },
      { supplier: 'Covetrus', office: 'Kingfield' }
    );
    expect(text).toBe(
      `Covetrus · Kingfield · Received by Jane Tech · ${new Date(finalizedAt).toLocaleString()}`
    );
  });

  it('never leaves who blank when there is any record of the person', () => {
    expect(
      receivedByText({
        receivedByName: null,
        receivedByEmployeeId: 7,
        receivedByUserId: null,
        finalizedAt,
      })
    ).toBe('Received by staff #7');
    expect(
      receivedByText({
        receivedByName: null,
        receivedByEmployeeId: null,
        receivedByUserId: 3,
        finalizedAt,
      })
    ).toBe('Received by login #3');
  });

  it('shows who deleted a shipment', () => {
    expect(
      deletedShipmentText({ deletedByName: 'Jane Tech', deletedByUserId: 3, deletedAt: null })
    ).toBe('Deleted by Jane Tech');
    expect(
      deletedShipmentText({ deletedByName: null, deletedByUserId: null, deletedAt: null })
    ).toBe('Deleted');
  });
});
