import { StationListScreen } from '@/components/race/StationListScreen';
import { RACE_FROM_CARDS } from '@/lib/raceStation';

// Fitness Race (Story 1.102, AC4): lista da onda da estação, com busca por nome.
// Vindo de "Adicionar atleta" (?de=cartoes, Story 1.103): volta aos cartões e não lista a estação final.
export default async function StationListPage({
  params,
  searchParams
}: {
  params: Promise<{ eventId: string; stationKey: string }>;
  searchParams: Promise<{ de?: string | string[] }>;
}) {
  const { eventId, stationKey } = await params;
  const { de } = await searchParams;
  return <StationListScreen eventId={decodeURIComponent(eventId)} stationKey={decodeURIComponent(stationKey)} fromCards={de === RACE_FROM_CARDS} />;
}
