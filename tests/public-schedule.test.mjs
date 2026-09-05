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
  // "Painel de Pregão" (Direção A): a lista de atletas some por trás de um chip de contagem
  // dentro da própria linha da bateria, em vez de um rótulo "Atletas / Equipes" separado.
  assert.match(eventPage, /: '0'\} atletas/);
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
  // "Painel de Pregão": a linha inteira da bateria é o controle de expandir/ocultar (sem texto
  // "Ver atletas"/"Ocultar atletas" — o estado é lido via aria-expanded acima e o chevron rotaciona).
  assert.match(eventPage, /ChevronDown className=\{`h-3\.5 w-3\.5 shrink-0 text-muted-soft transition-transform \$\{isExpanded \? 'rotate-180' : ''\}`\}/);
  assert.match(eventPage, /formatScheduleDate\(item\.date\)/);
});

test('public event schedule shows a live/next/done status per heat, timezone-safe', () => {
  assert.match(eventPage, /type HeatLiveStatus = 'live' \| 'next' \| 'upcoming' \| 'done'/);
  assert.match(eventPage, /const heatStatusById = React\.useMemo\(/);
  // Fuso fixo do evento (América/Fortaleza, sem horário de verão) em vez do fuso do dispositivo.
  assert.match(eventPage, /const EVENT_UTC_OFFSET = '-03:00'/);
  // O fim de uma bateria sem "Final" explícito é derivado do início da próxima da mesma prova,
  // nunca de uma bateria paralela de outra prova nem de uma empatada no mesmo horário.
  assert.match(eventPage, /candidate\.groupId === groupId && candidate\.start > start/);
});
