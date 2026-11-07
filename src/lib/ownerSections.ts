// Seções do painel do proprietário (Story 1.123, decisões D1 e D2 de
// docs/design/painel-proprietario/). A seção aberta fica no endereço
// (/owner?secao=gestores): recarregar mantém a seção e o link pode ser enviado.

export const OWNER_SECTION_IDS = ['visao-geral', 'gestores', 'eventos', 'comercial', 'configuracoes'] as const;
export type OwnerSectionId = typeof OWNER_SECTION_IDS[number];

export const OWNER_DEFAULT_SECTION: OwnerSectionId = 'visao-geral';

export const OWNER_SECTION_LABELS: Record<OwnerSectionId, string> = {
  'visao-geral': 'Visão geral',
  gestores: 'Gestores',
  eventos: 'Eventos',
  comercial: 'Comercial',
  configuracoes: 'Configurações'
};

export const OWNER_SECTION_PARAM = 'secao';

/** Valor do endereço → seção; desconhecido ou ausente abre a Visão geral. */
export const parseOwnerSection = (value: string | null | undefined): OwnerSectionId =>
  OWNER_SECTION_IDS.includes(value as OwnerSectionId) ? value as OwnerSectionId : OWNER_DEFAULT_SECTION;

/** Endereço da seção, preservando os outros parâmetros; a Visão geral fica sem parâmetro. */
export const buildOwnerSectionSearch = (currentSearch: string, section: OwnerSectionId): string => {
  const params = new URLSearchParams(currentSearch);
  if (section === OWNER_DEFAULT_SECTION) params.delete(OWNER_SECTION_PARAM);
  else params.set(OWNER_SECTION_PARAM, section);
  const search = params.toString();
  return search ? `?${search}` : '';
};
