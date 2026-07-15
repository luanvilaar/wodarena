import { NextResponse } from 'next/server';
import { buildPublicEventBootstrapPayload } from '@/lib/bootstrapPayload';
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

    return NextResponse.json(payload);
  } catch (err) {
    console.error('[Bootstrap Public Event API] Erro ao carregar dados públicos do evento:', err);
    return NextResponse.json({ error: 'Erro ao carregar dados públicos do evento.' }, { status: 500 });
  }
}
