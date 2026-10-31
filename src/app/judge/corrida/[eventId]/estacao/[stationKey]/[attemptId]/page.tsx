import { StationAttemptScreen } from '@/components/race/StationAttemptScreen';

// Fitness Race (Story 1.102, AC4 a AC12): cartão da estação em tela cheia; na estação final, a tela de 1 atleta (D39).
export default async function StationAttemptPage({ params }: { params: Promise<{ eventId: string; stationKey: string; attemptId: string }> }) {
  const { eventId, stationKey, attemptId } = await params;
  return <StationAttemptScreen eventId={decodeURIComponent(eventId)} stationKey={decodeURIComponent(stationKey)} attemptId={decodeURIComponent(attemptId)} />;
}
