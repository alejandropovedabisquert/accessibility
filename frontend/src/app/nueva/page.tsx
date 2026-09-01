import type { Metadata } from 'next';
import { getMeta } from '@/lib/api';
import { NewAuditForm } from '@/components/NewAuditForm';
import { PageHeader } from '@/components/ui';

export const metadata: Metadata = { title: 'Nueva auditoría' };

export default async function NewAuditPage() {
  const meta = await getMeta();

  return (
    <>
      <PageHeader
        title="Nueva auditoría"
        description="Indica las URLs y el entorno con el que quieres escanearlas."
      />
      <div className="max-w-3xl">
        <NewAuditForm meta={meta} />
      </div>
    </>
  );
}
