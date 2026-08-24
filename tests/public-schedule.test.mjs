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
  assert.match(eventPage, /resolveHeatParticipantSlots\(item\.athleteIds, athletes\)/);
  assert.match(eventPage, /getHeatSlotLabel\(event\.eventType\)/);
  assert.match(eventPage, /const eventDivisionIds = React\.useMemo\(/);
  assert.match(eventPage, /athletes\.some\(athlete => eventDivisionIds\.has\(athlete\.divisionId\)\)/);
  assert.match(eventPage, /publicEventDataStatus\[eventId\] === undefined && !hasPublicEventAthletes/);
  assert.match(eventPage, /Atletas \/ Equipes/);
  assert.match(eventPage, /Participantes em carregamento\.\.\./);
  assert.match(eventPage, /Nenhum participante publicado nesta bateria\./);
});

test('public event schedule groups heats by workout with accessible expandable participants', () => {
  assert.match(eventPage, /interface ScheduleHeatGroup/);
  assert.match(eventPage, /const buildScheduleHeatGroups = \(/);
  assert.match(eventPage, /scheduleHeatGroups = React\.useMemo/);
  assert.match(eventPage, /scheduleBlocks = React\.useMemo<ScheduleBlock\[\]>/);
  assert.match(eventPage, /Cronograma agrupado por prova/);
  assert.match(eventPage, /aria-expanded=\{isExpanded\}/);
  assert.match(eventPage, /aria-controls=\{panelId\}/);
  assert.match(eventPage, /hidden=\{!isExpanded\}/);
  assert.match(eventPage, /toggleHeatDetails\(item\.id\)/);
  assert.match(eventPage, /Ver atletas/);
  assert.match(eventPage, /Ocultar atletas/);
  assert.match(eventPage, /formatScheduleDate\(item\.date\)/);
});
