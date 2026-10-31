import { WallBallAttemptScreen } from '@/components/race/WallBallAttemptScreen';

// Fitness Race (Story 1.97, AC2 a AC17): tela de contagem do Wall Ball da tentativa aberta por open_attempt.
export default async function WallBallAttemptPage({ params }: { params: Promise<{ eventId: string; attemptId: string }> }) {
  const { eventId, attemptId } = await params;
  return <WallBallAttemptScreen eventId={decodeURIComponent(eventId)} attemptId={decodeURIComponent(attemptId)} />;
}
