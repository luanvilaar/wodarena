import { HeatStartScreen } from '@/components/race/HeatStartScreen';

// Fitness Race (Story 1.96): ondas do evento e largada da onda aberta (?onda=).
export default async function HeatStartPage({
  params,
  searchParams
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<{ onda?: string | string[] }>;
}) {
  const { eventId } = await params;
  const { onda } = await searchParams;
  const heatId = typeof onda === 'string' && onda ? onda : null;
  return <HeatStartScreen eventId={decodeURIComponent(eventId)} heatId={heatId} />;
}
