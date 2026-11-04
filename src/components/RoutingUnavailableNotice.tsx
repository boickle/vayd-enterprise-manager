// SCH-A3: shown when the API says routing (OSRM) is down, instead of "no times available".

export const PRACTICE_CONTACT_PHONE = '(207) 536-8387';

export const ROUTING_UNAVAILABLE_ONLINE_MESSAGE = `Online booking is unavailable right now. Please call or text us at ${PRACTICE_CONTACT_PHONE} and we'll find you a time.`;

export const ROUTING_UNAVAILABLE_STAFF_MESSAGE =
  'Routing is unavailable right now (the drive-time service is not answering), so no suggestions can be shown. Staff have been alerted; book by hand until it is back.';

export default function RoutingUnavailableNotice({
  message = ROUTING_UNAVAILABLE_ONLINE_MESSAGE,
}: {
  message?: string;
}) {
  return (
    <div
      role="alert"
      data-testid="routing-unavailable-notice"
      style={{
        marginBottom: '16px',
        padding: '16px',
        backgroundColor: '#fef2f2',
        border: '1px solid #ef4444',
        borderRadius: '8px',
        fontSize: '14px',
        color: '#991b1b',
        lineHeight: 1.6,
      }}
    >
      {message}
    </div>
  );
}
