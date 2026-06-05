import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const paymentId = searchParams.get('payment_id');
    const eventId = searchParams.get('event_id');

    if (!paymentId) {
      return NextResponse.json({ error: 'Parâmetro payment_id obrigatório.' }, { status: 400 });
    }

    let accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
    if (eventId) {
      try {
        const { data: dbEvent } = await supabase
          .from('events')
          .select('mp_access_token')
          .eq('id', eventId)
          .single();
        if (dbEvent?.mp_access_token) {
          accessToken = dbEvent.mp_access_token;
          console.log(`[MercadoPago Status API] Usando Access Token customizado para o evento ${eventId}`);
        }
      } catch (err) {
        console.warn("[MercadoPago Status API] Erro ao carregar credenciais customizadas:", err);
      }
    }
    if (!accessToken) {
      console.error("[MercadoPago Status API] ACCESS_TOKEN não configurado no .env");
      return NextResponse.json({ error: 'Configuração do gateway pendente.' }, { status: 500 });
    }

    console.log(`[MercadoPago Status API] Buscando status do pagamento: ${paymentId}`);
    const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    if (!response.ok) {
      console.error(`[MercadoPago Status API] Erro ao buscar pagamento ${paymentId} no Mercado Pago.`);
      return NextResponse.json({ error: 'Erro ao buscar status do pagamento.' }, { status: 500 });
    }

    const paymentData = await response.json();
    return NextResponse.json({
      status: paymentData.status
    });

  } catch (err) {
    console.error("[MercadoPago Status API] Erro interno na consulta de status:", err);
    return NextResponse.json({ error: 'Erro interno ao consultar status do pagamento.' }, { status: 500 });
  }
}
