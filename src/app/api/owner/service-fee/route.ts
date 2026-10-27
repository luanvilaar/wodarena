import { NextResponse } from 'next/server';
import { createSupabaseAdmin, requireSession } from '@/lib/serverSecurity';
import { DEFAULT_SERVICE_FEE_PERCENT, normalizeServiceFeePayer, normalizeServiceFeePercent, type ServiceFeePayer } from '@/lib/serviceFee';

export async function GET(request: Request) {
  const auth = requireSession(request, ['owner']);
  if (auth.response) return auth.response;

  const supabaseAdmin = createSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from('platform_settings')
    .select('service_fee_enabled, service_fee_percent')
    .eq('id', true)
    .maybeSingle();

  if (error) {
    console.error('[Owner Service Fee] Falha ao carregar configuração:', error);
    return NextResponse.json({ error: 'Não foi possível carregar a taxa de serviço.' }, { status: 500 });
  }

  // Só leitura: quem paga a taxa em cada gestor que já escolheu (Story 1.85). Gestor
  // ausente do mapa ainda não escolheu e segue o padrão de cada gateway.
  const { data: payerRows, error: payerError } = await supabaseAdmin
    .from('manager_payment_settings')
    .select('user_id, service_fee_payer');

  if (payerError) {
    console.error('[Owner Service Fee] Falha ao carregar quem paga a taxa:', payerError);
    return NextResponse.json({ error: 'Não foi possível carregar a taxa de serviço.' }, { status: 500 });
  }

  const payers: Record<string, ServiceFeePayer> = {};
  for (const row of payerRows || []) {
    const payer = normalizeServiceFeePayer(row.service_fee_payer);
    if (payer) payers[String(row.user_id)] = payer;
  }

  return NextResponse.json({
    enabled: data?.service_fee_enabled !== false,
    percent: normalizeServiceFeePercent(data?.service_fee_percent, DEFAULT_SERVICE_FEE_PERCENT),
    payers
  });
}

export async function PUT(request: Request) {
  const auth = requireSession(request, ['owner']);
  if (auth.response) return auth.response;

  try {
    const { enabled } = await request.json();
    if (typeof enabled !== 'boolean') {
      return NextResponse.json({ error: 'O campo enabled deve ser booleano.' }, { status: 400 });
    }

    const supabaseAdmin = createSupabaseAdmin();
    const { error } = await supabaseAdmin
      .from('platform_settings')
      .upsert({
        id: true,
        service_fee_enabled: enabled,
        service_fee_percent: DEFAULT_SERVICE_FEE_PERCENT,
        updated_at: new Date().toISOString()
      }, { onConflict: 'id' });

    if (error) {
      console.error('[Owner Service Fee] Falha ao salvar configuração:', error);
      return NextResponse.json({ error: 'Não foi possível salvar a taxa de serviço.' }, { status: 500 });
    }

    return NextResponse.json({ enabled, percent: DEFAULT_SERVICE_FEE_PERCENT });
  } catch {
    return NextResponse.json({ error: 'Dados inválidos para a taxa de serviço.' }, { status: 400 });
  }
}
