import Link from 'next/link';
import { buttonStyles } from '@/components/ui';

export default function NotFound() {
  return (
    <div className="rounded-lg border border-line bg-surface px-6 py-14 text-center">
      <h1 className="text-lg font-semibold">Página no encontrada</h1>
      <p className="mt-2 text-sm text-ink-muted">El recurso que buscas no existe o se ha borrado.</p>
      <Link href="/" className={`${buttonStyles.primary} mt-5`}>
        Volver al listado
      </Link>
    </div>
  );
}
