export function ProviderCardSkeleton() {
  return (
    <div className="pcard" style={{ padding: 16, minHeight: 120 }}>
      <div style={{ height: 16, width: '60%', background: 'var(--border)', borderRadius: 4, marginBottom: 10, animation: 'pulse-skeleton 1.4s ease-in-out infinite' }} />
      <div style={{ height: 12, width: '40%', background: 'var(--border)', borderRadius: 4 }} />
    </div>
  );
}
