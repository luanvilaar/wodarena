import type { AppLocale, ScoreSubmissionStatus } from '@/types';
import { toBcp47 } from '@/i18n/locales';

// E-mail ao atleta sobre uma decisão no resultado do Qualifier (Story 1.108).
// Módulo puro: monta assunto, prévia, HTML e texto a partir do que a rota já leu.
// Desenho aprovado em docs/design/qualifier-decision-email/.

export type QualifierReviewDecision = 'validated' | 'penalized' | 'rejected' | 'manual_adjustment';

export type QualifierDecisionKind =
  | QualifierReviewDecision
  | 'organization_edit'
  | 'manager_entry'
  | 'resubmission_requested';

// Quem decidiu, sem nome: judge é "a arbitragem"; gestor e owner, "a organização" (D2).
export type QualifierDecisionActor = 'judge' | 'organization';

export type QualifierDecisionEmailInput = {
  locale: AppLocale;
  kind: QualifierDecisionKind;
  actor: QualifierDecisionActor;
  athleteName: string;
  eventName: string;
  workoutName: string;
  workoutType?: string | null;
  divisionName?: string | null;
  submittedResult?: string | null;
  officialResult?: string | null;
  // Edição e novo envio: como estava antes da decisão.
  previousStatus?: ScoreSubmissionStatus | null;
  previousResult?: string | null;
  // Edição: a decisão nova aplicada pela organização.
  editDecision?: QualifierReviewDecision | null;
  justification?: string | null;
  submissionClosesAt?: string | null;
  athleteAreaUrl: string;
  leaderboardUrl: string;
};

export type QualifierDecisionEmail = {
  subject: string;
  preheader: string;
  html: string;
  text: string;
};

type Tone = { ink: string; bg: string };

const TONES: Record<QualifierDecisionKind, Tone> = {
  validated: { ink: '#0b7a4f', bg: '#e3f5ec' },
  penalized: { ink: '#9a5b00', bg: '#fff1d6' },
  rejected: { ink: '#b42323', bg: '#fde6e6' },
  manual_adjustment: { ink: '#2a4fb8', bg: '#e5ecfc' },
  organization_edit: { ink: '#3c4350', bg: '#eceef1' },
  manager_entry: { ink: '#3c4350', bg: '#eceef1' },
  resubmission_requested: { ink: '#9a5b00', bg: '#fff1d6' }
};

type Copy = {
  eyebrow: string;
  hello: string;
  actor: Record<QualifierDecisionActor, string>;
  seal: Record<QualifierDecisionKind, string>;
  title: Record<QualifierDecisionKind, string>;
  subject: Record<QualifierDecisionKind, string>;
  intro: Record<QualifierDecisionKind, (actor: string, workout: string) => string>;
  preheader: Record<QualifierDecisionKind, (official: string, workout: string) => string>;
  status: Record<ScoreSubmissionStatus, string>;
  decision: Record<QualifierReviewDecision, string>;
  sent: string;
  before: string;
  official: string;
  situation: string;
  athleteEntry: string;
  noVideo: string;
  previousEntry: string;
  awaiting: string;
  workout: string;
  division: string;
  rule: string;
  ruleTime: string;
  ruleOther: string;
  ranking: string;
  rankingRejected: string;
  decisionRow: string;
  newSituation: string;
  origin: string;
  originValue: string;
  deadline: string;
  note: Record<QualifierDecisionActor, string>;
  next: string;
  nextText: Record<QualifierDecisionKind, string>;
  cta: Record<QualifierDecisionKind, string>;
  footer: (event: string) => string;
};

