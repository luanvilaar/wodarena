import { RaceEventHubScreen } from '@/components/race/RaceEventHubScreen';

// Fitness Race: atalhos da arbitragem do evento (Wall Ball e estações). A largada
// das ondas é do organizador, no painel do evento (Story 1.110).
export default async function RaceEventHubPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  return <RaceEventHubScreen eventId={decodeURIComponent(eventId)} />;
}
