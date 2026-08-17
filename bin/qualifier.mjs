#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';

const getRequiredEnv = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Variavel de ambiente obrigatoria ausente: ${name}`);
  return value;
};

const getSupabaseAdmin = () => createClient(
  getRequiredEnv('SUPABASE_URL'),
  getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
  { auth: { persistSession: false, autoRefreshToken: false } }
);

const parseArgs = (argv) => {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) args[key] = 'true';
    else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
};

const requireArgs = (args, keys) => {
  const missing = keys.filter(key => !String(args[key] || '').trim());
  if (missing.length) throw new Error(`Parametros obrigatorios ausentes: ${missing.map(key => `--${key}`).join(', ')}`);
};

const normalizeYoutube = (input) => {
  let url;
  try { url = new URL(String(input || '').trim()); } catch { throw new Error('Informe uma URL valida do YouTube.'); }
  if (url.protocol !== 'https:') throw new Error('O video deve usar HTTPS.');
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const parts = url.pathname.split('/').filter(Boolean);
  let videoId = '';
  if (host === 'youtu.be') videoId = parts[0] || '';
  if (host === 'youtube.com' || host === 'm.youtube.com') {
    if (url.pathname === '/watch') videoId = url.searchParams.get('v') || '';
    if (['shorts', 'live', 'embed'].includes(parts[0] || '')) videoId = parts[1] || '';
  }
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) throw new Error('Link do YouTube invalido.');
  return { videoId, canonicalUrl: `https://www.youtube.com/watch?v=${videoId}` };
};

const parseScore = (type, raw) => {
  const result = String(raw || '').trim();
  if (!result) throw new Error('Informe --result.');
  if (type === 'fortime') {
    const parts = result.split(':');
    if (parts.length < 2 || parts.length > 3 || parts.some(part => !/^\d{1,2}$/.test(part))) {
      throw new Error('Tempo deve estar no formato MM:SS ou H:MM:SS.');
    }
    const values = parts.map(Number);
    const value = values.length === 3 ? values[0] * 3600 + values[1] * 60 + values[2] : values[0] * 60 + values[1];
    if (!value || values.at(-1) >= 60 || (values.length === 3 && values[1] >= 60)) throw new Error('Tempo invalido.');
    const hours = Math.floor(value / 3600);
    const minutes = Math.floor((value % 3600) / 60);
    const seconds = value % 60;
    return { value, result: hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}` : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}` };
  }
  const value = Number(result.replace(',', '.'));
  if (!Number.isFinite(value) || value < 0) throw new Error('Score numerico invalido.');
  return { value, result: String(value) };
};

const printHelp = () => {
  console.log(`Uso:
  npm run qualifier:cli -- judge create --actor ACTOR_ID --manager MANAGER_ID --name "Nome" --email judge@email.com --password "senha segura"
  npm run qualifier:cli -- judge assign --actor ACTOR_ID --event EVENT_ID --judge JUDGE_ID
  npm run qualifier:cli -- judge remove --actor ACTOR_ID --event EVENT_ID --judge JUDGE_ID
  npm run qualifier:cli -- judge list --event EVENT_ID
  npm run qualifier:cli -- submission create --event EVENT_ID --registration REG_ID --workout WORKOUT_ID --result "08:14" --video YOUTUBE_URL [--note "..."]
  npm run qualifier:cli -- submission replace --event EVENT_ID --registration REG_ID --workout WORKOUT_ID --result "08:14" --video YOUTUBE_URL --expected-version N [--note "..."]
  npm run qualifier:cli -- submission show --id SUBMISSION_ID | --registration REG_ID
  npm run qualifier:cli -- queue list --event EVENT_ID [--status pending_review|validated|penalized|rejected]
  npm run qualifier:cli -- review apply --actor REVIEWER_ID --submission SUBMISSION_ID --expected-version N --decision validated|penalized|rejected|manual_adjustment [--manual-result "..."] [--justification "..."]
  npm run qualifier:cli -- review history --submission SUBMISSION_ID
  npm run qualifier:cli -- ranking --event EVENT_ID [--division DIVISION_ID]`);
};

