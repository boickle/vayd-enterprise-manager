import type { ReactNode } from 'react';

/** Opens eVet in a new tab — same pattern as navbar client/patient search hits. */
export function EvetNameLink({
  href,
  children,
  className,
  title = 'Open in eVet',
}: {
  href: string;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={['evet-name-link', className].filter(Boolean).join(' ')}
      title={title}
    >
      {children}
    </a>
  );
}
