import { notFound } from 'next/navigation';

import { EditorPreview } from '@/components/sheet/EditorPreview';

// Editor da prova estruturada fora do painel (Story 1.45): só em desenvolvimento.
// Em produção a rota não existe.
export default function EditorPreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound();

  return (
    <main className="mx-auto w-full max-w-md px-4 py-6">
      <EditorPreview />
    </main>
  );
}
