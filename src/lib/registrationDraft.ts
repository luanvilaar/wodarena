// Rascunho da inscrição na aba do navegador (Story 1.134, P6 de
// docs/design/mobile-competitivo/). Fica em sessionStorage, por evento, e
// some ao fechar a aba ou depois da inscrição concluída. Senha e CPF nunca
// entram: só o que a pessoa já digitou para a categoria e os atletas.

export type RegistrationDraftParticipant = {
  name: string;
  email: string;
  phone: string;
  gender: string;
  instagram: string;
  shirtSize: string;
  birthDate: string;
  city: string;
  state: string;
};

export type RegistrationDraft = {
  divisionId: string;
  teamName: string;
  box: string;
  participants: RegistrationDraftParticipant[];
};

const PARTICIPANT_KEYS: (keyof RegistrationDraftParticipant)[] = ['name', 'email', 'phone', 'gender', 'instagram', 'shirtSize', 'birthDate', 'city', 'state'];

export const registrationDraftKey = (eventId: string) => `woda_registration_draft:${eventId}`;

const pickParticipant = (value: unknown): RegistrationDraftParticipant => {
  const source = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return Object.fromEntries(
    PARTICIPANT_KEYS.map((key) => [key, typeof source[key] === 'string' ? (source[key] as string) : ''])
  ) as RegistrationDraftParticipant;
};

// Só copia campos conhecidos: nada além disso vai para o armazenamento.
export function sanitizeRegistrationDraft(value: unknown): RegistrationDraft | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const participants = Array.isArray(source.participants) ? source.participants.slice(0, 6).map(pickParticipant) : [];
  return {
    divisionId: typeof source.divisionId === 'string' ? source.divisionId : '',
    teamName: typeof source.teamName === 'string' ? source.teamName : '',
    box: typeof source.box === 'string' ? source.box : '',
    participants,
  };
}

export function readRegistrationDraft(storage: Pick<Storage, 'getItem'> | null | undefined, eventId: string): RegistrationDraft | null {
  try {
    const raw = storage?.getItem(registrationDraftKey(eventId));
    return raw ? sanitizeRegistrationDraft(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function writeRegistrationDraft(storage: Pick<Storage, 'setItem'> | null | undefined, eventId: string, draft: RegistrationDraft): void {
  try {
    const clean = sanitizeRegistrationDraft(draft);
    if (clean) storage?.setItem(registrationDraftKey(eventId), JSON.stringify(clean));
  } catch {
    // Aba privada ou armazenamento cheio: segue sem rascunho.
  }
}

export function clearRegistrationDraft(storage: Pick<Storage, 'removeItem'> | null | undefined, eventId: string): void {
  try {
    storage?.removeItem(registrationDraftKey(eventId));
  } catch {
    // idem
  }
}
