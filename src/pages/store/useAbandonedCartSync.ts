import { useEffect } from 'react';
import { publicStoreCartActivity } from '../../api/onlineStore';
import { readStoreCart } from './storeCartState';
import { useStoreCart } from './useStoreCart';

const PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

export function useAbandonedCartSync(
  email: string | null | undefined,
  clientId: number | null,
  extras?: {
    customerName?: string | null;
    fulfillmentLabel?: string | null;
    estimatedTotal?: number | null;
    patientNamesById?: Record<number, string>;
  },
) {
  const lines = useStoreCart();
  const key = JSON.stringify({
    lines: lines.map((line) => ({
      id: line.inventoryItemId,
      qty: line.quantity,
      freq: line.autoshipFrequency,
      pets: line.patientIds || [],
    })),
    extras,
  });

  useEffect(() => {
    const trimmed = email?.trim() || '';
    if (!trimmed.includes('@')) return undefined;
    const t = window.setTimeout(() => {
      const current = readStoreCart();
      void publicStoreCartActivity(PRACTICE_ID, {
        email: trimmed,
        clientId,
        customerName: extras?.customerName || null,
        fulfillmentLabel: extras?.fulfillmentLabel || null,
        estimatedTotal: extras?.estimatedTotal ?? null,
        lines: current.map((line) => ({
          name: line.name,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          inventoryItemId: line.inventoryItemId,
          autoshipFrequency: line.autoshipFrequency,
          patientIds: line.patientIds || [],
          patientNames: (line.patientIds || [])
            .map((id) => extras?.patientNamesById?.[id] || '')
            .filter(Boolean),
        })),
      }).catch(() => undefined);
    }, 800);
    return () => window.clearTimeout(t);
  }, [clientId, email, key]);
}
