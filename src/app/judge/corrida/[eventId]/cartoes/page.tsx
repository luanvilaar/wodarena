import { TwoCardsScreen } from '@/components/race/TwoCardsScreen';

// Fitness Race (Story 1.103, AC7): tela de dois cartões do judge, com o cartão em foco (?foco=).
export default async function TwoCardsPage({
  params,
  searchParams
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ foco?: string | string[] }>;
}) {
  const { eventId } = await params;
  const { foco } = await searchParams;
  return <TwoCardsScreen eventId={decodeURIComponent(eventId)} focusId={typeof foco === 'string' && foco ? foco : null} />;
}
