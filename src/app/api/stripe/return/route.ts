import { NextResponse } from 'next/server';
import { createSupabaseAdmin } from '@/lib/serverSecurity';
import { getStripeClient } from '@/lib/stripeServer';

/**
 * Callback de retorno do Stripe Connect Account Links. Diferente do OAuth do
 * Mercado Pago, não há troca de código aqui: a conta já existe desde
 * /api/admin/stripe?action=onboarding_url. Só sincronizamos o status atual
 * (charges_enabled/payouts_enabled/details_submitted) direto da Stripe.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const userId = searchParams.get('userId');
  const redirectTo = new URL('/admin', origin);

  if (!userId) {
    redirectTo.searchParams.set('stripe_status', 'missing_user');
    return NextResponse.redirect(redirectTo);
  }

  try {
    const supabaseAdmin = createSupabaseAdmin();
    const { data: existing } = await supabaseAdmin
      .from('stripe_accounts')
      .select('stripe_account_id')
      .eq('user_id', userId)
      .maybeSingle<{ stripe_account_id: string }>();

    if (!existing) {
      redirectTo.searchParams.set('stripe_status', 'not_found');
      return NextResponse.redirect(redirectTo);
    }

    const account = await getStripeClient().accounts.retrieve(existing.stripe_account_id);

    const { error } = await supabaseAdmin
      .from('stripe_accounts')
      .update({
        charges_enabled: Boolean(account.charges_enabled),
        payouts_enabled: Boolean(account.payouts_enabled),
        details_submitted: Boolean(account.details_submitted),
        status: account.charges_enabled ? 'connected' : 'pending',
        onboarded_at: account.charges_enabled ? new Date().toISOString() : null,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId);

    if (error) {
      console.error('[Stripe Return] Erro ao sincronizar conta Stripe:', error);
      redirectTo.searchParams.set('stripe_status', 'sync_error');
      return NextResponse.redirect(redirectTo);
    }

    redirectTo.searchParams.set('stripe_status', account.charges_enabled ? 'connected' : 'pending');
    return NextResponse.redirect(redirectTo);
  } catch (err) {
    console.error('[Stripe Return] Erro crítico ao processar retorno do onboarding:', err);
    redirectTo.searchParams.set('stripe_status', 'error');
    return NextResponse.redirect(redirectTo);
  }
}
