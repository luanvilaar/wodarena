import { NextResponse } from 'next/server';
import {
  MercadoPagoConfigError,
  resolveMercadoPagoPublicConfig
} from '@/lib/mercadopagoServer';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const eventId = searchParams.get('event_id');

    if (!eventId) {
      return NextResponse.json({ error: 'Parâmetro event_id obrigatório.' }, { status: 400 });
    }

    const checkoutConfig = await resolveMercadoPagoPublicConfig(eventId);
    console.log(`[MercadoPago Config API] Public Key ${checkoutConfig.source} carregada para o organizador ${checkoutConfig.organizerId} no evento ${eventId}`);

    return NextResponse.json({
      publicKey: checkoutConfig.publicKey
    });
  } catch (err) {
    if (err instanceof MercadoPagoConfigError) {
      console.error('[MercadoPago Config API] Erro de configuração:', err.message);
      return NextResponse.json({ error: err.message }, { status: err.status });
    }

    console.error('[MercadoPago Config API] Erro interno:', err);
    return NextResponse.json({ error: 'Erro interno ao carregar checkout.' }, { status: 500 });
  }
}
