import { NextIntlClientProvider } from 'next-intl';
import { getScopedMessages } from '@/i18n/getScopedMessages';
import { LeaderboardView } from './LeaderboardView';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function Page({ params }: PageProps) {
  const { id } = await params;
  const messages = await getScopedMessages(['LeaderboardPage', 'Leaderboard']);

  return (
    <NextIntlClientProvider messages={messages}>
      <LeaderboardView eventId={id} />
    </NextIntlClientProvider>
  );
}
