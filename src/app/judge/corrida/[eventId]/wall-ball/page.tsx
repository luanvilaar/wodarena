import { WallBallListScreen } from '@/components/race/WallBallListScreen';

// Fitness Race (Story 1.97, AC1): lista da onda do árbitro do Wall Ball.
export default async function WallBallListPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  return <WallBallListScreen eventId={decodeURIComponent(eventId)} />;
}
