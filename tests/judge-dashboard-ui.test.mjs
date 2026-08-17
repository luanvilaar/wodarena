import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const judgePage = readFileSync(new URL('../src/app/judge/page.tsx', import.meta.url), 'utf8');

test('Judge dashboard keeps the review queue usable on mobile without widening the page', () => {
  assert.match(judgePage, /overflow-x-hidden/);
  assert.match(judgePage, /snap-x snap-mandatory/);
  assert.match(judgePage, /overflow-x-auto overscroll-x-contain/);
  assert.match(judgePage, /touch-pan-x/);
  assert.match(judgePage, /lg:flex-col lg:overflow-x-hidden lg:overflow-y-auto/);
  assert.match(judgePage, /min-w-\[15rem\]/);
  assert.match(judgePage, /aria-pressed=\{isSelected\}/);
});

test('Judge dashboard makes the proof video half-width on desktop while preserving mobile media and review controls', () => {
  assert.match(judgePage, /<div className="w-full lg:w-1\/2">/);
  assert.match(judgePage, /className="aspect-video w-full rounded-lg/);
  assert.match(judgePage, /loading="lazy"/);
  assert.match(judgePage, /referrerPolicy="strict-origin-when-cross-origin"/);
  assert.match(judgePage, /htmlFor="judge-decision"/);
  assert.match(judgePage, /id="judge-justification"/);
  assert.match(judgePage, /min-h-11 w-full rounded-md bg-primary/);
});

test('Judge dashboard exposes async feedback and useful empty states accessibly', () => {
  assert.match(judgePage, /role="status" aria-live="polite"/);
  assert.match(judgePage, /aria-label="Fila de submissões pendentes"/);
  assert.match(judgePage, /Nenhuma submissão pendente\./);
  assert.match(judgePage, /Quando houver uma submissão pendente/);
});

test('Judge dashboard exposes a safe, touch-friendly logout action', () => {
  assert.match(judgePage, /const \{ currentUser, logout \} = useApp\(\);/);
  assert.match(judgePage, /const router = useRouter\(\);/);
  assert.match(judgePage, /const handleLogout = \(\) => \{\s*logout\(\);\s*router\.replace\('\/admin'\);/);
  assert.match(judgePage, /onClick=\{handleLogout\}/);
  assert.match(judgePage, /aria-label="Sair da conta de judge"/);
  assert.match(judgePage, /<span>Sair<\/span>/);
  assert.match(judgePage, /<LogOut className="h-4 w-4" aria-hidden="true" \/>/);
  assert.match(judgePage, /inline-flex min-h-11 items-center gap-2 rounded-md border border-card-border/);
});
