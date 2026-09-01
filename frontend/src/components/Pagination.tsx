import Link from 'next/link';

export function Pagination({
  page,
  totalPages,
  total,
  buildHref,
}: {
  page: number;
  totalPages: number;
  total: number;
  buildHref: (page: number) => string;
}) {
  if (totalPages <= 1) {
    return <p className="mt-4 text-sm text-ink-muted">{total} auditoría(s)</p>;
  }

  return (
    <nav aria-label="Paginación" className="mt-4 flex items-center justify-between gap-4">
      <p className="text-sm text-ink-muted">
        Página {page} de {totalPages} · {total} auditorías
      </p>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link
            href={buildHref(page - 1)}
            rel="prev"
            className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm hover:bg-surface-muted"
          >
            ← Anterior
          </Link>
        ) : null}
        {page < totalPages ? (
          <Link
            href={buildHref(page + 1)}
            rel="next"
            className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm hover:bg-surface-muted"
          >
            Siguiente →
          </Link>
        ) : null}
      </div>
    </nav>
  );
}
