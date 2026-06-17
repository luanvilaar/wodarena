#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';

const CONTESTATION_CREDITS_LIMIT = 2;

const getRequiredEnv = (name) => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variavel de ambiente obrigatoria ausente: ${name}`);
  }
  return value;
};

const getSupabaseAdmin = () => createClient(
  getRequiredEnv('SUPABASE_URL'),
  getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  }
);

const parseArgs = (argv) => {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = 'true';
      continue;
    }
    args[key] = next;
    index += 1;
  }
  return args;
};

const parseScheduleItems = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

const findHeat = (scheduleItems, workoutId, heatId) => (
  scheduleItems.find(item => item.kind === 'heat' && item.workoutId === workoutId && item.id === heatId)
);

const getStatusLabel = (status) => {
  if (status === 'approved') return 'Deferida';
  if (status === 'rejected') return 'Indeferida';
  return 'Em analise';
};

const calculateCredits = (contestations) => {
  const used = contestations.filter(contestation => contestation.credit_consumed !== false).length;
  const refunded = contestations.filter(contestation => contestation.credit_refunded === true).length;
  const available = Math.max(0, CONTESTATION_CREDITS_LIMIT - used + refunded);
  return { limit: CONTESTATION_CREDITS_LIMIT, used, refunded, available };
};

const escapeHtml = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

const sendContestationStatusEmail = async ({
  toEmail,
  athleteName,
  eventName,
  workoutName,
  heatLabel,
  lane,
  status,
  creditRefunded,
  managerNote
}) => {
  const apiKey = process.env.RESEND_API_KEY || process.env.RESENDAPI_KEY;
  if (!apiKey || !toEmail) {
    return { success: false, error: 'E-mail ou chave Resend ausente.' };
  }

  const creditMessage = status === 'approved'
    ? (creditRefunded
      ? 'Seu credito utilizado foi devolvido pela organizacao.'
      : 'Sua contestacao foi deferida, mas o credito utilizado segue consumido conforme regra definida pela organizacao.')
    : status === 'rejected'
      ? 'Sua contestacao foi indeferida e o credito utilizado foi perdido.'
      : 'Sua contestacao segue em analise pela organizacao.';

  const html = `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Atualizacao da contestacao - WODArena</title>
    </head>
    <body style="font-family: Arial, sans-serif; background:#f5f5f5; color:#181a20; margin:0; padding:24px;">
      <div style="max-width:560px; margin:0 auto; background:#fff; border:1px solid #eaecef; border-radius:12px; overflow:hidden;">
        <div style="background:#181a20; border-bottom:3px solid #FCD535; padding:20px; text-align:center; color:#FCD535; font-weight:900; letter-spacing:.12em; text-transform:uppercase;">WODArena</div>
        <div style="padding:24px;">
          <p style="font-size:12px; font-weight:700; text-transform:uppercase; color:#8a6a00;">Contestacao de prova</p>
          <h1 style="font-size:22px; margin:0 0 12px;">Status atualizado</h1>
          <p>Olá, <strong>${escapeHtml(athleteName)}</strong>. Sua contestacao no evento <strong>${escapeHtml(eventName)}</strong> foi atualizada.</p>
          <p><strong>Status:</strong> ${escapeHtml(getStatusLabel(status))}</p>
          <p><strong>Prova:</strong> ${escapeHtml(workoutName)}</p>
          <p><strong>Bateria:</strong> ${escapeHtml(heatLabel)}</p>
          <p><strong>Raia:</strong> ${escapeHtml(lane)}</p>
          <p>${escapeHtml(creditMessage)}</p>
          ${managerNote ? `<p><strong>Observacao da organizacao:</strong><br>${escapeHtml(managerNote)}</p>` : ''}
        </div>
      </div>
    </body>
    </html>
  `;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_EMAIL || 'WODArena <noreply@wodarena.com.br>',
      to: toEmail,
      subject: `Atualizacao da contestacao - ${eventName}`,
      html
    })
  });

  if (!response.ok) {
    const body = await response.text();
    return { success: false, error: body || `HTTP ${response.status}` };
  }

  const data = await response.json();
  return { success: true, messageId: data.id };
};

const printHelp = () => {
  console.log(`Uso:
  npm run contestations:cli -- list --event EVENT_ID [--status under_review|approved|rejected] [--registration REG_ID]
  npm run contestations:cli -- create --event EVENT_ID --registration REG_ID --workout WORKOUT_ID --heat HEAT_ID --lane LANE --description "Texto"
  npm run contestations:cli -- update-status --id CONTESTATION_ID --status under_review|approved|rejected [--refund true|false] [--note "Mensagem"]`);
};

const listContestations = async (supabase, args) => {
  if (!args.event) {
    throw new Error('Informe --event para listar contestacoes.');
  }

  let query = supabase
    .from('contestations')
    .select('*')
    .eq('event_id', args.event)
    .order('created_at', { ascending: false });

  if (args.status) query = query.eq('status', args.status);
  if (args.registration) query = query.eq('registration_id', args.registration);

  const { data, error } = await query;
  if (error) throw error;

  console.log(JSON.stringify(data || [], null, 2));
};

const createContestation = async (supabase, args) => {
  const required = ['event', 'registration', 'workout', 'heat', 'lane', 'description'];
  const missing = required.filter(key => !args[key]);
  if (missing.length > 0) {
    throw new Error(`Parametros obrigatorios ausentes: ${missing.join(', ')}`);
  }

  const { data: registration, error: registrationError } = await supabase
    .from('registrations')
    .select('id, event_id, user_id, athlete_id, payment_status')
    .eq('id', args.registration)
    .eq('event_id', args.event)
    .maybeSingle();
  if (registrationError || !registration) throw new Error('Inscricao nao encontrada.');
  if ((registration.payment_status || 'payment_approved') !== 'payment_approved') {
    throw new Error('Contestacao disponivel apenas para inscricoes com pagamento aprovado.');
  }

  const { data: event, error: eventError } = await supabase
    .from('events')
    .select('id, event_type, event_schedule')
    .eq('id', args.event)
    .maybeSingle();
  if (eventError || !event) throw new Error('Evento nao encontrado.');
  if ((event.event_type || 'functional_fitness') !== 'functional_fitness') {
    throw new Error('Contestacao disponivel apenas para eventos de Functional Fitness.');
  }

  const { data: workout, error: workoutError } = await supabase
    .from('workouts')
    .select('id, event_id')
    .eq('id', args.workout)
    .eq('event_id', args.event)
    .maybeSingle();
  if (workoutError || !workout) throw new Error('Prova nao encontrada para o evento.');

  const heat = findHeat(parseScheduleItems(event.event_schedule), args.workout, args.heat);
  if (!heat) throw new Error('Bateria nao encontrada para a prova selecionada.');

  const { data: existingRows, error: contestationsError } = await supabase
    .from('contestations')
    .select('*')
    .eq('registration_id', args.registration)
    .eq('event_id', args.event);
  if (contestationsError) throw contestationsError;

  const credits = calculateCredits(existingRows || []);
  if (credits.available <= 0) {
    throw new Error('Todos os creditos de contestacao ja foram utilizados para esta inscricao.');
  }

  const payload = {
    id: `contest-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    event_id: args.event,
    registration_id: args.registration,
    user_id: registration.user_id,
    athlete_id: registration.athlete_id || null,
    workout_id: args.workout,
    heat_id: args.heat,
    heat_number: heat.heatNumber || null,
    lane: args.lane,
    description: args.description,
    status: 'under_review',
    credit_consumed: true,
    credit_refunded: false,
    manager_note: null,
    resolved_at: null
  };

  const { data: inserted, error: insertError } = await supabase
    .from('contestations')
    .insert(payload)
    .select('*')
    .maybeSingle();
  if (insertError || !inserted) throw insertError || new Error('Falha ao registrar contestacao.');

  console.log(JSON.stringify({
    success: true,
    message: 'Sua contestacao foi registrada com sucesso. A organizacao analisara as informacoes enviadas e avaliara o caso. Fique atento ao e-mail cadastrado, pois todas as atualizacoes sobre este recurso serao comunicadas por ele. Obrigado pela sua colaboracao.',
    contestation: inserted
  }, null, 2));
};

