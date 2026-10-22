import type { Metadata } from 'next';
import Link from 'next/link';
import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';
import { NavLinks } from '@/components/NavLinks';
import './globals.css';

// Todo el contenido depende de la API en tiempo de peticion: no hay nada
// que prerenderizar en build.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: { default: 'Auditorías de accesibilidad', template: '%s · Accesibilidad' },
  description: 'Escaneo automático de accesibilidad web con Playwright y axe-core',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-dvh">
        <a
          href="#contenido"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-accent focus:px-4 focus:py-2 focus:text-on-accent"
        >
          Saltar al contenido
        </a>

        <header className="sticky top-0 z-30 border-b border-line bg-surface/85 backdrop-blur-md">
          <div aria-hidden="true" className="h-0.5 bg-linear-to-r from-accent via-accent-alt to-accent" />
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 px-4">
            <Link href="/" className="group flex items-center gap-2 py-3 text-sm font-semibold tracking-tight">
              <span
                aria-hidden="true"
                className="grid size-7 place-items-center rounded-md bg-linear-to-br from-accent to-accent-alt text-on-accent shadow-raised transition-transform duration-200 group-hover:rotate-6"
              >
                <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="4.5" r="1.8" fill="currentColor" stroke="none" />
                  <path d="M5 8.5l7 1.5 7-1.5M12 10v4.5M12 14.5l-3.5 6M12 14.5l3.5 6" />
                </svg>
              </span>
              Accesibilidad
            </Link>
            <span aria-hidden="true" className="hidden h-5 w-px bg-line sm:block" />
            <nav aria-label="Principal" className="-mx-3 sm:mx-0">
              <NavLinks />
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