const PT_BR: Copy = {
  eyebrow: 'Qualifier online',
  hello: 'Olá',
  actor: { judge: 'A arbitragem', organization: 'A organização do evento' },
  seal: {
    validated: 'Validado',
    penalized: 'Penalizado −15%',
    rejected: 'Rejeitado',
    manual_adjustment: 'Ajustado',
    organization_edit: 'Alterado',
    manager_entry: 'Lançado pela organização',
    resubmission_requested: 'Novo envio'
  },
  title: {
    validated: 'Seu resultado foi validado',
    penalized: 'Seu resultado recebeu penalidade',
    rejected: 'Seu resultado não foi aceito',
    manual_adjustment: 'Seu resultado foi ajustado',
    organization_edit: 'A organização alterou seu resultado',
    manager_entry: 'A organização lançou seu resultado',
    resubmission_requested: 'Precisamos de um novo envio'
  },
  subject: {
    validated: 'Resultado validado',
    penalized: 'Resultado penalizado em 15%',
    rejected: 'Resultado rejeitado',
    manual_adjustment: 'Resultado ajustado',
    organization_edit: 'A organização alterou seu resultado',
    manager_entry: 'A organização lançou seu resultado',
    resubmission_requested: 'Envie de novo o resultado'
  },
  intro: {
    validated: (a, w) => `${a} conferiu o vídeo da prova <strong>${w}</strong> e confirmou o resultado que você enviou.`,
    penalized: (a, w) => `${a} encontrou falhas de padrão no vídeo da prova <strong>${w}</strong> e aplicou a penalidade de 15% prevista no regulamento.`,
    rejected: (a, w) => `${a} não conseguiu validar o resultado enviado na prova <strong>${w}</strong>, e ele foi rejeitado.`,
    manual_adjustment: (a, w) => `${a} conferiu o vídeo da prova <strong>${w}</strong> e registrou um resultado diferente do enviado.`,
    organization_edit: (_a, w) => `A organização do evento revisou a decisão anterior da prova <strong>${w}</strong>.`,
    manager_entry: (_a, w) => `A organização do evento registrou o seu resultado da prova <strong>${w}</strong>.`,
    resubmission_requested: (_a, w) => `A organização do evento removeu o resultado da prova <strong>${w}</strong> e pediu que você envie de novo.`
  },
  preheader: {
    validated: (o, w) => `Seu resultado na ${w} (${o}) foi conferido e já conta no ranking.`,
    penalized: (o, w) => `A penalidade de 15% foi aplicada na ${w}. Resultado oficial: ${o}.`,
    rejected: (_o, w) => `Seu envio na ${w} não foi validado. Veja o motivo e como contestar.`,
    manual_adjustment: (o, w) => `O resultado oficial da ${w} ficou em ${o}.`,
    organization_edit: (o, w) => `Seu resultado na ${w} mudou. Resultado oficial: ${o}.`,
    manager_entry: (o, w) => `Seu resultado da ${w} foi registrado pela organização: ${o}.`,
    resubmission_requested: (_o, w) => `A organização pediu um novo envio da ${w} dentro do prazo.`
  },
  status: {
    pending_review: 'Em análise',
    validated: 'Validado',
    penalized: 'Penalizado',
    rejected: 'Rejeitado',
    awaiting_resubmission: 'Aguardando novo envio'
  },
  decision: {
    validated: 'Validado',
    penalized: 'Penalizado (−15%)',
    rejected: 'Rejeitado',
    manual_adjustment: 'Ajustado'
  },
  sent: 'Você enviou',
  before: 'Antes',
  official: 'Resultado oficial',
  situation: 'Situação',
  athleteEntry: 'Envio do atleta',
  noVideo: 'Sem vídeo',
  previousEntry: 'Envio anterior',
  awaiting: 'Aguardando',
  workout: 'Prova',
  division: 'Categoria',
  rule: 'Regra',
  ruleTime: '+15% no tempo enviado',
  ruleOther: '−15% sobre o resultado enviado',
  ranking: 'No ranking',
  rankingRejected: 'Conta como a última colocação da categoria',
  decisionRow: 'Decisão',
  newSituation: 'Situação nova',
  origin: 'Origem',
  originValue: 'Lançado pela organização',
  deadline: 'Prazo de envio',
  note: { judge: 'Observação da arbitragem', organization: 'Observação da organização' },
  next: 'O que fazer agora',
  nextText: {
    validated: 'Nada a fazer. O ranking da categoria é atualizado automaticamente.',
    penalized: 'Se discordar, abra uma contestação pela sua área do atleta. Cada contestação usa um crédito da sua inscrição.',
    rejected: 'Se discordar, abra uma contestação pela sua área do atleta. Cada contestação usa um crédito da sua inscrição.',
    manual_adjustment: 'Se discordar, abra uma contestação pela sua área do atleta. Cada contestação usa um crédito da sua inscrição.',
    organization_edit: 'Se discordar, abra uma contestação pela sua área do atleta. Cada contestação usa um crédito da sua inscrição.',
    manager_entry: 'Confira o resultado. Se houver erro, abra uma contestação pela sua área do atleta.',
    resubmission_requested: 'Envie o novo vídeo e o resultado pela sua área do atleta antes do fim do prazo.'
  },
  cta: {
    validated: 'Ver ranking da categoria',
    penalized: 'Ver detalhes e contestar',
    rejected: 'Ver detalhes e contestar',
    manual_adjustment: 'Ver detalhes e contestar',
    organization_edit: 'Ver detalhes e contestar',
    manager_entry: 'Ver na área do atleta',
    resubmission_requested: 'Enviar novo resultado'
  },
  footer: (e) => `Você recebeu esta mensagem porque tem inscrição no <strong>${e}</strong>. A decisão também fica na sua área do atleta, na WODArena.`
};

