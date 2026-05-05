/** Placeholder routes under PIMS until real modules exist. */
export default function PimsPlaceholder({ title }: { title: string }) {
  return (
    <div style={{ padding: '28px 32px', maxWidth: 720 }}>
      <h1 style={{ fontSize: 22, fontWeight: 600, margin: '0 0 12px', color: '#1a1a1a' }}>{title}</h1>
      <p style={{ margin: 0, color: '#64748b', fontSize: 15 }}>This section is coming soon.</p>
    </div>
  );
}
