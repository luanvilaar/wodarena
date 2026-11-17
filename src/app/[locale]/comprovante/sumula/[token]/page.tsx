import type { Metadata } from 'next';

import { SheetReceiptView } from '@/components/SheetReceiptView';
import { createSupabaseAdmin } from '@/lib/serverSecurity';
import { readSheetReceiptByToken } from '@/lib/serverSheetReceipt';
import type { SheetReceipt } from '@/lib/sheetReceipt';

// Comprovante de envio da súmula digital (Story 1.145; plano aprovado em
// docs/design/comprovante-sumula/). Aberto pelo link assinado, sem login (D5):
// fora dos buscadores e sem referer, como o telão. Lido a cada visita, porque
// mostra o estado atual da súmula. Link inválido não diz o motivo.

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Comprovante da súmula | WODArena',
  robots: { index: false, follow: false },
  referrer: 'no-referrer'
};

interface PageProps {
  params: Promise<{ token: string }>;
}

// "%" malformado no link não derruba a página: segue como veio e não confere.
const decodeToken = (token: string) => {
  try {
    return decodeURIComponent(token);
  } catch {
    return token;
  }
};

export default async function Page({ params }: PageProps) {
  const { token } = await params;
  let receipt: SheetReceipt | null = null;
  let failed = false;
  try {
    receipt = await readSheetReceiptByToken(createSupabaseAdmin(), decodeToken(token));
  } catch (error) {
    console.error('Erro ao abrir o comprovante da súmula:', error);
    failed = true;
  }

  return (
    <main className="mx-auto w-full max-w-[460px] px-4 py-6 sm:py-10">
      {receipt ? (
        <SheetReceiptView receipt={receipt} />
      ) : (
        <section className="space-y-2 rounded-xl border border-card-border bg-card p-6 text-center text-white">
          <h1 className="text-lg font-bold">{failed ? 'Não foi possível abrir o comprovante agora' : 'Comprovante não encontrado'}</h1>
          <p className="text-sm text-muted">
            {failed ? 'Tente de novo em alguns instantes.' : 'Confira se o link está completo. O comprovante também fica na Área do Atleta, no cartão da inscrição.'}
          </p>
        </section>
      )}
    </main>
  );
}