const PT_PT: Copy = {
  ...PT_BR,
  hello: 'Olá',
  actor: { judge: 'A arbitragem', organization: 'A organização do evento' },
  title: {
    validated: 'O seu resultado foi validado',
    penalized: 'O seu resultado recebeu penalização',
    rejected: 'O seu resultado não foi aceite',
    manual_adjustment: 'O seu resultado foi ajustado',
    organization_edit: 'A organização alterou o seu resultado',
    manager_entry: 'A organização registou o seu resultado',
    resubmission_requested: 'Precisamos de um novo envio'
  },
  seal: { ...PT_BR.seal, penalized: 'Penalizado −15%', manager_entry: 'Registado pela organização' },
  subject: {
    validated: 'Resultado validado',
    penalized: 'Resultado penalizado em 15%',
    rejected: 'Resultado rejeitado',
    manual_adjustment: 'Resultado ajustado',
    organization_edit: 'A organização alterou o seu resultado',
    manager_entry: 'A organização registou o seu resultado',
    resubmission_requested: 'Envie novamente o resultado'
  },
  intro: {
    validated: (a, w) => `${a} verificou o vídeo da prova <strong>${w}</strong> e confirmou o resultado que enviou.`,
    penalized: (a, w) => `${a} encontrou falhas de padrão no vídeo da prova <strong>${w}</strong> e aplicou a penalização de 15% prevista no regulamento.`,
    rejected: (a, w) => `${a} não conseguiu validar o resultado enviado na prova <strong>${w}</strong>, e este foi rejeitado.`,
    manual_adjustment: (a, w) => `${a} verificou o vídeo da prova <strong>${w}</strong> e registou um resultado diferente do enviado.`,
    organization_edit: (_a, w) => `A organização do evento reviu a decisão anterior da prova <strong>${w}</strong>.`,
    manager_entry: (_a, w) => `A organização do evento registou o seu resultado da prova <strong>${w}</strong>.`,
    resubmission_requested: (_a, w) => `A organização do evento removeu o resultado da prova <strong>${w}</strong> e pediu que envie novamente.`
  },
  preheader: {
    validated: (o, w) => `O seu resultado na ${w} (${o}) foi verificado e já conta para o ranking.`,
    penalized: (o, w) => `A penalização de 15% foi aplicada na ${w}. Resultado oficial: ${o}.`,
    rejected: (_o, w) => `O seu envio na ${w} não foi validado. Veja o motivo e como contestar.`,
    manual_adjustment: (o, w) => `O resultado oficial da ${w} ficou em ${o}.`,
    organization_edit: (o, w) => `O seu resultado na ${w} mudou. Resultado oficial: ${o}.`,
    manager_entry: (o, w) => `O seu resultado da ${w} foi registado pela organização: ${o}.`,
    resubmission_requested: (_o, w) => `A organização pediu um novo envio da ${w} dentro do prazo.`
  },
  decision: { ...PT_BR.decision, penalized: 'Penalizado (−15%)' },
  sent: 'Enviou',
  athleteEntry: 'Envio do atleta',
  rankingRejected: 'Conta como a última posição da categoria',
  originValue: 'Registado pela organização',
  nextText: {
    validated: 'Nada a fazer. O ranking da categoria é atualizado automaticamente.',
    penalized: 'Se discordar, abra uma contestação na sua área de atleta. Cada contestação usa um crédito da sua inscrição.',
    rejected: 'Se discordar, abra uma contestação na sua área de atleta. Cada contestação usa um crédito da sua inscrição.',
    manual_adjustment: 'Se discordar, abra uma contestação na sua área de atleta. Cada contestação usa um crédito da sua inscrição.',
    organization_edit: 'Se discordar, abra uma contestação na sua área de atleta. Cada contestação usa um crédito da sua inscrição.',
    manager_entry: 'Confira o resultado. Se houver erro, abra uma contestação na sua área de atleta.',
    resubmission_requested: 'Envie o novo vídeo e o resultado na sua área de atleta antes do fim do prazo.'
  },
  cta: { ...PT_BR.cta, manager_entry: 'Ver na área de atleta' },
  footer: (e) => `Recebeu esta mensagem porque tem inscrição no <strong>${e}</strong>. A decisão também fica na sua área de atleta, na WODArena.`
};