const judge = async (supabase, command, args) => {
  if (command === 'create') {
    requireArgs(args, ['actor', 'manager', 'name', 'email', 'password']);
    if (String(args.password).length < 8) throw new Error('A senha do judge deve ter ao menos 8 caracteres.');
    const judgeId = `judge-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const { randomBytes, scryptSync } = await import('node:crypto');
    const salt = randomBytes(16).toString('base64url');
    const hash = scryptSync(String(args.password), salt, 64).toString('base64url');
    const passwordHash = `scrypt$${salt}$${hash}`;
    const { data, error } = await supabase.rpc('qualifier_create_judge', {
      p_actor_id: args.actor,
      p_parent_manager_id: args.manager,
      p_judge_id: judgeId,
      p_name: String(args.name).trim(),
      p_email: String(args.email).trim().toLowerCase(),
      p_password_hash: passwordHash
    });
    if (error) throw error;
    console.log(JSON.stringify({ success: true, judge: data }, null, 2));
    return;
  }
  if (command === 'assign' || command === 'remove') {
    requireArgs(args, ['actor', 'event', 'judge']);
    const { error } = await supabase.rpc(command === 'assign' ? 'qualifier_assign_judge' : 'qualifier_remove_judge', {
      p_actor_id: args.actor,
      p_event_id: args.event,
      p_judge_id: args.judge
    });
    if (error) throw error;
    console.log(JSON.stringify({ success: true, action: command }, null, 2));
    return;
  }
  if (command === 'list') {
    requireArgs(args, ['event']);
    const { data: assignments, error } = await supabase.from('event_judges').select('judge_user_id, created_at').eq('event_id', args.event);
    if (error) throw error;
    const ids = (assignments || []).map(row => row.judge_user_id);
    const { data: users, error: usersError } = ids.length ? await supabase.from('users').select('id, name, email, parent_manager_id').in('id', ids) : { data: [], error: null };
    if (usersError) throw usersError;
    console.log(JSON.stringify({ judges: users || [] }, null, 2));
    return;
  }
  throw new Error(`Comando judge desconhecido: ${command}`);
};

const submission = async (supabase, command, args) => {
  if (command === 'show') {
    if (!args.id && !args.registration) throw new Error('Informe --id ou --registration.');
    let query = supabase.from('score_submissions').select('*').order('submitted_at', { ascending: false });
    query = args.id ? query.eq('id', args.id) : query.eq('registration_id', args.registration);
    const { data, error } = await query;
    if (error) throw error;
    console.log(JSON.stringify(data || [], null, 2));
    return;
  }
  if (command !== 'create' && command !== 'replace') throw new Error(`Comando submission desconhecido: ${command}`);
  requireArgs(args, ['event', 'registration', 'workout', 'result', 'video']);
  if (command === 'replace') requireArgs(args, ['expected-version']);
  const [{ data: registration, error: registrationError }, { data: workout, error: workoutError }] = await Promise.all([
    supabase.from('registrations').select('id, user_id, athlete_id').eq('id', args.registration).eq('event_id', args.event).maybeSingle(),
    supabase.from('workouts').select('id, type').eq('id', args.workout).eq('event_id', args.event).maybeSingle()
  ]);
  if (registrationError || !registration?.user_id || !registration?.athlete_id) throw registrationError || new Error('Inscricao elegivel nao encontrada.');
  if (workoutError || !workout) throw workoutError || new Error('Prova nao encontrada.');
  const score = parseScore(workout.type, args.result);
  const video = normalizeYoutube(args.video);
  const expectedVersion = command === 'create' ? 0 : Number(args['expected-version']);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) throw new Error('--expected-version invalido.');
  const { data, error } = await supabase.rpc('qualifier_submit_submission', {
    p_event_id: args.event,
    p_workout_id: args.workout,
    p_registration_id: args.registration,
    p_user_id: registration.user_id,
    p_athlete_id: registration.athlete_id,
    p_submitted_result: score.result,
    p_submitted_value: score.value,
    p_video_url: video.canonicalUrl,
    p_video_id: video.videoId,
    p_athlete_note: args.note || null,
    p_expected_version: expectedVersion
  });
  if (error) throw error;
  console.log(JSON.stringify({ success: true, submission: data }, null, 2));
};

const queue = async (supabase, command, args) => {
  if (command !== 'list') throw new Error(`Comando queue desconhecido: ${command}`);
  requireArgs(args, ['event']);
  let query = supabase.from('score_submissions').select('*').eq('event_id', args.event).order('submitted_at', { ascending: true });
  if (args.status) query = query.eq('status', args.status);
  const { data, error } = await query;
  if (error) throw error;
  console.log(JSON.stringify(data || [], null, 2));
};

const review = async (supabase, command, args) => {
  if (command === 'history') {
    requireArgs(args, ['submission']);
    const { data, error } = await supabase.from('score_submission_reviews').select('*').eq('submission_id', args.submission).order('reviewed_at', { ascending: true });
    if (error) throw error;
    console.log(JSON.stringify(data || [], null, 2));
    return;
  }
  if (command !== 'apply') throw new Error(`Comando review desconhecido: ${command}`);
  requireArgs(args, ['actor', 'submission', 'expected-version', 'decision']);
  const allowed = ['validated', 'penalized', 'rejected', 'manual_adjustment'];
  if (!allowed.includes(args.decision)) throw new Error('Decisao invalida.');
  const { data: current, error: currentError } = await supabase.from('score_submissions').select('workout_id').eq('id', args.submission).maybeSingle();
  if (currentError || !current) throw currentError || new Error('Submissao nao encontrada.');
  let manual = null;
  if (args.decision === 'manual_adjustment') {
    requireArgs(args, ['manual-result']);
    const { data: workout, error } = await supabase.from('workouts').select('type').eq('id', current.workout_id).maybeSingle();
    if (error || !workout) throw error || new Error('Prova nao encontrada.');
    manual = parseScore(workout.type, args['manual-result']);
  }
  const { data, error } = await supabase.rpc('qualifier_apply_review', {
    p_submission_id: args.submission,
    p_expected_version: Number(args['expected-version']),
    p_actor_id: args.actor,
    p_decision: args.decision,
    p_justification: args.justification || null,
    p_manual_result: manual?.result || null,
    p_manual_value: manual?.value ?? null
  });
  if (error) throw error;
  console.log(JSON.stringify({ success: true, review: data }, null, 2));
};

const ranking = async (supabase, args) => {
  requireArgs(args, ['event']);
  const { data: workouts, error: workoutsError } = await supabase.from('workouts').select('id, division_id').eq('event_id', args.event);
  if (workoutsError) throw workoutsError;
  for (const workout of workouts || []) {
    if (args.division && workout.division_id !== args.division) continue;
    if (workout.division_id) {
      const { error } = await supabase.rpc('qualifier_refresh_workout_scores', { p_workout_id: workout.id, p_division_id: workout.division_id });
      if (error) throw error;
    }
  }
  const { data, error } = await supabase
    .from('scores')
    .select('athlete_id, workout_id, result, value, rank, points, result_status')
    .in('workout_id', (workouts || []).filter(item => !args.division || item.division_id === args.division).map(item => item.id));
  if (error) throw error;
  console.log(JSON.stringify(data || [], null, 2));
};

const main = async () => {
  const [area, command, ...rest] = process.argv.slice(2);
  if (!area || area === 'help' || area === '--help') return printHelp();
  const args = parseArgs(area === 'ranking' ? [command, ...rest] : rest);
  const supabase = getSupabaseAdmin();
  if (area === 'judge') return judge(supabase, command, args);
  if (area === 'submission') return submission(supabase, command, args);
  if (area === 'queue') return queue(supabase, command, args);
  if (area === 'review') return review(supabase, command, args);
  if (area === 'ranking') return ranking(supabase, args);
  throw new Error(`Area desconhecida: ${area}`);
};

main().catch((error) => {
  console.error('[qualifier:cli] Erro:', error?.message || error);
  process.exit(1);
});
