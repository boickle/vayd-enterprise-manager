import { useCallback, useEffect, useState } from 'react';
import {
  listRecentRecords,
  pushRecentRecord,
  subscribeRecentRecords,
  type RecentRecord,
} from '../utils/recentRecordsStore';

export function useRecentRecords(): {
  recents: RecentRecord[];
  remember: typeof pushRecentRecord;
} {
  const [recents, setRecents] = useState<RecentRecord[]>(() =>
    typeof window === 'undefined' ? [] : listRecentRecords(),
  );

  useEffect(() => {
    const sync = () => setRecents(listRecentRecords());
    sync();
    return subscribeRecentRecords(sync);
  }, []);

  const remember = useCallback((entry: Parameters<typeof pushRecentRecord>[0]) => {
    pushRecentRecord(entry);
  }, []);

  return { recents, remember };
}
