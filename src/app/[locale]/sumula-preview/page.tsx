import { notFound } from 'next/navigation';

import { SheetPreview } from '@/components/sheet/SheetPreview';

// Pré-visualização da súmula do judge (Story 1.44): só em desenvolvimento.
// Em produção a rota não existe.
export default function SheetPreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound();

  return (
    <main className="mx-auto w-full max-w-md px-4 py-6">
      <SheetPreview />
    </main>
  );
}
