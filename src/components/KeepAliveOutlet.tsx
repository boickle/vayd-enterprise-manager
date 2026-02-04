// src/components/KeepAliveOutlet.tsx
import { useLocation, useOutlet } from 'react-router-dom';
import { useRef } from 'react';

type Props = { keepPaths: string[] };

/** Cache by base path so sub-routes (e.g. admin tabs) share one parent instance and tab switching works on first load. */
export default function KeepAliveOutlet({ keepPaths }: Props) {
  const location = useLocation();
  const outlet = useOutlet();
  const cacheRef = useRef(new Map<string, React.ReactNode>());

  const path = location.pathname;
  const matchingKeepPath = keepPaths.find((p) => path === p || path.startsWith(p + '/'));
  const shouldKeep = matchingKeepPath !== undefined;

  if (outlet && matchingKeepPath !== undefined) {
    cacheRef.current.set(matchingKeepPath, outlet);
  }

  return (
    <>
      {[...cacheRef.current.entries()].map(([basePath, el]) => (
        <div
          key={basePath}
          style={{ display: path === basePath || path.startsWith(basePath + '/') ? 'block' : 'none' }}
        >
          {el}
        </div>
      ))}
      {!shouldKeep && outlet}
    </>
  );
}
