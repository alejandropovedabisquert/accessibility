import Link from 'next/link';
import type { Metadata } from 'next';
import { listSites } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { Card, PageHeader } from '@/components/ui';
import { CreateSiteForm } from '@/components/ReviewForms';

export const metadata: Metadata = { title: 'Sitios' };

export default async function SitesPage() {
  const sites = await listSites();

  return (
    <>
      <PageHeader
        title="Sitios"
        description="Una web con sus hosts. Es lo que se firma, y donde se revisan los criterios que comparan páginas entre sí."
      />

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <section aria-labelledby="h-listado">
          <h2 id="h-listado" className="sr-only">
            Listado
          </h2>
          {sites.length === 0 ? (
            <Card className="px-5 py-8 text-center text-sm text-ink-muted">Todavía no hay ningún sitio.</Card>
          ) : (
            <Card>
              <ul className="divide-y divide-line">
                {sites.map((site) => (
                  <li key={site.id} className="px-5 py-4">
                    <Link href={`/sitios/${site.id}`} className="font-medium text-accent underline-offset-2 hover:underline">
                      {site.name}
                    </Link>
                    <p className="mt-1 text-sm text-ink-muted">
                      {site.origins.join(', ')} · creado el {formatDateTime(site.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </section>

        <section aria-labelledby="h-nuevo">
          <Card className="p-5">
            <h2 id="h-nuevo" className="mb-4 font-semibold">
              Nuevo sitio
            </h2>
            <CreateSiteForm />
          </Card>
        </section>
      </div>
    </>
  );
}
