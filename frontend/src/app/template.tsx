/**
 * A diferencia del layout, la plantilla se vuelve a montar en cada navegación:
 * es lo que permite que cada página entre con su animación. No es un límite de
 * Suspense (eso lo haría `loading.tsx`), así que no afecta a los 404.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="animate-fade-up">{children}</div>;
}
