// Local curto do evento ("João Pessoa/PB") para o card e os filtros da home
// (Stories 1.130 e 1.133). Cidade e estado chegam do cadastro em formatos
// misturados ("JOAO PESSOA", "Rio grande do Norte", "PB - PARAÍBA"); aqui viram
// cidade capitalizada e a sigla da UF quando o estado é reconhecível.

const UF_BY_NAME: Record<string, string> = {
  acre: 'AC', alagoas: 'AL', amapa: 'AP', amazonas: 'AM', bahia: 'BA', ceara: 'CE',
  'distrito federal': 'DF', 'espirito santo': 'ES', goias: 'GO', maranhao: 'MA',
  'mato grosso': 'MT', 'mato grosso do sul': 'MS', 'minas gerais': 'MG', para: 'PA',
  paraiba: 'PB', parana: 'PR', pernambuco: 'PE', piaui: 'PI', 'rio de janeiro': 'RJ',
  'rio grande do norte': 'RN', 'rio grande do sul': 'RS', rondonia: 'RO', roraima: 'RR',
  'santa catarina': 'SC', 'sao paulo': 'SP', sergipe: 'SE', tocantins: 'TO',
};

export const BRAZIL_UFS: readonly string[] = Object.values(UF_BY_NAME).sort();

const fold = (value: string) =>
  value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

// "PB", "pb", "Paraíba", "PB - PARAÍBA", "Rio grande do Norte" -> sigla; senão null.
export function toUf(state: string | null | undefined): string | null {
  const raw = (state ?? '').trim();
  if (!raw) return null;
  const leading = raw.match(/^([A-Za-z]{2})(?:\s*[-–/]|$)/);
  if (leading && BRAZIL_UFS.includes(leading[1].toUpperCase())) return leading[1].toUpperCase();
  const folded = fold(raw);
  if (UF_BY_NAME[folded]) return UF_BY_NAME[folded];
  const trailing = folded.match(/(?:^|[-–/]\s*)([a-z ]+)$/);
  if (trailing && UF_BY_NAME[trailing[1].trim()]) return UF_BY_NAME[trailing[1].trim()];
  return null;
}

const LOWER_WORDS = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);

// Só mexe em cidade toda em maiúsculas ("JOAO PESSOA" -> "Joao Pessoa"); o resto
// fica como o gestor escreveu.
export function formatCity(city: string | null | undefined): string {
  const trimmed = (city ?? '').trim().replace(/\s+/g, ' ');
  if (!trimmed || trimmed !== trimmed.toUpperCase() || !/[A-ZÀ-Ý]/.test(trimmed)) return trimmed;
  return trimmed
    .toLowerCase()
    .split(' ')
    .map((word, index) => (index > 0 && LOWER_WORDS.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(' ');
}

export function formatEventPlace(event: { city?: string | null; state?: string | null; location?: string | null }): string {
  const city = formatCity(event.city);
  const uf = toUf(event.state);
  if (city && uf) return `${city}/${uf}`;
  if (city) return city;
  return (event.location ?? '').trim();
}
