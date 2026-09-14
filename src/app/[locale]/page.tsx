import { NextIntlClientProvider } from 'next-intl';
import { getScopedMessages } from '@/i18n/getScopedMessages';
import { HomeView } from './HomeView';

export default async function Page() {
  const messages = await getScopedMessages(['Home', 'EventCard', 'SectionOperations', 'FeaturedEventBanner', 'Checkout']);

  return (
    <NextIntlClientProvider messages={messages}>
      <HomeView />
    </NextIntlClientProvider>
  );
}
