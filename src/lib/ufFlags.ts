// Bandeiras dos estados brasileiros no leaderboard (Story 1.153). Módulo puro,
// sem imports de runtime: usado pelo servidor (normaliza o que é gravado), pelo
// formulário de inscrição (lista de UFs) e pelo leaderboard (qual bandeira
// mostrar). Os arquivos ficam em public/flags/br/<uf>.svg (CC0, ver NOTICE).

export const BR_UFS = [
  { uf: 'AC', name: 'Acre' },
  { uf: 'AL', name: 'Alagoas' },
  { uf: 'AP', name: 'Amapá' },
  { uf: 'AM', name: 'Amazonas' },
  { uf: 'BA', name: 'Bahia' },
  { uf: 'CE', name: 'Ceará' },
  { uf: 'DF', name: 'Distrito Federal' },
  { uf: 'ES', name: 'Espírito Santo' },
  { uf: 'GO', name: 'Goiás' },
  { uf: 'MA', name: 'Maranhão' },
  { uf: 'MT', name: 'Mato Grosso' },
  { uf: 'MS', name: 'Mato Grosso do Sul' },
  { uf: 'MG', name: 'Minas Gerais' },
  { uf: 'PA', name: 'Pará' },
  { uf: 'PB', name: 'Paraíba' },
  { uf: 'PR', name: 'Paraná' },
  { uf: 'PE', name: 'Pernambuco' },
  { uf: 'PI', name: 'Piauí' },
  { uf: 'RJ', name: 'Rio de Janeiro' },
  { uf: 'RN', name: 'Rio Grande do Norte' },
  { uf: 'RS', name: 'Rio Grande do Sul' },
  { uf: 'RO', name: 'Rondônia' },
  { uf: 'RR', name: 'Roraima' },
  { uf: 'SC', name: 'Santa Catarina' },
  { uf: 'SP', name: 'São Paulo' },
  { uf: 'SE', name: 'Sergipe' },
  { uf: 'TO', name: 'Tocantins' }
] as const;

export type BrUf = (typeof BR_UFS)[number]['uf'];

const UF_BY_CODE = new Map<string, { uf: BrUf; name: string }>(BR_UFS.map((item) => [item.uf, item]));

// Sem acento, sem caixa e com espaço simples: "São  Paulo" e "sao paulo" viram a mesma chave.
export const foldUfText = (value: string): string => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/\s+/g, ' ')
  .trim();

// Depois de dobrado, só vale texto feito de letras e espaços: "ce1", "(CE)" e "PA-2025" não são UF.
const ONLY_LETTERS_AND_SPACES = /^[a-z]+(?: [a-z]+)*$/;

const UF_BY_NAME = new Map<string, BrUf>(BR_UFS.map((item) => [foldUfText(item.name), item.uf]));

/**
 * Devolve a UF quando o texto é uma sigla ("ce", " CE ") ou o nome do estado
 * ("Ceará", "ceara", "rio grande do norte"). Qualquer outra coisa ("XX", "BR",
 * "C", "Lisboa", "ce1", "(CE)", "PA-2025") devolve null: nunca chuta uma UF.
 * Quem lê o texto livre do gestor ("PB - PARAÍBA") é o toUf de eventPlace.ts.
 */
export const normalizeUf = (raw: unknown): BrUf | null => {
  if (typeof raw !== 'string') return null;
  const folded = foldUfText(raw);
  if (!ONLY_LETTERS_AND_SPACES.test(folded)) return null;
  const upper = folded.toUpperCase();
  if (UF_BY_CODE.has(upper)) return upper as BrUf;
  return UF_BY_NAME.get(folded) ?? null;
};

export const getUfName = (uf: BrUf): string => UF_BY_CODE.get(uf)?.name ?? uf;

/** Caminho público do arquivo da bandeira (servido de public/). */
export const ufFlagSrc = (uf: BrUf): string => `/flags/br/${uf.toLowerCase()}.svg`;

// Evento fora do Brasil (Portugal e Reino Unido): o campo "estado" continua texto
// livre ("Distrito") e nunca vira bandeira. Sem país informado vale o padrão, BR.
export const isBrazilEventCountry = (country: unknown): boolean => {
  if (typeof country !== 'string' || !country.trim()) return true;
  return country.trim().toUpperCase() === 'BR';
};

/**
 * O que gravar em athletes.state. Evento brasileiro: só a sigla da UF (aceita
 * o nome por extenso, como nos cadastros antigos) ou nada. Evento de outro
 * país: o texto digitado, aparado.
 */
export const normalizeStateForStorage = (raw: unknown, eventCountryCode?: string | null): string | null => {
  if (isBrazilEventCountry(eventCountryCode)) return normalizeUf(raw);
  if (typeof raw !== 'string') return null;
  const text = raw.trim().slice(0, 60);
  return text || null;
};

export type AthleteFlagInput = {
  country?: string | null;
  state?: string | null;
  isTeam?: boolean | null;
};

export type AthleteFlag = { uf: BrUf; name: string };

/**
 * Bandeira do atleta no leaderboard, ou null. Só aparece para atleta individual
 * (a equipe guarda o estado do primeiro integrante, que não a representa), com
 * país BR, em evento brasileiro e com uma UF válida. Valor inválido não mostra
 * bandeira e não gera erro.
 */
export const resolveAthleteFlag = (athlete: AthleteFlagInput, eventCountryCode?: string | null): AthleteFlag | null => {
  if (athlete.isTeam) return null;
  if (!isBrazilEventCountry(athlete.country) || !isBrazilEventCountry(eventCountryCode)) return null;
  const uf = normalizeUf(athlete.state);
  if (!uf) return null;
  return { uf, name: getUfName(uf) };
};
