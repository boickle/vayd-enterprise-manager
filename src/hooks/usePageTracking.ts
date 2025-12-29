import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { trackPageView } from '../utils/analytics';

/**
 * Hook to automatically track page views when the route changes
 * 
 * Usage: Add this hook to your App component or root component
 */
export const usePageTracking = (): void => {
  const location = useLocation();

  useEffect(() => {
    // Only track if GA is initialized
    if (typeof window !== 'undefined' && typeof window.gtag === 'function') {
      trackPageView(location.pathname + location.search);
    }
  }, [location]);
};

