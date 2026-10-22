import Link from 'next/link';
import { buttonStyles } from '@/components/ui';
import { ArrowLeftIcon, ArrowRightIcon } from '@/components/icons';

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
            className={buttonStyles.secondary}
          >
            <ArrowLeftIcon />
            Anterior
          </Link>
        ) : null}
        {page < totalPages ? (
          <Link
            href={buildHref(page + 1)}
            rel="next"
            className={buttonStyles.secondary}
          >
            Siguiente
            <ArrowRightIcon />
          </Link>
        ) : null}
      </div>
    </nav>
  );
}
