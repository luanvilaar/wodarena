// Preferências da tela de login que vêm do navegador: o token do link de
// redefinição de senha (?reset_token=) e o e-mail lembrado.
//
// Os dois valores só existem no cliente. As funções de store alimentam
// useSyncExternalStore: o servidor sempre responde vazio e o cliente lê o valor
// real depois de hidratar, sem erro de hidratação e sem setState em efeito
// (mesmo padrão de src/lib/athleteSections.ts). Os valores só mudam por ação do
// próprio painel, então não há o que assinar.
// Módulo sem imports para poder ser testado direto pelo node:test.

export const LOGIN_EMAIL_STORAGE_KEY = 'wodarena_login_email';
export const RESET_TOKEN_PARAM = 'reset_token';

type ReadableStorage = Pick<Storage, 'getItem'>;
type WritableStorage = Pick<Storage, 'setItem' | 'removeItem'>;

export const parseResetToken = (search: string): string =>
  new URLSearchParams(search).get(RESET_TOKEN_PARAM) || '';

/** localStorage pode lançar (modo privado, dados bloqueados): nesse caso não há e-mail lembrado. */
export const readRememberedEmail = (storage: ReadableStorage | null): string => {
  try {
    return storage?.getItem(LOGIN_EMAIL_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
};

/** Com "lembrar" marcado grava o e-mail; desmarcado, apaga o que estava gravado. */
export const saveRememberedEmail = (storage: WritableStorage | null, email: string, remember: boolean): void => {
  try {
    if (remember && email) storage?.setItem(LOGIN_EMAIL_STORAGE_KEY, email);
    else storage?.removeItem(LOGIN_EMAIL_STORAGE_KEY);
  } catch {
    // Sem armazenamento disponível, o login segue sem lembrar o e-mail.
  }
};

const getBrowserStorage = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

export const subscribeToLoginPreferences = (): (() => void) => () => {};

export const getResetTokenSnapshot = (): string => parseResetToken(window.location.search);
export const getResetTokenServerSnapshot = (): string => '';

export const getRememberedEmailSnapshot = (): string => readRememberedEmail(getBrowserStorage());
export const getRememberedEmailServerSnapshot = (): string => '';

export const saveBrowserRememberedEmail = (email: string, remember: boolean): void =>
  saveRememberedEmail(getBrowserStorage(), email, remember);
