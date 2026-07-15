import { NextResponse } from 'next/server';
import { buildPublicBootstrapPayload } from '@/lib/bootstrapPayload';
import { createSupabaseAdmin } from '@/lib/serverSecurity';

export async function GET() {
  const startedAt = Date.now();

  try {
    const supabaseAdmin = createSupabaseAdmin();
    const payload = await buildPublicBootstrapPayload(supabaseAdmin);
    console.info('[Bootstrap Public API] Concluído:', JSON.stringify({
      durationMs: Date.now() - startedAt,
      counts: {
        events: payload.events.length,
        divisions: payload.divisions.length,
        workouts: payload.workouts.length
      }
    }));
    return NextResponse.json(payload);
  } catch (err) {
    console.error('[Bootstrap Public API] Erro ao carregar dados publicos iniciais:', JSON.stringify({
      durationMs: Date.now() - startedAt,
      message: err instanceof Error ? err.message : 'erro desconhecido'
    }));
    return NextResponse.json({ error: 'Erro ao carregar dados publicos iniciais.' }, { status: 500 });
  }
}
