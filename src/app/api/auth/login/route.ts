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

// Hash "fantasma" para gastar o mesmo custo de scrypt quando o e-mail não
// existe — sem isso, a ausência de usuário responde bem mais rápido que uma
// senha incorreta, o que permite enumerar e-mails cadastrados por timing.
const DUMMY_PASSWORD_HASH = hashPassword('wodarena-login-timing-decoy');

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const { email, password, ownerOnly } = body || {};

    if (typeof email !== 'string' || !email.trim() || typeof password !== 'string' || !password
      || (ownerOnly !== undefined && typeof ownerOnly !== 'boolean')) {
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

    if (userError) {
      console.error('[API Auth Login] Falha na consulta de usuário:', JSON.stringify({ code: userError.code }));
      return NextResponse.json({ error: 'Serviço de autenticação indisponível.' }, { status: 503 });
    }

    if (!user) {
      verifyPassword(String(password), DUMMY_PASSWORD_HASH);
      console.warn(`[API Auth Login] Login fracassado: usuario nao encontrado para ${maskEmailForLog(normalizedEmail)}`);
      return NextResponse.json({ error: 'E-mail ou senha incorretos.' }, { status: 401 });
    }

    // 2. Buscar a senha correspondente na tabela privada de segredos
    const { data: secret, error: secretError } = await supabaseAdmin
      .from('users_secrets')
      .select('password')
      .eq('user_id', user.id)
      .maybeSingle();

    if (secretError) {
      console.error('[API Auth Login] Falha na consulta de credenciais:', JSON.stringify({ code: secretError.code }));
      return NextResponse.json({ error: 'Serviço de autenticação indisponível.' }, { status: 503 });
    }
    if (!secret) {
      verifyPassword(String(password), DUMMY_PASSWORD_HASH);
      return NextResponse.json({ error: 'E-mail ou senha incorretos.' }, { status: 401 });
    }

    const passwordCheck = verifyPassword(String(password), secret.password);
    if (!passwordCheck.valid) {
      console.warn(`[API Auth Login] Senha incorreta para o e-mail: ${maskEmailForLog(normalizedEmail)}`);
      return NextResponse.json({ error: 'E-mail ou senha incorretos.' }, { status: 401 });
    }

    // O modo proprietário só restringe o acesso; nunca define o papel da sessão.
    // Conferir após a senha evita revelar o papel de contas a visitantes.
    if (ownerOnly === true && user.role !== 'owner') {
      return NextResponse.json({ error: 'Acesso restrito ao proprietário.' }, { status: 403 });
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
