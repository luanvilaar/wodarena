import { NextResponse } from 'next/server';
import { ManagerAccessError, assertManagerOperationalAccess, managerAccessErrorResponse } from '@/lib/serverManagerAccess';
import {
  canActOnUser,
  createSupabaseAdmin,
  loadUserById,
  requireSession
} from '@/lib/serverSecurity';
import { loadManagerServiceFeePayer } from '@/lib/serverServiceFeePayer';
import { DEFAULT_SERVICE_FEE_PERCENT, normalizeServiceFeePayer, normalizeServiceFeePercent } from '@/lib/serviceFee';

// Configurações de cobrança do gestor, hoje só quem paga a taxa de serviço da
// plataforma (Story 1.84). A escolha vale para os pagamentos criados depois de
// salva; inscrição já paga guarda a regra que valeu na hora (registrations.service_fee_payer).

const authorize = async (request: Request, requestedUserId: string | null | undefined) => {
  const auth = requireSession(request, ['manager', 'owner']);
  if (auth.response) return { response: auth.response };
  const actor = auth.user;
  const supabaseAdmin = createSupabaseAdmin();
  await assertManagerOperationalAccess(supabaseAdmin, actor);

  const userId = requestedUserId || actor.id;
  if (!canActOnUser(actor, userId)) {
    return { response: NextResponse.json({ error: 'Acesso negado para este gestor.' }, { status: 403 }) };
  }

  const target = await loadUserById(supabaseAdmin, userId);
  if (!target || (target.role !== 'manager' && target.role !== 'owner')) {
    return { response: NextResponse.json({ error: 'Usuário inválido ou sem permissão.' }, { status: 403 }) };
  }

  return { supabaseAdmin, userId };
};

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const access = await authorize(request, searchParams.get('userId'));
    if (access.response) return access.response;
    const { supabaseAdmin, userId } = access;

    const [serviceFeePayer, platform] = await Promise.all([
      loadManagerServiceFeePayer(supabaseAdmin, userId),
      supabaseAdmin
        .from('platform_settings')
        .select('service_fee_enabled, service_fee_percent')
        .eq('id', true)
        .maybeSingle<{ service_fee_enabled: boolean | null; service_fee_percent: number | string | null }>()
    ]);

    if (platform.error) {
      console.error('[API Admin Payment Settings GET] Erro ao carregar taxa da plataforma:', platform.error);
      return NextResponse.json({ error: 'Erro ao carregar as configurações de pagamento.' }, { status: 500 });
    }

    return NextResponse.json({
      // null = o gestor ainda não escolheu; valem os padrões de cada gateway.
      serviceFeePayer,
      platformFee: {
        enabled: platform.data?.service_fee_enabled !== false,
        percent: normalizeServiceFeePercent(platform.data?.service_fee_percent, DEFAULT_SERVICE_FEE_PERCENT)
      }
    });
  } catch (err) {
    if (err instanceof ManagerAccessError) {
      return managerAccessErrorResponse(err);
    }
    console.error('[API Admin Payment Settings GET] Erro crítico inesperado:', err);
    return NextResponse.json({ error: 'Erro crítico interno no servidor.' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const serviceFeePayer = normalizeServiceFeePayer(body?.serviceFeePayer);
    if (!serviceFeePayer) {
      return NextResponse.json({ error: 'Informe quem paga a taxa de serviço: athlete ou organizer.' }, { status: 400 });
    }

    const access = await authorize(request, typeof body?.userId === 'string' ? body.userId : null);
    if (access.response) return access.response;
    const { supabaseAdmin, userId } = access;

    const { error } = await supabaseAdmin
      .from('manager_payment_settings')
      .upsert({
        user_id: userId,
        service_fee_payer: serviceFeePayer,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' });

    if (error) {
      console.error('[API Admin Payment Settings PUT] Erro ao salvar a escolha:', error);
      return NextResponse.json({ error: 'Não foi possível salvar a escolha.' }, { status: 500 });
    }

    return NextResponse.json({ serviceFeePayer });
  } catch (err) {
    if (err instanceof ManagerAccessError) {
      return managerAccessErrorResponse(err);
    }
    console.error('[API Admin Payment Settings PUT] Erro crítico inesperado:', err);
    return NextResponse.json({ error: 'Erro crítico interno no servidor.' }, { status: 500 });
  }
}
