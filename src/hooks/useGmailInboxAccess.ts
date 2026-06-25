import { useEffect, useState } from 'react';
import { useAuth } from '../auth/useAuth';
import { fetchGmailAccess } from '../api/gmail';
import { isGmailFeatureEmployee } from '../utils/gmailAccess';
import { normalizeAuthRoles } from '../utils/analyticsAccess';

export function useGmailInboxAccess(): { allowed: boolean; loading: boolean } {
  const { role } = useAuth() as { role?: string | string[] };
  const roles = normalizeAuthRoles(role);
  const syncAllowed = isGmailFeatureEmployee(roles);

  const [allowed, setAllowed] = useState(syncAllowed);
  const [loading, setLoading] = useState(!syncAllowed);

  useEffect(() => {
    if (!syncAllowed) {
      setAllowed(false);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    fetchGmailAccess()
      .then((ok) => {
        if (!cancelled) {
          setAllowed(ok);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAllowed(false);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [syncAllowed]);

  return { allowed, loading };
}
