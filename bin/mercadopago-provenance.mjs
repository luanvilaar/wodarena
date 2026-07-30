#!/usr/bin/env node

/**
 * Backfill de procedencia OAuth das contas Mercado Pago dos gestores.
 *
 * Contas conectadas antes das colunas `oauth_client_id` / `oauth_verified_at`
 * existirem ficam com ambas nulas e passam a ser barradas por
 * `assertOAuthSellerIdentity` (src/lib/mercadopagoServer.ts), bloqueando as vendas
 * do evento mesmo quando a conexao e legitima.
 *
 * A unica prova confiavel de que um refresh token nasceu da nossa aplicacao e o
 * proprio Mercado Pago: se `grant_type=refresh_token` com o nosso
 * client_id/client_secret renovar o token, a conexao veio dessa aplicacao. Contas
 * que falham na renovacao continuam bloqueadas e precisam de reconexao manual.
 */

import { createClient } from '@supabase/supabase-js';

const OAUTH_TOKEN_URL = 'https://api.mercadopago.com/oauth/token';
const DEFAULT_EXPIRES_IN_SECONDS = 15_552_000; // 180 dias, mesmo default do app

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

const printHelp = () => {
  console.log(`Uso:
  npm run mercadopago:provenance -- audit
  npm run mercadopago:provenance -- backfill              (dry-run: nao grava nada)
  npm run mercadopago:provenance -- backfill --apply
  npm run mercadopago:provenance -- backfill --apply --user org-123

Comandos:
  audit      Lista as contas conectadas e o motivo de cada uma estar ou nao apta ao split.
  backfill   Valida a procedencia via refresh OAuth real e grava a verificacao (com --apply).`);
};

const isPlatformAccount = (mercadopagoUserId) => {
  const platformUserId = process.env.MERCADOPAGO_PLATFORM_USER_ID?.trim();
  const sellerUserId = mercadopagoUserId ? String(mercadopagoUserId).trim() : '';
  return Boolean(platformUserId && sellerUserId && platformUserId === sellerUserId);
};

const loadAccounts = async (supabase, args) => {
  let query = supabase
    .from('mercadopago_accounts')
    .select('user_id, mercadopago_user_id, status, oauth_client_id, oauth_verified_at, expires_at')
    .order('user_id', { ascending: true });

  if (args.user) {
    query = query.eq('user_id', String(args.user).trim());
  }

  const { data: accounts, error } = await query;
  if (error) throw error;

  const { data: secrets, error: secretsError } = await supabase
    .from('mercadopago_secrets')
    .select('user_id, refresh_token');
  if (secretsError) throw secretsError;

  const secretByUser = new Map((secrets || []).map((row) => [row.user_id, row]));
  return (accounts || []).map((account) => ({
    account,
    refreshToken: secretByUser.get(account.user_id)?.refresh_token || null
  }));
};

/**
 * Classifica a conta sem chamar o Mercado Pago. `needs_backfill` e o unico estado
 * que o comando `backfill` tenta resolver.
 */
const classify = (entry, clientId) => {
  const { account, refreshToken } = entry;

  if (isPlatformAccount(account.mercadopago_user_id)) return 'platform_account';
  if (account.status !== 'connected') return 'not_connected';
  if (!refreshToken) return 'missing_refresh_token';
  if (refreshToken === 'manual') return 'manual_legacy';
  if (account.oauth_client_id === clientId && account.oauth_verified_at) return 'verified';
  return 'needs_backfill';
};

const refreshAccessToken = async (refreshToken, clientId, clientSecret) => {
  const response = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      accept: 'application/json'
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    }).toString()
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { ok: false, status: response.status, error: payload?.message || payload?.error || 'refresh_failed' };
  }
  if (typeof payload.access_token !== 'string' || !payload.access_token) {
    return { ok: false, status: response.status, error: 'access_token_ausente' };
  }
  return { ok: true, payload };
};

