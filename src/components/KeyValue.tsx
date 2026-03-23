import type { ReactNode } from 'react';

export function KeyValue({
  k,
  v,
  color,
}: {
  k: string;
  v: string | number | ReactNode | undefined;
  color?: string;
}) {
  return (
    <div className="kv">
      <div className="kv-k">{k}</div>
      <div className="kv-v" style={{ color }}>
        {v}
      </div>
    </div>
  );
}
