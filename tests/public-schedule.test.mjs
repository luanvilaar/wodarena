import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const eventPage = read('../src/app/event/[id]/page.tsx');

test('public event schedule hides unpublished heats and deduplicates equivalent heats', () => {
  assert.match(eventPage, /\.filter\(item => item\.kind !== 'heat' \|\| item\.isPublished\)/);
  assert.match(eventPage, /const seenHeatKeys = new Set<string>\(\)/);
  assert.match(eventPage, /const athleteKey = \[\.\.\.\(item\.athleteIds \|\| \[\]\)\]\.sort\(\)\.join\(','\)/);
  assert.match(eventPage, /if \(seenHeatKeys\.has\(heatKey\)\) return false/);
});

test('public event schedule renders heat participants and useful empty states', () => {
  assert.match(eventPage, /const heatParticipantSlots = \(item\.athleteIds \|\| \[\]\)/);
  assert.match(eventPage, /resolvedHeatParticipants/);
  assert.match(eventPage, /Atletas \/ Equipes/);
  assert.match(eventPage, /Participantes em carregamento\.\.\./);
  assert.match(eventPage, /Nenhum participante publicado nesta bateria\./);
});
