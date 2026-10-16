import { CourtBoard } from '@/components/judge/CourtBoard';

// Arbitragem na quadra (Story 1.49): provas, baterias e raias do evento.
export default async function CourtBoardPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  return <CourtBoard eventId={decodeURIComponent(eventId)} />;
}
