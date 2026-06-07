import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const requestRoute = read('../src/app/api/auth/request-password-reset/route.ts');
const resetRoute = read('../src/app/api/auth/reset-password/route.ts');
const resend = read('../src/lib/resend.ts');
const adminPage = read('../src/app/admin/page.tsx');
const migration = read('../supabase/migrations/20260607103000_password_reset_tokens.sql');

test('password reset tokens are stored server-side with one-time expiration', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS password_reset_tokens/);
  assert.match(migration, /token_hash TEXT PRIMARY KEY/);
  assert.match(migration, /expires_at TIMESTAMPTZ NOT NULL/);
  assert.match(migration, /used_at TIMESTAMPTZ/);
  assert.match(migration, /ALTER TABLE password_reset_tokens ENABLE ROW LEVEL SECURITY/);
});

test('request password reset sends a one-time link only for athletes and managers', () => {
  assert.match(requestRoute, /randomBytes\(32\)\.toString\('hex'\)/);
  assert.match(requestRoute, /createHash\('sha256'\)/);
  assert.match(requestRoute, /user\.role !== 'manager' && user\.role !== 'athlete'/);
  assert.match(requestRoute, /sendPasswordResetEmail/);
  assert.match(requestRoute, /\/admin\?reset_token=/);
});

test('reset password endpoint validates token and updates users secret', () => {
  assert.match(resetRoute, /password_reset_tokens/);
  assert.match(resetRoute, /Link de recuperação inválido ou expirado/);
  assert.match(resetRoute, /from\('users_secrets'\)[\s\S]*upsert/);
  assert.match(resetRoute, /update\(\{ used_at: new Date\(\)\.toISOString\(\) \}\)/);
});

test('password reset email uses a dedicated HTML template and CTA', () => {
  assert.match(resend, /sendPasswordResetEmail/);
  assert.match(resend, /Recuperação de senha - WODArena/);
  assert.match(resend, /Criar nova senha/);
  assert.match(resend, /expiresInMinutes/);
});

test('admin login exposes request and reset password forms', () => {
  assert.match(adminPage, /authMode/);
  assert.match(adminPage, /handleRequestPasswordReset/);
  assert.match(adminPage, /handleResetPasswordSubmit/);
  assert.match(adminPage, /\/api\/auth\/request-password-reset/);
  assert.match(adminPage, /\/api\/auth\/reset-password/);
  assert.match(adminPage, /reset_token/);
});