const persistVerification = async (supabase, userId, payload, refreshToken, clientId) => {
  const now = new Date().toISOString();
  const expiresIn = Number(payload.expires_in || DEFAULT_EXPIRES_IN_SECONDS);
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

  const { error: secretError } = await supabase
    .from('mercadopago_secrets')
    .update({
      access_token: payload.access_token,
      refresh_token: typeof payload.refresh_token === 'string' && payload.refresh_token
        ? payload.refresh_token
        : refreshToken,
      updated_at: now
    })
    .eq('user_id', userId);
  if (secretError) throw secretError;

  const accountUpdate = {
    oauth_client_id: clientId,
    oauth_verified_at: now,
    expires_at: expiresAt,
    status: 'connected',
    updated_at: now
  };

  // A renovacao devolve o dono do token: reafirmamos a identidade do vendedor
  // em vez de confiar no valor gravado anteriormente.
  if (payload.user_id !== undefined && payload.user_id !== null) {
    accountUpdate.mercadopago_user_id = String(payload.user_id);
  }
  if (typeof payload.public_key === 'string' && payload.public_key) {
    accountUpdate.public_key = payload.public_key;
  }

  const { error: accountError } = await supabase
    .from('mercadopago_accounts')
    .update(accountUpdate)
    .eq('user_id', userId);
  if (accountError) throw accountError;

  return expiresAt;
};

const audit = async (supabase, args) => {
  const clientId = getRequiredEnv('MERCADOPAGO_CLIENT_ID').trim();
  const entries = await loadAccounts(supabase, args);

  const accounts = entries.map((entry) => ({
    userId: entry.account.user_id,
    mercadopagoUserId: entry.account.mercadopago_user_id,
    status: entry.account.status,
    classification: classify(entry, clientId),
    oauthClientIdMatches: entry.account.oauth_client_id === clientId,
    oauthVerifiedAt: entry.account.oauth_verified_at,
    expiresAt: entry.account.expires_at
  }));

  console.log(JSON.stringify({
    success: true,
    clientId,
    total: accounts.length,
    needsBackfill: accounts.filter((item) => item.classification === 'needs_backfill').length,
    accounts
  }, null, 2));
};

const backfill = async (supabase, args) => {
  const clientId = getRequiredEnv('MERCADOPAGO_CLIENT_ID').trim();
  const clientSecret = getRequiredEnv('MERCADOPAGO_CLIENT_SECRET').trim();
  const apply = args.apply === 'true';
  const entries = await loadAccounts(supabase, args);
  const results = [];

  for (const entry of entries) {
    const userId = entry.account.user_id;
    const classification = classify(entry, clientId);

    if (classification !== 'needs_backfill') {
      results.push({ userId, action: 'skipped', reason: classification });
      continue;
    }

    if (!apply) {
      results.push({ userId, action: 'would_verify', reason: 'dry-run: use --apply para gravar' });
      continue;
    }

    const refreshed = await refreshAccessToken(entry.refreshToken, clientId, clientSecret);
    if (!refreshed.ok) {
      results.push({
        userId,
        action: 'failed',
        reason: 'refresh_recusado_pelo_mercado_pago',
        status: refreshed.status,
        detail: refreshed.error
      });
      continue;
    }

    if (isPlatformAccount(refreshed.payload.user_id)) {
      results.push({
        userId,
        action: 'failed',
        reason: 'conta_da_propria_plataforma_nao_pode_vender_com_split'
      });
      continue;
    }

    const expiresAt = await persistVerification(supabase, userId, refreshed.payload, entry.refreshToken, clientId);
    results.push({
      userId,
      action: 'verified',
      mercadopagoUserId: String(refreshed.payload.user_id ?? entry.account.mercadopago_user_id),
      expiresAt
    });
  }

  console.log(JSON.stringify({
    success: true,
    applied: apply,
    verified: results.filter((item) => item.action === 'verified').length,
    failed: results.filter((item) => item.action === 'failed').length,
    results
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

  if (command === 'audit') {
    await audit(supabase, args);
    return;
  }

  if (command === 'backfill') {
    await backfill(supabase, args);
    return;
  }

  throw new Error(`Comando desconhecido: ${command}`);
};

main().catch((error) => {
  console.error('[mercadopago-provenance:cli] Erro:', error.message || error);
  process.exit(1);
});
