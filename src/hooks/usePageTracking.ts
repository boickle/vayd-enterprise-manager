import { useEffect } from 'react';
import { useLocation } from 'react-router';
import { trackPageView } from '../utils/analytics';
import { appSurfaceFromPath } from '../utils/appSurface';
import { pushAppSurface } from '../utils/gtm';
import { captureMarketingAttribution } from '../utils/marketingAttribution';

/**
 * Hook to automatically track page views when the route changes
 * 
 * Usage: Add this hook to your App component or root component
 */
export const usePageTracking = (): void => {
  const location = useLocation();

  useEffect(() => {
    captureMarketingAttribution(location.search);
    pushAppSurface(location.pathname, appSurfaceFromPath(location.pathname));

    // Only track if GA is initialized
    if (typeof window !== 'undefined' && typeof window.gtag === 'function') {
      trackPageView(location.pathname + location.search);
    }
  }, [location]);
};

