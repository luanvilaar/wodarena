import { NextResponse } from 'next/server';
import { buildOwnerOverview, normalizeOwnerPeriod } from '@/lib/ownerOverview';
import { readOwnerOverviewSource } from '@/lib/serverOwnerOverview';
import { createSupabaseAdmin, requireSession } from '@/lib/serverSecurity';

// Números do painel do proprietário (Story 1.122, decisão D3): só leitura, só
// owner, somados no servidor com leitura paginada e as regras de managerFinance.ts.
export async function GET(request: Request) {
  const auth = requireSession(request, ['owner']);
  if (auth.response) return auth.response;

  const period = normalizeOwnerPeriod(new URL(request.url).searchParams.get('period'));

  try {
    const startedAt = Date.now();
    const source = await readOwnerOverviewSource(createSupabaseAdmin());
    const payload = buildOwnerOverview(source, { period });
    console.info('[Owner Overview] Concluída:', JSON.stringify({
      period,
      durationMs: Date.now() - startedAt,
      events: source.events.length,
      registrations: source.registrations.length,
      users: source.users.length
    }));
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[Owner Overview] Falha ao montar o painel:', error);
    return NextResponse.json({ error: 'Não foi possível carregar os números do painel.' }, { status: 500 });
  }
}
