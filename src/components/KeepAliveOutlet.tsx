// src/components/KeepAliveOutlet.tsx
import { useLocation, useOutlet } from 'react-router-dom';
import { useRef } from 'react';

type Props = { keepPaths: string[] };

export default function KeepAliveOutlet({ keepPaths }: Props) {
  const location = useLocation();
  const outlet = useOutlet();
  const cacheRef = useRef(new Map<string, React.ReactNode>());

  const path = location.pathname;
  const shouldKeep = keepPaths.some((p) => path === p || path.startsWith(p + '/'));

  // Cache current route element if it's one we want to keep alive
  if (outlet && shouldKeep) {
    cacheRef.current.set(path, outlet);
  }

  return (
    <>
      {[...cacheRef.current.entries()].map(([p, el]) => (
        <div key={p} style={{ display: p === path ? 'block' : 'none' }}>
          {el}
        </div>
      ))}
      {/* If current path isn't in the cache list, just render it normally */}
      {!shouldKeep && outlet}
    </>
  );
}