const EN_GB: Copy = {
  eyebrow: 'Online qualifier',
  hello: 'Hello',
  actor: { judge: 'The judges', organization: 'The event organisers' },
  seal: {
    validated: 'Validated',
    penalized: 'Penalised −15%',
    rejected: 'Rejected',
    manual_adjustment: 'Adjusted',
    organization_edit: 'Changed',
    manager_entry: 'Entered by organisers',
    resubmission_requested: 'Resubmit'
  },
  title: {
    validated: 'Your score has been validated',
    penalized: 'Your score has been penalised',
    rejected: 'Your score was not accepted',
    manual_adjustment: 'Your score has been adjusted',
    organization_edit: 'The organisers changed your score',
    manager_entry: 'The organisers entered your score',
    resubmission_requested: 'Please submit again'
  },
  subject: {
    validated: 'Score validated',
    penalized: 'Score penalised by 15%',
    rejected: 'Score rejected',
    manual_adjustment: 'Score adjusted',
    organization_edit: 'The organisers changed your score',
    manager_entry: 'The organisers entered your score',
    resubmission_requested: 'Please resubmit your score'
  },
  intro: {
    validated: (a, w) => `${a} checked your video for <strong>${w}</strong> and confirmed the score you submitted.`,
    penalized: (a, w) => `${a} found movement standard faults in your video for <strong>${w}</strong> and applied the 15% penalty set out in the rulebook.`,
    rejected: (a, w) => `${a} could not validate the score you submitted for <strong>${w}</strong>, so it was rejected.`,
    manual_adjustment: (a, w) => `${a} checked your video for <strong>${w}</strong> and recorded a different score from the one submitted.`,
    organization_edit: (_a, w) => `The event organisers reviewed the previous decision for <strong>${w}</strong>.`,
    manager_entry: (_a, w) => `The event organisers recorded your score for <strong>${w}</strong>.`,
    resubmission_requested: (_a, w) => `The event organisers removed your score for <strong>${w}</strong> and asked you to submit again.`
  },
  preheader: {
    validated: (o, w) => `Your ${w} score (${o}) has been checked and now counts on the leaderboard.`,
    penalized: (o, w) => `The 15% penalty was applied to ${w}. Official score: ${o}.`,
    rejected: (_o, w) => `Your ${w} submission was not validated. See why and how to appeal.`,
    manual_adjustment: (o, w) => `Your official ${w} score is ${o}.`,
    organization_edit: (o, w) => `Your ${w} score has changed. Official score: ${o}.`,
    manager_entry: (o, w) => `Your ${w} score was entered by the organisers: ${o}.`,
    resubmission_requested: (_o, w) => `The organisers asked for a new ${w} submission before the deadline.`
  },
  status: {
    pending_review: 'Under review',
    validated: 'Validated',
    penalized: 'Penalised',
    rejected: 'Rejected',
    awaiting_resubmission: 'Awaiting resubmission'
  },
  decision: {
    validated: 'Validated',
    penalized: 'Penalised (−15%)',
    rejected: 'Rejected',
    manual_adjustment: 'Adjusted'
  },
  sent: 'You submitted',
  before: 'Before',
  official: 'Official score',
  situation: 'Status',
  athleteEntry: 'Athlete submission',
  noVideo: 'No video',
  previousEntry: 'Previous submission',
  awaiting: 'Pending',
  workout: 'Workout',
  division: 'Division',
  rule: 'Rule',
  ruleTime: '+15% on the submitted time',
  ruleOther: '−15% on the submitted score',
  ranking: 'Leaderboard',
  rankingRejected: 'Counts as last place in the division',
  decisionRow: 'Decision',
  newSituation: 'New status',
  origin: 'Source',
  originValue: 'Entered by organisers',
  deadline: 'Submission deadline',
  note: { judge: 'Note from the judges', organization: 'Note from the organisers' },
  next: 'What to do next',
  nextText: {
    validated: 'Nothing to do. The division leaderboard updates automatically.',
    penalized: 'If you disagree, open an appeal from your athlete area. Each appeal uses one credit from your registration.',
    rejected: 'If you disagree, open an appeal from your athlete area. Each appeal uses one credit from your registration.',
    manual_adjustment: 'If you disagree, open an appeal from your athlete area. Each appeal uses one credit from your registration.',
    organization_edit: 'If you disagree, open an appeal from your athlete area. Each appeal uses one credit from your registration.',
    manager_entry: 'Check the score. If something is wrong, open an appeal from your athlete area.',
    resubmission_requested: 'Send the new video and score from your athlete area before the deadline.'
  },
  cta: {
    validated: 'View division leaderboard',
    penalized: 'See details and appeal',
    rejected: 'See details and appeal',
    manual_adjustment: 'See details and appeal',
    organization_edit: 'See details and appeal',
    manager_entry: 'Open athlete area',
    resubmission_requested: 'Submit new score'
  },
  footer: (e) => `You received this message because you are registered for <strong>${e}</strong>. The decision is also shown in your WODArena athlete area.`
};

