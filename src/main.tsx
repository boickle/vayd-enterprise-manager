import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import App from './App';
import './styles.css';
import { AuthProvider } from './auth/AuthProvider';
import { ErrorBoundary } from './components/ErrorBoundary';
import AppDialogProvider from './components/AppDialogProvider';
import { ensureGtagReady, initGA } from './utils/analytics';
import { initGtm } from './utils/gtm';
import { captureMarketingAttribution } from './utils/marketingAttribution';
import { loadHostPractice } from './api/practices';

// Prevent iOS Safari address bar from showing on scroll
if (typeof window !== 'undefined') {
  // Set initial viewport height
  const setViewportHeight = () => {
    const vh = window.innerHeight * 0.01;
    document.documentElement.style.setProperty('--vh', `${vh}px`);
  };
  
  setViewportHeight();
  window.addEventListener('resize', setViewportHeight);
  window.addEventListener('orientationchange', setViewportHeight);
  
  // iOS Safari pans the (position: fixed) page to reveal a focused field and does not pan
  // back once the keyboard closes — the header slides under the status bar and fixed
  // popovers hang off the left edge. Snap back as soon as nothing is being typed into.
  const isTypingTarget = (el: Element | null) =>
    el instanceof HTMLElement &&
    el.matches('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
  const resetPannedViewport = () => {
    if (isTypingTarget(document.activeElement)) return;
    const vv = window.visualViewport;
    const panned =
      window.scrollX !== 0 ||
      window.scrollY !== 0 ||
      document.documentElement.scrollLeft !== 0 ||
      document.documentElement.scrollTop !== 0 ||
      (vv != null && (vv.offsetLeft !== 0 || vv.offsetTop !== 0) && vv.scale === 1);
    if (!panned) return;
    window.scrollTo(0, 0);
    document.documentElement.scrollLeft = 0;
    document.documentElement.scrollTop = 0;
  };
  let resetTimer: number | null = null;
  const scheduleViewportReset = () => {
    if (resetTimer != null) window.clearTimeout(resetTimer);
    resetTimer = window.setTimeout(() => {
      resetTimer = null;
      resetPannedViewport();
    }, 60);
  };
  document.addEventListener('focusout', scheduleViewportReset);
  window.addEventListener('scroll', scheduleViewportReset, { passive: true });
  window.visualViewport?.addEventListener('resize', scheduleViewportReset);
  window.visualViewport?.addEventListener('scroll', scheduleViewportReset);

  // Prevent zoom on double tap (iOS)
  let lastTouchEnd = 0;
  document.addEventListener('touchend', (event) => {
    const now = Date.now();
    if (now - lastTouchEnd <= 300) {
      event.preventDefault();
    }
    lastTouchEnd = now;
  }, false);

  loadHostPractice().catch(() => {});

  // Capture ad click IDs before SPA navigation can drop the query string.
  captureMarketingAttribution();
  initGtm();

  // Initialize Google tags (GA + Google Ads)
  const gaMeasurementId = import.meta.env.VITE_GA_MEASUREMENT_ID;
  const googleAdsTagId = import.meta.env.VITE_GOOGLE_ADS_TAG_ID;
  const initialTagId = gaMeasurementId || googleAdsTagId;

  if (initialTagId) {
    // Stub + config immediately so early events (e.g. appointment form) keep parameters.
    ensureGtagReady();
    initGA(gaMeasurementId, googleAdsTagId ? [googleAdsTagId] : []);

    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${initialTagId}`;
    document.head.appendChild(script);

    script.onload = () => {
      initGA(gaMeasurementId, googleAdsTagId ? [googleAdsTagId] : []);
    };
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ErrorBoundary>
          <AppDialogProvider>
            <App />
          </AppDialogProvider>
        </ErrorBoundary>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
