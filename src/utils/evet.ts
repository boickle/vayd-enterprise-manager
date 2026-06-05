// src/utils/evet.ts — deep links into eVet Practice (se4)

const EVET_HOST = 'https://se4.evetpractice.com';

export function evetClientLink(pimsId: string) {
  return `${EVET_HOST}/Practice/Clients/Edit/${pimsId}`;
}

/** Create a new client in eVet. */
export function evetCreateClientLink() {
  return `${EVET_HOST}/Practice/Clients/Create/0`;
}

export function evetPatientLink(pimsId: string) {
  return `${EVET_HOST}/Practice/Patients/Edit/${pimsId}`;
}

/** Patient chart / medical record (legacy numeric PIMS id on patient). */
export function evetPatientChartLink(pimsId: string) {
  return evetPatientLink(pimsId);
}

/**
 * Quick Invoicing / Add Charges for a client (`client.pimsId`).
 * e.g. https://se4.evetpractice.com/Practice/Clients/QuickInvoice/1359439
 */
export function evetQuickInvoicingLink(clientPimsId: string) {
  return `${EVET_HOST}/Practice/Clients/QuickInvoice/${clientPimsId}`;
}

/**
 * Client checkout in eVet (`client.pimsId`).
 * e.g. https://se4.evetpractice.com/Practice/Clients/Checkout/985206
 */
export function evetCheckoutLink(clientPimsId: string) {
  return `${EVET_HOST}/Practice/Clients/Checkout/${clientPimsId}`;
}

/**
 * Add medical note on an appointment.
 * `appointmentPimsId` — appointment id in PIMS (path segment after AddNote).
 * `clientPimsId` — client id (`cid` query param).
 */
export function evetMedicalNoteLink(appointmentPimsId: string, clientPimsId: string) {
  const q = new URLSearchParams({
    noteOwnerType: 'MedicalRecord',
    cid: clientPimsId,
  });
  return `${EVET_HOST}/Practice/Notes/AddNote/${appointmentPimsId}?${q.toString()}`;
}

/**
 * Add a client communication entry in eVet.
 * e.g. …/Practice/Clients/EditCommunicationEntry/0?clientId=1044781&patientId=2144284
 */
export function evetAddCommunicationLink(clientPimsId: string, patientPimsId: string) {
  const q = new URLSearchParams({
    clientId: clientPimsId,
    patientId: patientPimsId,
  });
  return `${EVET_HOST}/Practice/Clients/EditCommunicationEntry/0?${q.toString()}`;
}
