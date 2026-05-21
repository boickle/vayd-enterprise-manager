/**
 * Google Analytics utility functions
 * 
 * This file provides utilities for tracking page views and custom events
 * with Google Analytics 4 (GA4).
 */

declare global {
  interface Window {
    gtag: (
      command: 'config' | 'event' | 'js' | 'set',
      targetId: string | Date,
      config?: Record<string, any>
    ) => void;
    dataLayer: any[];
  }
}

const gaMeasurementId = import.meta.env.VITE_GA_MEASUREMENT_ID as string | undefined;

/**
 * Create dataLayer + gtag stub immediately so events queue before gtag.js loads.
 * Without this, early events can fire with no params or be dropped entirely.
 */
export const ensureGtagReady = (): void => {
  if (typeof window === 'undefined') return;
  window.dataLayer = window.dataLayer || [];
  if (!window.gtag) {
    window.gtag = function () {
      // eslint-disable-next-line prefer-rest-params
      window.dataLayer.push(arguments);
    };
  }
};

/**
 * GA4 can omit or mishandle undefined/null and boolean custom params in some reports.
 * Send primitives only (string | number).
 */
export const sanitizeGa4EventParams = (
  params?: Record<string, unknown>
): Record<string, string | number> => {
  if (!params) return {};
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'boolean') {
      out[key] = value ? 'true' : 'false';
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      out[key] = value;
    } else if (typeof value === 'string' && value.length > 0) {
      out[key] = value;
    } else {
      out[key] = String(value);
    }
  }
  return out;
};

/**
 * Initialize Google Analytics (call after gtag.js script loads, or immediately after ensureGtagReady).
 */
export const initGA = (measurementId?: string, additionalTagIds: string[] = []): void => {
  if (typeof window === 'undefined') return;
  if (!measurementId && additionalTagIds.length === 0) return;

  ensureGtagReady();
  window.gtag('js', new Date());

  if (measurementId) {
    window.gtag('config', measurementId, {
      send_page_view: false, // We'll handle page views manually for SPA
    });
  }

  additionalTagIds
    .filter((tagId) => tagId && tagId !== measurementId)
    .forEach((tagId) => {
      window.gtag('config', tagId);
    });
};

/**
 * Track a page view
 */
export const trackPageView = (path: string, title?: string): void => {
  if (typeof window === 'undefined') return;
  if (!gaMeasurementId) return;

  ensureGtagReady();
  window.gtag('config', gaMeasurementId, {
    page_path: path,
    page_title: title || document.title,
  });
};

/**
 * Track a custom event
 */
export const trackEvent = (
  eventName: string,
  eventParams?: Record<string, unknown>
): void => {
  if (typeof window === 'undefined') return;

  ensureGtagReady();

  const sanitized = sanitizeGa4EventParams(eventParams);
  const payload: Record<string, string | number> = { ...sanitized };

  // When GA4 + Google Ads tags are both configured, send custom params to GA4 explicitly.
  if (gaMeasurementId) {
    payload.send_to = gaMeasurementId;
  }

  if (Object.keys(payload).length > 0) {
    window.gtag('event', eventName, payload);
  } else {
    window.gtag('event', eventName);
  }
};

/**
 * Track user login
 */
export const trackLogin = (method?: string): void => {
  trackEvent('login', { method });
};

/**
 * Track user logout
 */
export const trackLogout = (): void => {
  trackEvent('logout');
};

/**
 * Track button clicks or other user interactions
 */
export const trackClick = (elementName: string, location?: string): void => {
  trackEvent('click', {
    element_name: elementName,
    location,
  });
};

/**
 * Ecommerce tracking functions for GA4
 * These follow the Enhanced Ecommerce standard
 */

/**
 * Track when a user views an item/product
 */
export const trackViewItem = (
  itemId: string,
  itemName: string,
  price?: number,
  currency?: string,
  additionalParams?: Record<string, any>
): void => {
  const params: Record<string, any> = {
    currency: currency || 'USD',
    value: price,
    items: [
      {
        item_id: itemId,
        item_name: itemName,
        price: price,
        quantity: 1,
      },
    ],
    ...additionalParams,
  };
  trackEvent('view_item', params);
};

/**
 * Track when a user adds an item to cart
 */
export const trackAddToCart = (
  itemId: string,
  itemName: string,
  price?: number,
  currency?: string,
  quantity?: number,
  additionalParams?: Record<string, any>
): void => {
  const params: Record<string, any> = {
    currency: currency || 'USD',
    value: price ? (price * (quantity || 1)) : undefined,
    items: [
      {
        item_id: itemId,
        item_name: itemName,
        price: price,
        quantity: quantity || 1,
      },
    ],
    ...additionalParams,
  };
  trackEvent('add_to_cart', params);
};

/**
 * Track when a user begins checkout
 */
export const trackBeginCheckout = (
  value: number,
  currency?: string,
  items?: Array<{
    item_id: string;
    item_name: string;
    price?: number;
    quantity?: number;
  }>,
  additionalParams?: Record<string, any>
): void => {
  const params: Record<string, any> = {
    currency: currency || 'USD',
    value,
    items: items || [],
    ...additionalParams,
  };
  trackEvent('begin_checkout', params);
};

/**
 * Track when a purchase is completed
 */
export const trackPurchase = (
  transactionId: string,
  value: number,
  currency?: string,
  items?: Array<{
    item_id: string;
    item_name: string;
    price?: number;
    quantity?: number;
  }>,
  additionalParams?: Record<string, any>
): void => {
  const params: Record<string, any> = {
    transaction_id: transactionId,
    currency: currency || 'USD',
    value,
    items: items || [],
    ...additionalParams,
  };
  trackEvent('purchase', params);
};
