import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://momigbtnsswoldqnadmc.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function POST(request: Request) {
  try {
    if (!supabaseServiceKey) {
      console.error('[API Auth Login] SUPABASE_SERVICE_ROLE_KEY não configurada no servidor.');
      return NextResponse.json({ error: 'Configuração do servidor ausente.' }, { status: 500 });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const body = await request.json();
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json({ error: 'E-mail e senha são obrigatórios.' }, { status: 400 });
    }

    // 1. Buscar o perfil do usuário pelo e-mail
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, name, email, role, organization')
      .eq('email', email.trim())
      .maybeSingle();

    if (userError || !user) {
      console.warn(`[API Auth Login] Login fracassado: usuário não encontrado para ${email}`);
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

    // 3. Comparação de senha
    // Nota: Em ambiente estritamente de produção profissional, deve-se usar hashing (ex: bcrypt.compare).
    // Para compatibilidade e transição suave do projeto WODArena, aceitamos a comparação direta de texto.
    if (secret.password !== password) {
      console.warn(`[API Auth Login] Senha incorreta para o e-mail: ${email}`);
      return NextResponse.json({ error: 'E-mail ou senha incorretos.' }, { status: 401 });
    }

    console.log(`[API Auth Login] Login efetuado com sucesso para ${email} (Role: ${user.role})`);
    return NextResponse.json({ success: true, user });

  } catch (err) {
    console.error('[API Auth Login] Erro crítico inesperado:', err);
    return NextResponse.json({ error: 'Erro crítico interno no servidor.' }, { status: 500 });
  }
}