const updateContestationStatus = async (supabase, args) => {
  if (!args.id || !args.status) {
    throw new Error('Informe --id e --status para atualizar a contestacao.');
  }
  if (!['under_review', 'approved', 'rejected'].includes(args.status)) {
    throw new Error('Status invalido. Use under_review, approved ou rejected.');
  }

  const refundRequested = args.refund === 'true';
  if (refundRequested && args.status !== 'approved') {
    throw new Error('A devolucao de credito so pode ocorrer em contestacao deferida.');
  }

  const { data: existing, error: existingError } = await supabase
    .from('contestations')
    .select('*')
    .eq('id', args.id)
    .maybeSingle();
  if (existingError || !existing) throw new Error('Contestacao nao encontrada.');

  const payload = {
    status: args.status,
    credit_refunded: args.status === 'approved' ? refundRequested : false,
    manager_note: args.note || null,
    resolved_at: args.status === 'under_review' ? null : new Date().toISOString()
  };

  const { data: updated, error: updateError } = await supabase
    .from('contestations')
    .update(payload)
    .eq('id', args.id)
    .select('*')
    .maybeSingle();
  if (updateError || !updated) throw updateError || new Error('Falha ao atualizar contestacao.');

  const [{ data: registration }, { data: event }, { data: workout }] = await Promise.all([
    supabase.from('registrations').select('athlete_email, athlete_name').eq('id', updated.registration_id).maybeSingle(),
    supabase.from('events').select('name').eq('id', updated.event_id).maybeSingle(),
    supabase.from('workouts').select('name').eq('id', updated.workout_id).maybeSingle()
  ]);

  const emailResult = registration?.athlete_email
    ? await sendContestationStatusEmail({
      toEmail: registration.athlete_email,
      athleteName: registration.athlete_name || 'Atleta',
      eventName: event?.name || 'Evento WODArena',
      workoutName: workout?.name || 'Prova',
      heatLabel: updated.heat_number ? `Bateria ${updated.heat_number}` : 'Bateria informada pelo atleta',
      lane: updated.lane,
      status: updated.status,
      creditRefunded: updated.credit_refunded === true,
      managerNote: updated.manager_note || ''
    })
    : { success: false, error: 'E-mail do atleta ausente.' };

  console.log(JSON.stringify({
    success: true,
    contestation: updated,
    emailDelivered: emailResult.success === true,
    emailError: emailResult.success ? null : emailResult.error
  }, null, 2));
};

const main = async () => {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === 'help' || command === '--help') {
    printHelp();
    return;
  }

  const args = parseArgs(rest);
  const supabase = getSupabaseAdmin();

  if (command === 'list') {
    await listContestations(supabase, args);
    return;
  }
  if (command === 'create') {
    await createContestation(supabase, args);
    return;
  }
  if (command === 'update-status') {
    await updateContestationStatus(supabase, args);
    return;
  }

  throw new Error(`Comando desconhecido: ${command}`);
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
