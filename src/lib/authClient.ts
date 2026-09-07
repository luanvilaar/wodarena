import type { User } from '@/types';

export type LoginOptions = { ownerOnly?: boolean };
export type LoginResult =
  | { success: true; user: User }
  | { success: false; error: string };

const LOGIN_TIMEOUT_MS = 12000;

const loginErrorForStatus = (status: number): string => {
  if (status === 400) return 'Informe um e-mail e uma senha válidos.';
  if (status === 401) return 'E-mail ou senha incorretos.';
  if (status === 403) return 'Acesso negado. Esta conta não possui privilégios de proprietário do site.';
  if (status === 429) return 'Muitas tentativas de login. Aguarde alguns minutos e tente novamente.';
  return 'O serviço de autenticação está indisponível. Tente novamente em instantes.';
};

export async function requestLogin(
  email: string,
  password: string,
  options: LoginOptions = {}
): Promise<LoginResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LOGIN_TIMEOUT_MS);

  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, ownerOnly: options.ownerOnly === true }),
      signal: controller.signal
    });
    // Classificar pelo status também funciona quando o proxy devolve HTML.
    // Mensagens internas do servidor não devem ser reproduzidas na interface.
    if (!response.ok) return { success: false, error: loginErrorForStatus(response.status) };

    const data = await response.json().catch(() => null);
    const user = data?.user;
    if (data?.success !== true || !user || typeof user.id !== 'string'
      || typeof user.email !== 'string' || typeof user.name !== 'string'
      || !['owner', 'manager', 'athlete', 'judge'].includes(user.role)) {
      return { success: false, error: loginErrorForStatus(500) };
    }
    if (options.ownerOnly && user.role !== 'owner') {
      return { success: false, error: loginErrorForStatus(403) };
    }
    return { success: true, user };
  } catch {
    return {
      success: false,
      error: controller.signal.aborted
        ? 'O login demorou mais que o esperado. Tente novamente.'
        : 'Não foi possível conectar ao serviço de autenticação. Verifique sua conexão e tente novamente.'
    };
  } finally {
    clearTimeout(timeout);
  }
}
