import { useCallback, useEffect, useMemo, useState } from 'react';
import { listMessageTemplates } from '../api/messageTemplates';
import {
  listCachedMessageTemplates,
  subscribeMessageTemplates,
} from '../utils/messageTemplateCache';
import type { MessageChannel } from '../utils/messageTemplateFields';
import type { MessageTemplate } from '../utils/messageTemplateTypes';

export function useMessageTemplates(channel?: MessageChannel | 'any') {
  const [rows, setRows] = useState<MessageTemplate[]>(() => listCachedMessageTemplates());
  const [loading, setLoading] = useState(rows.length === 0);

  useEffect(() => {
    const unsub = subscribeMessageTemplates(() => setRows(listCachedMessageTemplates()));
    let cancelled = false;
    void listMessageTemplates()
      .then((list) => {
        if (!cancelled) setRows(list);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  const refresh = useCallback(async () => {
    setRows(await listMessageTemplates());
  }, []);

  const filtered = useMemo(() => {
    if (!channel || channel === 'any') return rows.filter((r) => r.isActive);
    return rows.filter(
      (r) => r.isActive && (r.channel === channel || r.channel === 'both'),
    );
  }, [rows, channel]);

  return { templates: filtered, allTemplates: rows, loading, refresh };
}
