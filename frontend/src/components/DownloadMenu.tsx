import { buttonStyles } from '@/components/ui';

export interface DownloadOption {
  href: string;
  label: string;
  hint: string;
}

/**
 * Varias descargas bajo un solo botón. Con `<details>` nativo: funciona sin JS,
 * se abre con Enter/Espacio y no obliga a convertir la página en Client Component.
 */
export function DownloadMenu({ label, options }: { label: string; options: DownloadOption[] }) {
  return (
    <details className="group relative">
      <summary className={`${buttonStyles.secondary} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>
        {label}
        <span aria-hidden="true" className="text-xs transition-transform group-open:rotate-180">
          ▾
        </span>
      </summary>
      <ul className="absolute right-0 z-20 mt-1 w-72 overflow-hidden rounded-md border border-line bg-surface shadow-lg">
        {options.map((option) => (
          <li key={option.href} className="border-b border-line last:border-b-0">
            <a href={option.href} className="block px-3 py-2 text-sm hover:bg-surface-muted focus-visible:bg-surface-muted">
              <span className="font-medium text-ink">{option.label}</span>
              <span className="mt-0.5 block text-xs text-ink-muted">{option.hint}</span>
            </a>
          </li>
        ))}
      </ul>
    </details>
  );
}
