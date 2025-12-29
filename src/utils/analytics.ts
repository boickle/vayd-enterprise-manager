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

/**
 * Initialize Google Analytics
 * This should be called once when the app loads
 */
export const initGA = (measurementId: string): void => {
  if (typeof window === 'undefined') return;

  // Initialize dataLayer
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () {
    window.dataLayer.push(arguments);
  };
  window.gtag('js', new Date());
  window.gtag('config', measurementId, {
    send_page_view: false, // We'll handle page views manually for SPA
  });
};

/**
 * Track a page view
 */
export const trackPageView = (path: string, title?: string): void => {
  if (typeof window === 'undefined' || !window.gtag) return;

  window.gtag('config', import.meta.env.VITE_GA_MEASUREMENT_ID, {
    page_path: path,
    page_title: title || document.title,
  });
};

/**
 * Track a custom event
 */
export const trackEvent = (
  eventName: string,
  eventParams?: Record<string, any>
): void => {
  if (typeof window === 'undefined' || !window.gtag) return;

  window.gtag('event', eventName, eventParams);
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

