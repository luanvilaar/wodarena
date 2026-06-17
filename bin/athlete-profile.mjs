#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';

const BIRTH_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

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

const normalizeBirthDate = (value) => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  if (!BIRTH_DATE_PATTERN.test(trimmed)) {
    throw new Error('A data de nascimento deve estar no formato YYYY-MM-DD.');
  }
  const parsed = new Date(`${trimmed}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('A data de nascimento informada e invalida.');
  }
  return trimmed;
};

const printHelp = () => {
  console.log(`Uso:
  npm run athlete-profile:cli -- show --user USER_ID
  npm run athlete-profile:cli -- update --user USER_ID --name "Nome completo" [--birth-date YYYY-MM-DD]`);
};

const getOwnedAthleteIds = (registrations) => [...new Set((registrations || []).map(item => item.athlete_id).filter(Boolean))];

const showProfile = async (supabase, args) => {
  if (!args.user) {
    throw new Error('Informe --user para consultar o perfil.');
  }

  const [{ data: user, error: userError }, { data: registrations, error: registrationsError }] = await Promise.all([
    supabase
      .from('users')
      .select('id, name, email, role, organization')
      .eq('id', args.user)
      .maybeSingle(),
    supabase
      .from('registrations')
      .select('id, athlete_id, athlete_name, event_id, created_at')
      .eq('user_id', args.user)
      .order('created_at', { ascending: false })
  ]);

  if (userError || !user) {
    throw new Error('Usuario nao encontrado.');
  }

  if (registrationsError) {
    throw registrationsError;
  }

  const athleteIds = getOwnedAthleteIds(registrations);
  const { data: athletes, error: athletesError } = athleteIds.length > 0
    ? await supabase
      .from('athletes')
      .select('id, name, birth_date, email')
      .in('id', athleteIds)
    : { data: [], error: null };

  if (athletesError) {
    throw athletesError;
  }

  console.log(JSON.stringify({
    user,
    profile: {
      fullName: user.name,
      email: user.email,
      birthDate: (athletes || []).find(item => item.birth_date)?.birth_date || null
    },
    registrations: registrations || [],
    athletes: athletes || []
  }, null, 2));
};

const updateProfile = async (supabase, args) => {
  if (!args.user || !args.name) {
    throw new Error('Informe --user e --name para atualizar o perfil.');
  }

  const fullName = String(args.name).trim();
  if (fullName.length < 3) {
    throw new Error('Informe um nome completo valido.');
  }

  const birthDate = normalizeBirthDate(args['birth-date']);

  const { data: registrations, error: registrationsError } = await supabase
    .from('registrations')
    .select('id, athlete_id')
    .eq('user_id', args.user);

  if (registrationsError) {
    throw registrationsError;
  }

  const athleteIds = getOwnedAthleteIds(registrations);

  const [{ data: user, error: userError }, registrationsResult, athletesResult] = await Promise.all([
    supabase
      .from('users')
      .update({ name: fullName })
      .eq('id', args.user)
      .select('id, name, email, role, organization')
      .maybeSingle(),
    supabase
      .from('registrations')
      .update({ athlete_name: fullName })
      .eq('user_id', args.user)
      .select('id, athlete_name'),
    athleteIds.length > 0
      ? supabase
        .from('athletes')
        .update({ name: fullName, birth_date: birthDate })
        .in('id', athleteIds)
        .select('id, name, birth_date')
      : Promise.resolve({ data: [], error: null })
  ]);

  if (userError || !user) {
    throw userError || new Error('Falha ao atualizar usuario.');
  }
  if (registrationsResult.error) {
    throw registrationsResult.error;
  }
  if (athletesResult.error) {
    throw athletesResult.error;
  }

  console.log(JSON.stringify({
    success: true,
    user,
    registrations: registrationsResult.data || [],
    athletes: athletesResult.data || []
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

  if (command === 'show') {
    await showProfile(supabase, args);
    return;
  }

  if (command === 'update') {
    await updateProfile(supabase, args);
    return;
  }

  throw new Error(`Comando desconhecido: ${command}`);
};

main().catch((error) => {
  console.error('[athlete-profile:cli] Erro:', error.message || error);
  process.exit(1);
});
