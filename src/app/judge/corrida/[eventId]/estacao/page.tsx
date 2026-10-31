import { StationPickerScreen } from '@/components/race/StationListScreen';
import { RACE_FROM_CARDS } from '@/lib/raceStation';

// Fitness Race (Story 1.102, AC3 e AC4): o judge escolhe a estação onde está (D3).
// Vindo de "Outra estação" na tela de dois cartões (?de=cartoes, Story 1.103): sem as estações de 1 atleta.
export default async function StationPickerPage({ params, searchParams }: { params: Promise<{ eventId: string }>; searchParams: Promise<{ de?: string | string[] }> }) {
  const { eventId } = await params;
  const { de } = await searchParams;
  return <StationPickerScreen eventId={decodeURIComponent(eventId)} fromCards={de === RACE_FROM_CARDS} />;
}
