import { NextResponse } from 'next/server';
import { createHash, randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { sendPasswordResetEmail } from '@/lib/resend';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://momigbtnsswoldqnadmc.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESET_EXPIRES_MINUTES = 45;

const normalizeEmail = (email: string) => email.trim().toLowerCase();
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const getPublicAppUrl = () => {
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL
    || process.env.NEXT_PUBLIC_SITE_URL
    || process.env.APP_URL
    || process.env.SITE_URL
    || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '')
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '')
    || 'https://wodarena.com.br';

  return configuredUrl.replace(/\/$/, '');
};

export async function POST(request: Request) {
  try {
    if (!supabaseServiceKey) {
      console.error('[API Auth RequestPasswordReset] SUPABASE_SERVICE_ROLE_KEY não configurada.');
      return NextResponse.json({ error: 'Configuração do servidor ausente.' }, { status: 500 });
    }

    const { email } = await request.json();
    const normalizedEmail = normalizeEmail(String(email || ''));

    if (!normalizedEmail || !normalizedEmail.includes('@')) {
      return NextResponse.json({ error: 'Informe um e-mail válido.' }, { status: 400 });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, name, email, role')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (userError) {
      console.error('[API Auth RequestPasswordReset] Erro ao buscar usuário:', userError);
      return NextResponse.json({ error: 'Erro ao processar solicitação.' }, { status: 500 });
    }

    if (!user || (user.role !== 'manager' && user.role !== 'athlete')) {
      return NextResponse.json({ success: true });
    }

    const token = randomBytes(32).toString('hex');
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + RESET_EXPIRES_MINUTES * 60 * 1000).toISOString();

    await supabaseAdmin
      .from('password_reset_tokens')
      .update({ used_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .is('used_at', null);

    const { error: insertError } = await supabaseAdmin
      .from('password_reset_tokens')
      .insert({
        token_hash: tokenHash,
        user_id: user.id,
        email: normalizedEmail,
        expires_at: expiresAt
      });

    if (insertError) {
      console.error('[API Auth RequestPasswordReset] Erro ao gravar token:', insertError);
      return NextResponse.json({ error: 'Erro ao gerar token de recuperação.' }, { status: 500 });
    }

    const resetUrl = `${getPublicAppUrl()}/admin?reset_token=${token}`;
    const emailResult = await sendPasswordResetEmail({
      toEmail: normalizedEmail,
      userName: user.name || 'WODArena',
      resetUrl,
      expiresInMinutes: RESET_EXPIRES_MINUTES
    });

    if (!emailResult.success) {
      console.error('[API Auth RequestPasswordReset] Falha ao enviar e-mail:', emailResult.error);
      return NextResponse.json({
        error: 'Não foi possível enviar o e-mail de recuperação.',
        ...(process.env.NODE_ENV !== 'production' ? { detail: emailResult.error } : {})
      }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[API Auth RequestPasswordReset] Erro crítico:', err);
    return NextResponse.json({ error: 'Erro interno ao solicitar recuperação de senha.' }, { status: 500 });
  }
}
