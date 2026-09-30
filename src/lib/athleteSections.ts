// Seções da Área do Atleta e sincronização da seção ativa com o hash da URL.
//
// A seção ativa vive no hash (#inscricoes, #resultados, #contestar, #perfil)
// para que "voltar" do navegador e links diretos funcionem. As funções de store
// alimentam useSyncExternalStore: o servidor sempre responde a seção padrão e o
// cliente lê o hash só depois de hidratar, sem setState dentro de efeitos.
// Módulo sem imports para poder ser testado direto pelo node:test.

export type AthleteSectionId = 'events' | 'submissions' | 'contestations' | 'profile';

export type AthleteSection = {
  id: AthleteSectionId;
  /** Fragmento da URL, sem o '#'. */
  hash: string;
  /** Rótulo da sidebar (lg+). */
  label: string;
  /** Rótulo da barra inferior (< lg): precisa caber em 1/4 de 320px. */
  shortLabel: string;
};

export const DEFAULT_ATHLETE_SECTION: AthleteSectionId = 'events';

export const ATHLETE_SECTIONS: readonly AthleteSection[] = [
  { id: 'events', hash: 'inscricoes', label: 'Inscrições', shortLabel: 'Inscrições' },
  { id: 'submissions', hash: 'resultados', label: 'Enviar resultados', shortLabel: 'Resultados' },
  { id: 'contestations', hash: 'contestar', label: 'Contestações', shortLabel: 'Contestar' },
  { id: 'profile', hash: 'perfil', label: 'Dados do perfil', shortLabel: 'Perfil' },
];

export const getAthleteSectionHash = (id: AthleteSectionId): string => {
  const section = ATHLETE_SECTIONS.find(item => item.id === id);
  return `#${section ? section.hash : ATHLETE_SECTIONS[0].hash}`;
};

/**
 * Hash ausente volta para a seção padrão. Hash desconhecido (ex.: o skip link
 * "#main-content" do layout) não é navegação da Área do Atleta: mantém a seção
 * anterior em vez de jogar o atleta de volta para Inscrições.
 */
export const resolveAthleteSectionFromHash = (
  hash: string,
  previous: AthleteSectionId = DEFAULT_ATHLETE_SECTION
): AthleteSectionId => {
  const fragment = hash.replace(/^#/, '').trim().toLowerCase();
  if (!fragment) return DEFAULT_ATHLETE_SECTION;
  const match = ATHLETE_SECTIONS.find(section => section.hash === fragment);
  return match ? match.id : previous;
};

/** Id estável do cartão de inscrição, usado como alvo de rolagem. */
export const getAthleteRegistrationElementId = (registrationId: string): string =>
  `athlete-registration-${registrationId}`;

// pushState não dispara hashchange nem popstate; este evento avisa o store.
const ATHLETE_SECTION_CHANGE_EVENT = 'wodarena:athlete-section-change';

// Store guiado por eventos: a seção só muda quando um evento de navegação é
// observado, nunca porque um render releu location.hash. Um <Link> do Next
// para /admin troca a URL (limpa o hash) sem hashchange nem popstate; reler o
// hash a cada render faria a seção trocar sozinha no render seguinte.
// Onde existe Navigation API, `currententrychange` cobre esse caso e mantém URL
// e seção em sincronia. Sem ela, a seção fica como está até o próximo evento
// (limitação aceita: nunca há troca espontânea).
let currentAthleteSection: AthleteSectionId | null = null;
let athleteSectionSubscribers = 0;

const readAthleteSection = (): AthleteSectionId => {
  currentAthleteSection = resolveAthleteSectionFromHash(
    window.location.hash,
    currentAthleteSection ?? DEFAULT_ATHLETE_SECTION
  );
  return currentAthleteSection;
};

const getNavigationTarget = (): EventTarget | null => {
  const { navigation } = window as unknown as { navigation?: EventTarget };
  return navigation && typeof navigation.addEventListener === 'function' ? navigation : null;
};

export const subscribeToAthleteSection = (onStoreChange: () => void): (() => void) => {
  athleteSectionSubscribers += 1;
  readAthleteSection();

  const handleNavigation = () => {
    readAthleteSection();
    onStoreChange();
  };
  // O Next chama replaceState por conta própria para sincronizar o estado
  // interno do router; isso não é navegação do atleta e, entre duas trocas
  // rápidas, fazia a seção oscilar. Só push/traverse (e afins) realinham.
  const handleEntryChange = (event: Event) => {
    const { navigationType } = event as Event & { navigationType?: string | null };
    if (navigationType === 'replace') return;
    handleNavigation();
  };
  const navigation = getNavigationTarget();

  window.addEventListener('hashchange', handleNavigation);
  window.addEventListener('popstate', handleNavigation);
  window.addEventListener(ATHLETE_SECTION_CHANGE_EVENT, handleNavigation);
  navigation?.addEventListener('currententrychange', handleEntryChange);

  return () => {
    window.removeEventListener('hashchange', handleNavigation);
    window.removeEventListener('popstate', handleNavigation);
    window.removeEventListener(ATHLETE_SECTION_CHANGE_EVENT, handleNavigation);
    navigation?.removeEventListener('currententrychange', handleEntryChange);
    athleteSectionSubscribers = Math.max(0, athleteSectionSubscribers - 1);
    // Área desmontada: a próxima montagem parte do hash atual, não da memória.
    if (athleteSectionSubscribers === 0) currentAthleteSection = null;
  };
};

export const getAthleteSectionSnapshot = (): AthleteSectionId =>
  currentAthleteSection ?? readAthleteSection();

export const getAthleteSectionServerSnapshot = (): AthleteSectionId => DEFAULT_ATHLETE_SECTION;

/**
 * Empilha a seção no histórico (sem recarregar) e notifica o store. Não cria
 * entrada nova quando o hash já é o da seção pedida; ainda assim notifica,
 * para o store se realinhar à URL.
 */
export const pushAthleteSection = (id: AthleteSectionId): void => {
  const nextHash = getAthleteSectionHash(id);
  if (window.location.hash !== nextHash) {
    window.history.pushState(null, '', nextHash);
  }
  window.dispatchEvent(new Event(ATHLETE_SECTION_CHANGE_EVENT));
};
