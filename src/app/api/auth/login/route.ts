import { NextResponse } from 'next/server';
import { getManagerAccessStatus, normalizeServiceValidUntil } from '@/lib/managerAccess';
import {
  checkRateLimit,
  createSessionToken,
  createSupabaseAdmin,
  getClientIp,
  getSessionCookieHeader,
  hashPassword,
  maskEmailForLog,
  verifyPassword
} from '@/lib/serverSecurity';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json({ error: 'E-mail e senha são obrigatórios.' }, { status: 400 });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const rateLimited = checkRateLimit({
      key: `login:${getClientIp(request)}:${normalizedEmail}`,
      limit: 8,
      windowMs: 15 * 60 * 1000
    });
    if (rateLimited) return rateLimited;

    const supabaseAdmin = createSupabaseAdmin();

    // 1. Buscar o perfil do usuário pelo e-mail
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, name, email, role, organization, service_valid_until')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (userError || !user) {
      console.warn(`[API Auth Login] Login fracassado: usuario nao encontrado para ${maskEmailForLog(normalizedEmail)}`);
      return NextResponse.json({ error: 'E-mail ou senha incorretos.' }, { status: 401 });
    }

    // 2. Buscar a senha correspondente na tabela privada de segredos
    const { data: secret, error: secretError } = await supabaseAdmin
      .from('users_secrets')
      .select('password')
      .eq('user_id', user.id)
      .maybeSingle();

    if (secretError || !secret) {
      console.error(`[API Auth Login] Falha ao recuperar segredo para o usuário ${user.id}`);
      return NextResponse.json({ error: 'Erro de autenticação interna.' }, { status: 500 });
    }

    const passwordCheck = verifyPassword(String(password), secret.password);
    if (!passwordCheck.valid) {
      console.warn(`[API Auth Login] Senha incorreta para o e-mail: ${maskEmailForLog(normalizedEmail)}`);
      return NextResponse.json({ error: 'E-mail ou senha incorretos.' }, { status: 401 });
    }

    if (passwordCheck.needsRehash) {
      await supabaseAdmin
        .from('users_secrets')
        .update({ password: hashPassword(String(password)) })
        .eq('user_id', user.id);
    }

    const sessionUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      organization: user.organization || undefined
    };
    const serviceValidUntil = normalizeServiceValidUntil(user.service_valid_until);
    const token = createSessionToken(sessionUser);
    const response = NextResponse.json({
      success: true,
      user: {
        ...sessionUser,
        serviceValidUntil,
        managerAccessStatus: user.role === 'manager' ? getManagerAccessStatus(serviceValidUntil) : undefined
      }
    });
    response.headers.set('Set-Cookie', getSessionCookieHeader(token));
    console.log(`[API Auth Login] Login efetuado com sucesso para usuario ${user.id} (Role: ${user.role})`);
    return response;

  } catch (err) {
    console.error('[API Auth Login] Erro crítico inesperado:', err);
    return NextResponse.json({ error: 'Erro crítico interno no servidor.' }, { status: 500 });
  }
}