const COPY: Record<AppLocale, Copy> = { 'pt-br': PT_BR, 'pt-pt': PT_PT, 'en-gb': EN_GB };

export const QUALIFIER_DECISION_KINDS = Object.keys(TONES) as QualifierDecisionKind[];

export const getQualifierDecisionActor = (role: string): QualifierDecisionActor =>
  role === 'judge' ? 'judge' : 'organization';

const escapeHtml = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

const clean = (value?: string | null) => (typeof value === 'string' ? value.trim() : '');

// Prazos do Qualifier são configurados e exibidos no fuso de Fortaleza (submissionWindow.ts).
const formatDeadline = (iso: string, locale: AppLocale) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(toBcp47(locale), {
    timeZone: 'America/Fortaleza',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
};

type Ledger = { fromLabel: string; fromValue: string; toLabel: string; toValue: string; changed: boolean };

const buildLedger = (input: QualifierDecisionEmailInput, c: Copy): Ledger => {
  const submitted = clean(input.submittedResult);
  const official = clean(input.officialResult);
  const previous = clean(input.previousResult);
  if (input.kind === 'organization_edit') {
    const label = input.previousStatus ? `${c.before} · ${c.status[input.previousStatus]}` : c.before;
    return { fromLabel: label, fromValue: previous || '—', toLabel: c.official, toValue: official || '—', changed: previous !== official };
  }
  if (input.kind === 'manager_entry') {
    return { fromLabel: c.athleteEntry, fromValue: c.noVideo, toLabel: c.official, toValue: official || '—', changed: false };
  }
  if (input.kind === 'resubmission_requested') {
    // Sem resultado oficial até o novo envio: o lado direito é a situação.
    return { fromLabel: c.previousEntry, fromValue: previous || submitted || '—', toLabel: c.situation, toValue: c.awaiting, changed: true };
  }
  return { fromLabel: c.sent, fromValue: submitted || '—', toLabel: c.official, toValue: official || '—', changed: submitted !== official };
};

const buildRows = (input: QualifierDecisionEmailInput, c: Copy): Array<[string, string]> => {
  const rows: Array<[string, string]> = [[c.workout, clean(input.workoutName)]];
  const division = clean(input.divisionName);
  if (division) rows.push([c.division, division]);
  switch (input.kind) {
    case 'penalized':
      rows.push([c.rule, input.workoutType === 'fortime' ? c.ruleTime : c.ruleOther]);
      rows.push([c.decisionRow, c.decision.penalized]);
      break;
    case 'rejected':
      rows.push([c.ranking, c.rankingRejected]);
      rows.push([c.decisionRow, c.decision.rejected]);
      break;
    case 'validated':
    case 'manual_adjustment':
      rows.push([c.decisionRow, c.decision[input.kind]]);
      break;
    case 'organization_edit':
      if (input.editDecision) rows.push([c.newSituation, c.decision[input.editDecision]]);
      break;
    case 'manager_entry':
      rows.push([c.origin, c.originValue]);
      break;
    case 'resubmission_requested': {
      const deadline = input.submissionClosesAt ? formatDeadline(input.submissionClosesAt, input.locale) : '';
      if (deadline) rows.push([c.deadline, deadline]);
      break;
    }
  }
  return rows;
};

export const buildQualifierDecisionEmail = (input: QualifierDecisionEmailInput): QualifierDecisionEmail => {
  const c = COPY[input.locale] ?? PT_BR;
  const tone = TONES[input.kind];
  const athleteName = clean(input.athleteName) || 'Atleta';
  const eventName = clean(input.eventName) || 'WODArena';
  const workoutName = clean(input.workoutName) || c.workout;
  const justification = clean(input.justification);
  const ledger = buildLedger(input, c);
  const rows = buildRows({ ...input, workoutName }, c);
  const ctaUrl = input.kind === 'validated' ? input.leaderboardUrl : input.athleteAreaUrl;
  const actor = c.actor[input.actor];

  const subject = `${c.subject[input.kind]} · ${workoutName} · ${eventName}`;
  const preheader = c.preheader[input.kind](ledger.toValue, workoutName);

  const e = escapeHtml;
  const font = 'Arial, Helvetica, sans-serif';
  const label = `font-family:${font};font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#5e6673;`;
  const fromStyle = ledger.changed
    ? 'color:#5e6673;text-decoration:line-through;font-weight:700;'
    : 'color:#181a20;font-weight:800;';
  const toColor = ledger.changed ? tone.ink : '#181a20';

  const rowsHtml = rows.map(([key, value], index) => `
                <tr>
                  <td style="${label}padding:9px 16px;width:38%;vertical-align:top;${index ? 'border-top:1px solid #e6e8eb;' : ''}">${e(key)}</td>
                  <td style="font-family:${font};font-size:13px;font-weight:700;color:#181a20;padding:9px 16px;vertical-align:top;${index ? 'border-top:1px solid #e6e8eb;' : ''}">${e(value)}</td>
                </tr>`).join('');

  const noteHtml = justification ? `
          <tr><td style="padding:0 24px 18px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
              <tr><td style="border-left:4px solid ${tone.ink};background:#f7f8f9;padding:12px 14px;">
                <div style="${label}color:#181a20;">${e(c.note[input.actor])}</div>
                <div style="font-family:${font};font-size:14px;line-height:1.55;color:#181a20;padding-top:4px;white-space:pre-line;">${e(justification)}</div>
              </td></tr>
            </table>
          </td></tr>` : '';

  const html = `<!DOCTYPE html>
<html lang="${toBcp47(input.locale)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${e(c.title[input.kind])} - WODArena</title>
</head>
<body style="margin:0;padding:0;background:#f2f3f5;">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${e(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f3f5;border-collapse:collapse;">
  <tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid #e6e8eb;border-radius:12px;border-collapse:separate;overflow:hidden;">
      <tr><td style="background:#181a20;border-bottom:4px solid #fcd535;padding:18px 24px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr>
          <td style="font-family:${font};color:#fcd535;font-weight:900;letter-spacing:0.16em;font-size:18px;">WODARENA</td>
          <td align="right" style="font-family:${font};color:#c9ced6;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;font-weight:700;">${e(c.eyebrow)}</td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:28px 24px 0;">
        <span style="display:inline-block;border:2px solid ${tone.ink};color:${tone.ink};background:${tone.bg};border-radius:4px;padding:5px 10px;font-family:${font};font-weight:900;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;">${e(c.seal[input.kind])}</span>
      </td></tr>
      <tr><td style="padding:16px 24px 0;font-family:${font};font-size:24px;line-height:1.15;font-weight:800;color:#181a20;">${e(c.title[input.kind])}</td></tr>
      <tr><td style="padding:12px 24px 18px;font-family:${font};font-size:14px;line-height:1.6;color:#5e6673;">${e(c.hello)}, <strong style="color:#181a20;">${e(athleteName)}</strong>. ${c.intro[input.kind](e(actor), e(workoutName))}</td></tr>
      <tr><td style="padding:0 24px 18px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e6e8eb;border-radius:10px;border-collapse:separate;">
          <tr><td colspan="2" style="padding:16px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr>
              <td style="vertical-align:top;">
                <div style="${label}">${e(ledger.fromLabel)}</div>
                <div style="font-family:${font};font-size:22px;padding-top:3px;${fromStyle}">${e(ledger.fromValue)}</div>
              </td>
              <td style="vertical-align:middle;text-align:center;width:32px;font-family:${font};font-size:18px;color:#5e6673;">&rarr;</td>
              <td style="vertical-align:top;text-align:right;">
                <div style="${label}">${e(ledger.toLabel)}</div>
                <div style="font-family:${font};font-size:22px;font-weight:800;padding-top:3px;color:${toColor};">${e(ledger.toValue)}</div>
              </td>
            </tr></table>
          </td></tr>
          <tr><td colspan="2" style="border-top:1px solid #e6e8eb;padding:0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${rowsHtml}
            </table>
          </td></tr>
        </table>
      </td></tr>${noteHtml}
      <tr><td style="padding:0 24px 6px;"><div style="${label}color:#181a20;">${e(c.next)}</div></td></tr>
      <tr><td style="padding:0 24px 20px;font-family:${font};font-size:14px;line-height:1.6;color:#5e6673;">${e(c.nextText[input.kind])}</td></tr>
      <tr><td style="padding:0 24px 28px;">
        <a href="${e(ctaUrl)}" style="display:inline-block;background:#fcd535;color:#181a20;text-decoration:none;font-family:${font};font-weight:800;font-size:14px;line-height:18px;padding:13px 20px;border-radius:6px;">${e(c.cta[input.kind])}</a>
      </td></tr>
      <tr><td style="border-top:1px solid #e6e8eb;background:#fafafa;padding:16px 24px;font-family:${font};font-size:11px;line-height:1.55;color:#5e6673;">${c.footer(e(eventName))}</td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;

  const text = [
    c.title[input.kind],
    '',
    `${c.hello}, ${athleteName}. ${c.intro[input.kind](actor, workoutName).replace(/<\/?strong>/g, '')}`,
    '',
    `${ledger.fromLabel}: ${ledger.fromValue}`,
    `${ledger.toLabel}: ${ledger.toValue}`,
    ...rows.map(([key, value]) => `${key}: ${value}`),
    ...(justification ? ['', `${c.note[input.actor]}:`, justification] : []),
    '',
    `${c.next}: ${c.nextText[input.kind]}`,
    `${c.cta[input.kind]}: ${ctaUrl}`,
    '',
    c.footer(eventName).replace(/<\/?strong>/g, '')
  ].join('\n');

  return { subject, preheader, html, text };
};
