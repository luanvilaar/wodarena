#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';

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

const parseRefundAmount = (value, required = false) => {
  if (value === null || value === undefined || value === '') {
    if (required) throw new Error('Informe --amount para registrar o reembolso manual.');
    return null;
  }

  const amount = Number(String(value).replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error('Valor de reembolso invalido.');
  }
  return amount;
};

const printHelp = () => {
  console.log(`Uso:
  npm run registrations:cli -- cancel --event EVENT_ID --registration REG_ID --reason "Solicitado pelo atleta" [--amount 60.00] [--method pix] [--note "Taxas de credito nao reembolsadas"]
  npm run registrations:cli -- refund --event EVENT_ID --registration REG_ID --amount 57.20 --method pix [--note "Comprovante enviado por WhatsApp"]
  npm run registrations:cli -- show --registration REG_ID`);
};

const showRegistration = async (supabase, args) => {
  if (!args.registration) {
    throw new Error('Informe --registration para consultar a inscricao.');
  }

  const { data, error } = await supabase
    .from('registrations')
    .select('*')
    .eq('id', args.registration)
    .maybeSingle();

  if (error || !data) throw error || new Error('Inscricao nao encontrada.');
  console.log(JSON.stringify(data, null, 2));
};

const cancelRegistration = async (supabase, args) => {
  if (!args.event || !args.registration || !args.reason) {
    throw new Error('Informe --event, --registration e --reason para cancelar.');
  }

  const refundAmount = parseRefundAmount(args.amount);
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from('registrations')
    .update({
      payment_status: 'payment_cancelled',
      payment_status_detail: 'manager_cancelled_cli',
      cancellation_reason: String(args.reason).trim(),
      cancelled_at: now,
      cancelled_by: args.actor || 'cli',
      refund_status: 'manual_pending',
      refund_amount: refundAmount,
      refund_method: args.method || null,
      refund_note: args.note || null,
      updated_at: now
    })
    .eq('id', args.registration)
    .eq('event_id', args.event)
    .select('*')
    .maybeSingle();

  if (error || !data) throw error || new Error('Inscricao nao encontrada para este evento.');

  console.log(JSON.stringify({
    success: true,
    message: 'Inscricao cancelada. Reembolso mantido como processo manual pendente; nenhum estorno Mercado Pago foi executado.',
    registration: data
  }, null, 2));
};

const markRefunded = async (supabase, args) => {
  if (!args.event || !args.registration || !args.method) {
    throw new Error('Informe --event, --registration, --amount e --method para confirmar o reembolso.');
  }

  const refundAmount = parseRefundAmount(args.amount, true);
  const now = new Date().toISOString();

  const { data: existing, error: existingError } = await supabase
    .from('registrations')
    .select('id, payment_status')
    .eq('id', args.registration)
    .eq('event_id', args.event)
    .maybeSingle();

  if (existingError || !existing) throw existingError || new Error('Inscricao nao encontrada para este evento.');
  if (existing.payment_status !== 'payment_cancelled') {
    throw new Error('Cancele a inscricao antes de marcar o reembolso manual.');
  }

  const { data, error } = await supabase
    .from('registrations')
    .update({
      refund_status: 'manual_refunded',
      refund_amount: refundAmount,
      refund_method: String(args.method).trim(),
      refund_note: args.note || null,
      refund_processed_at: now,
      refund_processed_by: args.actor || 'cli',
      updated_at: now
    })
    .eq('id', args.registration)
    .eq('event_id', args.event)
    .select('*')
    .maybeSingle();

  if (error || !data) throw error || new Error('Falha ao registrar reembolso manual.');

  console.log(JSON.stringify({
    success: true,
    message: 'Reembolso manual registrado como concluido.',
    registration: data
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

  if (command === 'show') {
    await showRegistration(supabase, args);
    return;
  }

  if (command === 'cancel') {
    await cancelRegistration(supabase, args);
    return;
  }

  if (command === 'refund') {
    await markRefunded(supabase, args);
    return;
  }

  throw new Error(`Comando desconhecido: ${command}`);
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
