import { NextIntlClientProvider } from 'next-intl';
import { getScopedMessages } from '@/i18n/getScopedMessages';
import { EventView } from './EventView';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function Page({ params }: PageProps) {
  const { id } = await params;
  const messages = await getScopedMessages(['Event', 'Checkout']);

  return (
    <NextIntlClientProvider messages={messages}>
      <EventView eventId={id} />
    </NextIntlClientProvider>
  );
}
