import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

// Todo el contenido depende de la API en tiempo de peticion: no hay nada
// que prerenderizar en build.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: { default: 'Auditorías de accesibilidad', template: '%s · Accesibilidad' },
  description: 'Escaneo automático de accesibilidad web con Playwright y axe-core',
};

const NAV = [
  { href: '/', label: 'Auditorías' },
  { href: '/nueva', label: 'Nueva auditoría' },
  { href: '/historico', label: 'Histórico' },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-dvh">
        <a
          href="#contenido"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-accent focus:px-4 focus:py-2 focus:text-on-accent"
        >
          Saltar al contenido
        </a>

        <header className="border-b border-line bg-surface">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-8 gap-y-3 px-4 py-3">
            <Link href="/" className="text-sm font-semibold tracking-tight">
              Accesibilidad
            </Link>
            <nav aria-label="Principal">
              <ul className="flex gap-1">
                {NAV.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="rounded-md px-3 py-1.5 text-sm text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink"
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        </header>

        <main id="contenido" className="mx-auto max-w-6xl px-4 py-8">
          {children}
        </main>
      </body>
    </html>
  );
}
