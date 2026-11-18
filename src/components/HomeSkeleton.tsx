export function HomeSkeleton() {
  return (
    <div className="screen screen--home home-skeleton" role="status" aria-label="Loading Home">
      <span className="visually-hidden">Loading your household summary</span>
      <header className="home-skeleton-header"><span className="skeleton-line skeleton-title" /><span className="skeleton-line skeleton-meta" /></header>
      <section className="skeleton-card skeleton-balance" aria-hidden="true">
        <span className="skeleton-line skeleton-label" />
        <span className="skeleton-line skeleton-amount" />
        <div><span className="skeleton-line" /><span className="skeleton-line" /></div>
      </section>
      <section className="home-skeleton-section" aria-hidden="true">
        <span className="skeleton-line skeleton-heading" />
        <div className="skeleton-list">{Array.from({ length: 4 }, (_, index) => <div className="skeleton-row" key={index}><span className="skeleton-avatar" /><span className="skeleton-row-copy"><span className="skeleton-line" /><span className="skeleton-line" /></span><span className="skeleton-line skeleton-value" /></div>)}</div>
      </section>
      <section className="home-skeleton-section" aria-hidden="true">
        <span className="skeleton-line skeleton-heading short" />
        <div className="skeleton-card skeleton-history"><span className="skeleton-line" /><span className="skeleton-line" /></div>
      </section>
    </div>
  );
}
