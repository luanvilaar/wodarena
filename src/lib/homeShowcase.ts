import type { Event } from '@/types';
import { getEventStatus } from '@/lib/eventStatus';

// Regra de candidato da vitrine da home (Story 1.24), compartilhada pelo controle
// em Configurações e pela fila de atenção do proprietário (Story 1.126): evento
// salvo como live ou upcoming que ainda não acabou pelo ciclo de vida do site.
export const isFeaturedHomeCandidate = (event: Pick<Event, 'status' | 'date' | 'registrationDeadline'> & Partial<Pick<Event, 'startDate' | 'endDate' | 'timeZone'>>) =>
  (event.status === 'live' || event.status === 'upcoming') && getEventStatus(event) !== 'finished';

/** Destaque salvo que saiu do carrossel; null quando não há destaque ou ele segue no ar. */
export const findFeaturedHomeEventOffAir = <T extends Pick<Event, 'isFeatured'> & Parameters<typeof isFeaturedHomeCandidate>[0]>(events: T[]): T | null => {
  const featured = events.find(event => event.isFeatured);
  return featured && !isFeaturedHomeCandidate(featured) ? featured : null;
};
