// Identificadores de inscrição e de atleta. O servidor é a única fonte dos
// identificadores e da data de criação: o id que o navegador enviar nunca é
// gravado. Módulo puro, sem imports, para ser importado direto pelos testes.

const UUID_V4 = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const REGISTRATION_ID_PATTERN = new RegExp(`^reg-${UUID_V4}$`);
const ATHLETE_ID_PATTERN = new RegExp(`^ath-${UUID_V4}$`);

// UUID v4 do Web Crypto (Node 19+ e runtimes web). Sem ele a geração falha:
// qualquer substituto improvisado daria ids previsíveis ou repetidos.
const randomUuid = (): string => {
  const webCrypto = globalThis.crypto;
  if (!webCrypto || typeof webCrypto.randomUUID !== 'function') {
    throw new Error('Gerador seguro de identificadores indisponível neste ambiente.');
  }
  return webCrypto.randomUUID();
};

export const createRegistrationId = (): string => `reg-${randomUuid()}`;

export const createAthleteId = (): string => `ath-${randomUuid()}`;

export const isServerRegistrationId = (value: unknown): value is string => (
  typeof value === 'string' && REGISTRATION_ID_PATTERN.test(value)
);

export const isServerAthleteId = (value: unknown): value is string => (
  typeof value === 'string' && ATHLETE_ID_PATTERN.test(value)
);
