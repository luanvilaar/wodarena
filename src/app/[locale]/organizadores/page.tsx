import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getScopedMessages } from '@/i18n/getScopedMessages';
import { OrganizersView } from './OrganizersView';

// Página para organizadores (Story 1.132, P2 de docs/design/mobile-competitivo/):
// o hero institucional e o formulário comercial saíram da home para cá.
export const metadata: Metadata = {
  title: 'Organize seu evento | WODArena',
  description: 'Inscrições, súmula digital do judge, ranking oficial e telão ao vivo para eventos de Functional Fitness e Fitness Race.'
};

export default async function Page() {
  const messages = await getScopedMessages(['Home', 'SectionOperations', 'Organizers']);

  return (
    <NextIntlClientProvider messages={messages}>
      <OrganizersView />
    </NextIntlClientProvider>
  );
}
