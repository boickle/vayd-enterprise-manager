import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles.css';
import { AuthProvider } from './auth/AuthProvider';
import { ErrorBoundary } from './components/ErrorBoundary';
import { initGA } from './utils/analytics';

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
  
  // Prevent zoom on double tap (iOS)
  let lastTouchEnd = 0;
  document.addEventListener('touchend', (event) => {
    const now = Date.now();
    if (now - lastTouchEnd <= 300) {
      event.preventDefault();
    }
    lastTouchEnd = now;
  }, false);

  // Initialize Google tags (GA + Google Ads)
  const gaMeasurementId = import.meta.env.VITE_GA_MEASUREMENT_ID;
  const googleAdsTagId = import.meta.env.VITE_GOOGLE_ADS_TAG_ID;
  const initialTagId = gaMeasurementId || googleAdsTagId;

  if (initialTagId) {
    // Load gtag script once
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${initialTagId}`;
    document.head.appendChild(script);

    // Initialize tags after script loads
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
          <App />
        </ErrorBoundary>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
