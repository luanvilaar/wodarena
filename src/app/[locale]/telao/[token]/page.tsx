import type { Metadata } from 'next';

import { BroadcastScreen } from '@/components/broadcast/BroadcastScreen';

// Telão ao vivo (Story 1.57): aberto na TV do evento pelo link secreto que o
// gestor gera na aba "Telão" do painel. Fora dos buscadores e sem referer.

export const metadata: Metadata = {
  title: 'Telão ao vivo | WODArena',
  robots: { index: false, follow: false },
  referrer: 'no-referrer'
};

interface PageProps {
  params: Promise<{ token: string }>;
}

// "%" malformado no link não derruba a página: segue como veio, e a API responde
// "link desativado" (o formato do token não aceita "%").
const decodeToken = (token: string) => {
  try {
    return decodeURIComponent(token);
  } catch {
    return token;
  }
};

export default async function Page({ params }: PageProps) {
  const { token } = await params;
  return <BroadcastScreen token={decodeToken(token)} />;
}
