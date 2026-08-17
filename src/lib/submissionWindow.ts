export type SubmissionWindowState = 'not_open' | 'open' | 'closed';

export const getSubmissionWindowState = (
  opensAt?: string | null,
  closesAt?: string | null,
  now: Date = new Date()
): SubmissionWindowState => {
  const nowMs = now.getTime();
  const opensMs = opensAt ? new Date(opensAt).getTime() : Number.NEGATIVE_INFINITY;
  const closesMs = closesAt ? new Date(closesAt).getTime() : Number.POSITIVE_INFINITY;

  if (!Number.isFinite(closesMs)) return 'closed';
  if (nowMs < opensMs) return 'not_open';
  if (nowMs > closesMs) return 'closed';
  return 'open';
};

export const getSubmissionWindowMessage = (state: SubmissionWindowState) => {
  if (state === 'not_open') return 'A janela de envio desta prova ainda não foi aberta.';
  if (state === 'closed') return 'A janela de envio desta prova foi encerrada.';
  return 'Janela de envio aberta.';
};

/**
 * O formulário administrativo não pode depender do fuso horário do navegador
 * do gestor. Os prazos de Qualifier são configurados e exibidos em Fortaleza.
 */
export const fortalezaDateTimeLocalToUtc = (dateTimeLocal?: string) => {
  if (!dateTimeLocal) return undefined;
  const normalized = dateTimeLocal.length === 16 ? `${dateTimeLocal}:00` : dateTimeLocal;
  const parsed = new Date(`${normalized}-03:00`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
};

export const normalizeQualifierSubmissionWindow = (
  submissionOpensAt?: string,
  submissionClosesAt?: string
) => {
  const opensAt = fortalezaDateTimeLocalToUtc(submissionOpensAt);
  const closesAt = fortalezaDateTimeLocalToUtc(submissionClosesAt);

  if (!closesAt) {
    throw new Error('Informe uma data e horário válidos para o prazo final de submissão.');
  }
  if (submissionOpensAt && !opensAt) {
    throw new Error('Informe uma data e horário válidos para a abertura da submissão.');
  }
  if (opensAt && new Date(opensAt).getTime() >= new Date(closesAt).getTime()) {
    throw new Error('A abertura da submissão deve ser anterior ao prazo final.');
  }

  return { opensAt, closesAt };
};

/**
 * Converte o instante persistido em UTC para o valor aceito por
 * `input[type=datetime-local]`, sempre no fuso configurado pelo Qualifier.
 */
export const utcToFortalezaDateTimeLocal = (dateTime?: string | null) => {
  if (!dateTime) return '';
  const parsed = new Date(dateTime);
  if (Number.isNaN(parsed.getTime())) return '';

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Fortaleza',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(parsed);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value || '';
  return `${value('year')}-${value('month')}-${value('day')}T${value('hour')}:${value('minute')}`;
};
