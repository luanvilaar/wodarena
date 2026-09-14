import { NextResponse } from 'next/server';
import { ManagerAccessError, assertManagerOperationalAccess, managerAccessErrorResponse } from '@/lib/serverManagerAccess';
import { StripeConfigError, getStripeClient } from '@/lib/stripeServer';
import {
  canActOnUser,
  createSupabaseAdmin,
  loadUserById,
  requireSession
} from '@/lib/serverSecurity';

type StripeAccountRow = {
  stripe_account_id: string;
  country: string;
  default_currency: string;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
  status: string;
};

const resolveReturnOrigin = (request: Request) => request.headers.get('origin') || new URL(request.url).origin;

export async function GET(request: Request) {
  try {
    const auth = requireSession(request, ['manager', 'owner']);
    if (auth.response) return auth.response;
    const actor = auth.user;
    const supabaseAdmin = createSupabaseAdmin();
    await assertManagerOperationalAccess(supabaseAdmin, actor);

    const { searchParams } = new URL(request.url);
    const requestedUserId = searchParams.get('userId');
    const userId = requestedUserId || actor.id;

    if (!canActOnUser(actor, userId)) {
      return NextResponse.json({ error: 'Acesso negado para este gestor.' }, { status: 403 });
    }

    const checkUser = await loadUserById(supabaseAdmin, userId);
    if (!checkUser || (checkUser.role !== 'manager' && checkUser.role !== 'owner')) {
      return NextResponse.json({ error: 'Usuário inválido ou sem permissão.' }, { status: 403 });
    }

    const action = searchParams.get('action');

    if (action === 'onboarding_url') {
      const country = searchParams.get('country');
      if (country !== 'PT' && country !== 'GB') {
        return NextResponse.json({ error: 'País obrigatório (PT ou GB) para conectar a conta Stripe.' }, { status: 400 });
      }

      const stripe = getStripeClient();
      const origin = resolveReturnOrigin(request);

      const { data: existing } = await supabaseAdmin
        .from('stripe_accounts')
        .select('stripe_account_id, country')
        .eq('user_id', userId)
        .maybeSingle<{ stripe_account_id: string; country: string }>();

      // Uma conta Stripe Express é fixa a um único país desde a criação — um
      // gestor que já conectou para PT não pode reaproveitar a mesma conta
      // para GB (e vice-versa). Precisaria desconectar e reconectar.
      if (existing && existing.country !== country) {
        return NextResponse.json({
          error: `Este gestor já possui uma conta Stripe conectada para ${existing.country}. Desconecte antes de conectar para ${country}.`
        }, { status: 409 });
      }

      const currency = country === 'PT' ? 'EUR' : 'GBP';
      const stripeAccountId = existing?.stripe_account_id || (await stripe.accounts.create({
        type: 'express',
        country,
        default_currency: currency.toLowerCase(),
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true }
        }
      })).id;

      if (!existing) {
        const { error: upsertError } = await supabaseAdmin
          .from('stripe_accounts')
          .insert({
            user_id: userId,
            stripe_account_id: stripeAccountId,
            country,
            default_currency: currency,
            status: 'pending'
          });
        if (upsertError) {
          console.error('[API Admin Stripe GET] Erro ao gravar conta Stripe pendente:', upsertError);
          return NextResponse.json({ error: 'Erro interno ao iniciar a conexão com a Stripe.' }, { status: 500 });
        }
      }

      const accountLink = await stripe.accountLinks.create({
        account: stripeAccountId,
        refresh_url: `${origin}/api/admin/stripe?action=onboarding_url&country=${country}`,
        return_url: `${origin}/api/stripe/return?userId=${encodeURIComponent(userId)}`,
        type: 'account_onboarding'
      });

      return NextResponse.json({ url: accountLink.url });
    }

    const { data, error } = await supabaseAdmin
      .from('stripe_accounts')
      .select('stripe_account_id, country, default_currency, charges_enabled, payouts_enabled, details_submitted, status')
      .eq('user_id', userId)
      .maybeSingle<StripeAccountRow>();

    if (error) {
      console.error('[API Admin Stripe GET] Erro ao buscar conta Stripe:', error);
      return NextResponse.json({ error: 'Erro ao buscar conta Stripe.' }, { status: 500 });
    }

    return NextResponse.json({ account: data });
  } catch (err) {
    if (err instanceof ManagerAccessError) {
      return managerAccessErrorResponse(err);
    }
    if (err instanceof StripeConfigError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[API Admin Stripe GET] Erro crítico inesperado:', err);
    return NextResponse.json({ error: 'Erro crítico interno no servidor.' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const auth = requireSession(request, ['manager', 'owner']);
    if (auth.response) return auth.response;
    const actor = auth.user;
    const supabaseAdmin = createSupabaseAdmin();
    await assertManagerOperationalAccess(supabaseAdmin, actor);

    const body = await request.json();
    const { userId: requestedUserId } = body;
    const userId = requestedUserId || actor.id;

    if (!canActOnUser(actor, userId)) {
      return NextResponse.json({ error: 'Acesso negado para este gestor.' }, { status: 403 });
    }

    const { error } = await supabaseAdmin
      .from('stripe_accounts')
      .update({ status: 'disconnected', updated_at: new Date().toISOString() })
      .eq('user_id', userId);

    if (error) {
      console.error('[API Admin Stripe DELETE] Erro ao desconectar conta Stripe:', error);
      return NextResponse.json({ error: 'Erro ao desconectar conta Stripe no banco de dados.' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof ManagerAccessError) {
      return managerAccessErrorResponse(err);
    }
    console.error('[API Admin Stripe DELETE] Erro crítico inesperado:', err);
    return NextResponse.json({ error: 'Erro crítico interno no servidor.' }, { status: 500 });
  }
}
