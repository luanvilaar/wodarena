import { NextResponse } from 'next/server';
import { assertRegistrationAccess, RegistrationAccessError } from '@/lib/serverCheckout';
import { loadRegistrationConfirmation } from '@/lib/serverRegistrationConfirmation';
import { checkRateLimit, createSupabaseAdmin, getClientIp } from '@/lib/serverSecurity';
import { buildPosterModel, isPosterEligible, type PosterFormat } from '@/lib/registrationPoster';
import { renderRegistrationPoster } from '@/lib/registrationPosterImage';

export const runtime = 'nodejs';

const supabaseAdmin = createSupabaseAdmin();

// Frente do comprovante (Story 1.75): PNG gerado com a inscrição gravada. Acesso por
// sessão (atleta dono, gestor do evento, owner) ou pelo token da inscrição, como o
// restante do checkout. Só inscrição com pagamento aprovado tem frente.
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { searchParams } = new URL(request.url);
    const format: PosterFormat = searchParams.get('format') === 'email' ? 'email' : 'story';

    const rateLimited = checkRateLimit({
      key: `registration-poster:${getClientIp(request)}:${id}`,
      limit: 30,
      windowMs: 60 * 60 * 1000
    });
    if (rateLimited) return rateLimited;

    await assertRegistrationAccess(supabaseAdmin, request, {
      registrationId: id,
      accessToken: searchParams.get('access_token')
    });

    const loaded = await loadRegistrationConfirmation(supabaseAdmin, id);
    if (!loaded.ok) {
      return NextResponse.json({ error: loaded.error }, { status: loaded.status });
    }
    if (!isPosterEligible(loaded.registration)) {
      return NextResponse.json({ error: 'A imagem fica disponível após a confirmação do pagamento.' }, { status: 403 });
    }

    const model = buildPosterModel({
      registration: loaded.registration,
      athlete: loaded.athlete,
      event: loaded.event
    });
    const image = await renderRegistrationPoster(model, format, loaded.event.logoUrl);

    return new Response(await image.arrayBuffer(), {
      headers: {
        'Content-Type': 'image/png',
        // Dados pessoais do atleta: nunca em cache compartilhado.
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff'
      }
    });
  } catch (err) {
    if (err instanceof RegistrationAccessError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[Registration Poster API] Erro ao gerar a imagem:', err);
    return NextResponse.json({ error: 'Erro ao gerar a imagem da inscrição.' }, { status: 500 });
  }
}
