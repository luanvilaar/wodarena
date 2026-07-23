import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const helperUrl = new URL('../src/lib/scheduleParticipants.ts', import.meta.url).href;

const runHelperScenario = () => {
  const script = `
    const {
      getFilledHeatParticipantSlots,
      getHeatSlotLabel,
      resolveHeatParticipantSlots
    } = await import(${JSON.stringify(helperUrl)});

    const athletes = [
      {
        id: 'ath-1',
        name: 'Ana Souza',
        box: 'Cross Arena',
        country: 'BR',
        divisionId: 'div-rx',
        isTeam: false
      },
      {
        id: 'team-1',
        name: 'Equipe Alpha',
        box: 'Box Team',
        country: 'BR',
        divisionId: 'div-team',
        isTeam: true
      }
    ];

    const normalizedSlots = getFilledHeatParticipantSlots(['', ' ath-1 ', undefined, 'missing-athlete', 'team-1']);
    const resolution = resolveHeatParticipantSlots(['', ' ath-1 ', 'missing-athlete', 'team-1'], athletes);

    console.log(JSON.stringify({
      normalizedSlots,
      resolution: {
        totalCount: resolution.totalCount,
        resolvedCount: resolution.resolvedCount,
        unresolvedCount: resolution.unresolvedCount,
        resolvedParticipants: resolution.resolvedParticipants.map(participant => ({
          athleteId: participant.athleteId,
          displayIndex: participant.displayIndex,
          name: participant.athlete.name,
          isTeam: participant.athlete.isTeam
        })),
        unresolvedParticipants: resolution.unresolvedParticipants
      },
      labels: {
        fitnessRacing: getHeatSlotLabel('fitness_racing'),
        functionalFitness: getHeatSlotLabel('functional_fitness'),
        fallback: getHeatSlotLabel(undefined)
      }
    }));
  `;

  const result = spawnSync(
    process.execPath,
    ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', '--input-type=module', '-e', script],
    { encoding: 'utf8' }
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
};

const helperScenario = runHelperScenario();

test('normaliza slots preenchidos preservando a posição original da vaga ou raia', () => {
  assert.deepEqual(helperScenario.normalizedSlots, [
    { athleteId: 'ath-1', slotIndex: 1, displayIndex: 2 },
    { athleteId: 'missing-athlete', slotIndex: 3, displayIndex: 4 },
    { athleteId: 'team-1', slotIndex: 4, displayIndex: 5 }
  ]);
});

test('resolve atletas e equipes de uma bateria e separa IDs ainda sem perfil público', () => {
  assert.equal(helperScenario.resolution.totalCount, 3);
  assert.equal(helperScenario.resolution.resolvedCount, 2);
  assert.equal(helperScenario.resolution.unresolvedCount, 1);
  assert.deepEqual(
    helperScenario.resolution.resolvedParticipants,
    [
      { athleteId: 'ath-1', displayIndex: 2, name: 'Ana Souza', isTeam: false },
      { athleteId: 'team-1', displayIndex: 4, name: 'Equipe Alpha', isTeam: true }
    ]
  );
  assert.deepEqual(helperScenario.resolution.unresolvedParticipants, [
    { athleteId: 'missing-athlete', slotIndex: 2, displayIndex: 3 }
  ]);
});

test('usa o rótulo correto para Fitness Race e Functional Fitness', () => {
  assert.equal(helperScenario.labels.fitnessRacing, 'Vaga');
  assert.equal(helperScenario.labels.functionalFitness, 'Raia');
  assert.equal(helperScenario.labels.fallback, 'Raia');
});
