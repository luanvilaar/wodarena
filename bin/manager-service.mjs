#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const EXPIRING_SOON_DAYS = 7;

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

const normalizeServiceValidUntil = (value) => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  if (!DATE_PATTERN.test(trimmed)) {
    throw new Error('A validade deve estar no formato YYYY-MM-DD.');
  }
  return trimmed;
};

const getCurrentBusinessDate = () => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Fortaleza',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());

  const year = parts.find((part) => part.type === 'year')?.value || '1970';
  const month = parts.find((part) => part.type === 'month')?.value || '01';
  const day = parts.find((part) => part.type === 'day')?.value || '01';
  return `${year}-${month}-${day}`;
};

const addDaysToDateString = (value, days) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
};

const getManagerAccessStatus = (serviceValidUntil) => {
  if (!serviceValidUntil) return 'unconfigured';
  const today = getCurrentBusinessDate();
  if (serviceValidUntil < today) return 'expired';
  if (serviceValidUntil <= addDaysToDateString(today, EXPIRING_SOON_DAYS)) {
    return 'expiring_soon';
  }
  return 'active';
};

const printHelp = () => {
  console.log(`Uso:
  npm run manager-service:cli -- list
  npm run manager-service:cli -- show --user USER_ID
  npm run manager-service:cli -- show --email gestor@email.com
  npm run manager-service:cli -- update --user USER_ID --valid-until YYYY-MM-DD
  npm run manager-service:cli -- clear --user USER_ID`);
};

const findManager = async (supabase, args) => {
  if (!args.user && !args.email) {
    throw new Error('Informe --user ou --email para localizar o gestor.');
  }

  let query = supabase
    .from('users')
    .select('id, name, email, role, organization, service_valid_until')
    .eq('role', 'manager');

  if (args.user) {
    query = query.eq('id', args.user);
  } else if (args.email) {
    query = query.eq('email', String(args.email).trim().toLowerCase());
  }

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new Error('Gestor nao encontrado.');
  }
  return data;
};

const serializeManager = (manager) => ({
  id: manager.id,
  name: manager.name,
  email: manager.email,
  role: manager.role,
  organization: manager.organization || null,
  serviceValidUntil: manager.service_valid_until || null,
  managerAccessStatus: getManagerAccessStatus(manager.service_valid_until || null)
});

const listManagers = async (supabase) => {
  const { data, error } = await supabase
    .from('users')
    .select('id, name, email, role, organization, service_valid_until')
    .eq('role', 'manager')
    .order('name', { ascending: true });

  if (error) throw error;
  console.log(JSON.stringify((data || []).map(serializeManager), null, 2));
};

const showManager = async (supabase, args) => {
  const manager = await findManager(supabase, args);
  console.log(JSON.stringify(serializeManager(manager), null, 2));
};

const updateManager = async (supabase, args, clear = false) => {
  const manager = await findManager(supabase, args);
  const serviceValidUntil = clear ? null : normalizeServiceValidUntil(args['valid-until']);

  if (!clear && !serviceValidUntil) {
    throw new Error('Informe --valid-until YYYY-MM-DD para atualizar a validade.');
  }

  const { data, error } = await supabase
    .from('users')
    .update({ service_valid_until: serviceValidUntil })
    .eq('id', manager.id)
    .select('id, name, email, role, organization, service_valid_until')
    .maybeSingle();

  if (error || !data) {
    throw error || new Error('Falha ao atualizar a validade do gestor.');
  }

  console.log(JSON.stringify({
    success: true,
    manager: serializeManager(data)
  }, null, 2));
};

const main = async () => {
  const [command, ...rest] = process.argv.slice(2);

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    process.exit(0);
  }

  const args = parseArgs(rest);
  const supabase = getSupabaseAdmin();

  if (command === 'list') {
    await listManagers(supabase);
    return;
  }

  if (command === 'show') {
    await showManager(supabase, args);
    return;
  }

  if (command === 'update') {
    await updateManager(supabase, args, false);
    return;
  }

  if (command === 'clear') {
    await updateManager(supabase, args, true);
    return;
  }

  throw new Error(`Comando desconhecido: ${command}`);
};

main().catch((error) => {
  console.error('[manager-service:cli] Erro:', error.message || error);
  process.exit(1);
});
