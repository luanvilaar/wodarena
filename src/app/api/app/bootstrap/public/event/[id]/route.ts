import { NextResponse } from 'next/server';
import { buildPublicEventBootstrapPayload } from '@/lib/bootstrapPayload';
import { QUALIFIER_EVENT_TYPE, readQualifierPendingReviews } from '@/lib/serverQualifierPendingReviews';
import { createSupabaseAdmin } from '@/lib/serverSecurity';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const eventId = decodeURIComponent(id);
    const supabaseAdmin = createSupabaseAdmin();
    const payload = await buildPublicEventBootstrapPayload(supabaseAdmin, eventId);

    if (!payload) {
      return NextResponse.json({ error: 'Evento não encontrado.' }, { status: 404 });
    }

    // Qualifier: quem tem envio em análise, para o ranking não tratar como ausente.
    const isQualifier = (payload.events[0] as { event_type?: unknown }).event_type === QUALIFIER_EVENT_TYPE;
    const qualifierPendingReviews = isQualifier ? await readQualifierPendingReviews(supabaseAdmin, [eventId]) : [];

    return NextResponse.json({ ...payload, qualifierPendingReviews });
  } catch (err) {
    console.error('[Bootstrap Public Event API] Erro ao carregar dados públicos do evento:', err);
    return NextResponse.json({ error: 'Erro ao carregar dados públicos do evento.' }, { status: 500 });
  }
}
