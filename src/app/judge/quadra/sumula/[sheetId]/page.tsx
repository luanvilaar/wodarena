import { CourtSheet } from '@/components/judge/CourtSheet';

// Arbitragem na quadra (Stories 1.50 e 1.51): a súmula de um atleta numa prova.
export default async function CourtSheetPage({ params }: { params: Promise<{ sheetId: string }> }) {
  const { sheetId } = await params;
  return <CourtSheet sheetId={decodeURIComponent(sheetId)} />;
}
