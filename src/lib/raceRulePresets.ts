import type {
  RaceGeneralRule,
  RaceNoRepReason,
  RaceReason,
  RaceRuleset,
  RaceStationKind,
  RaceStationRules
} from '@/lib/raceRules';

// Presets do regulamento Fitness Race (Story 1.93, D6 e D10). Só dados: o
// motor está em raceRules.ts. São ponto de partida editável (um `custom` sai
// de createCustomRaceRuleset) e vêm marcados como não conferidos: os valores
// de penalidade são os do planonovo.md e ainda precisam ser conferidos com o
// regulamento oficial (DECISOES.md, "Pendências de conferência"). Nenhum
// valor de carga, distância ou reps entra aqui: isso é do percurso do evento.

/** Texto da marca `verified: false`. */
export const RACE_RULESET_UNVERIFIED_NOTE = 'A conferir com o regulamento oficial';

export type RaceRulePresetId = '2025_26' | '2026_27';

// Catálogo de motivos das estações 1 a 7 (planonovo.md, "Tipos de estação").
// "Levantou antes da confirmação" no ergômetro fica de fora: a faixa de 10 s
// é decidida pelo head judge (F2).
const ERGOMETER_REASONS: RaceReason[] = [
  { code: 'feet_off_base', label: 'Pés fora da base' },
  { code: 'feet_off_rest', label: 'Pés fora do apoio' }
];

const SLED_REASONS: RaceReason[] = [
  { code: 'started_past_line', label: 'Começou além da linha' },
  { code: 'lane_invaded', label: 'Invadiu a raia' },
  { code: 'turned_before_line', label: 'Virou antes da linha' },
  { code: 'stepped_racers_box_line', label: 'Pisou na linha do Racers Box' },
  { code: 'pulled_seated_kneeling', label: 'Puxou sentado ou ajoelhado' },
  { code: 'rope_in_next_lane', label: 'Corda na raia vizinha' },
  { code: 'push_backwards', label: 'De costas no Push' }
];

const SANDBAG_OUTSIDE_SHOULDERS = { code: 'sandbag_outside_shoulders', label: 'Sandbag fora dos ombros' };

const sectionReasons = (sandbag: RaceReason): RaceReason[] => [
  // Burpee Broad Jump
  { code: 'chest_not_touching', label: 'Peito não tocou o chão' },
  { code: 'hands_too_far', label: 'Mãos a mais de 30 cm' },
  { code: 'feet_misaligned', label: 'Pés desalinhados' },
  { code: 'extra_step', label: 'Passo extra' },
  // Sandbag Lunges
  { code: 'knee_not_touching', label: 'Joelho não tocou o chão' },
  { code: 'no_extension', label: 'Sem extensão' },
  { code: 'step_between_reps', label: 'Passo entre as repetições' },
  sandbag,
  // Farmers Carry
  { code: 'kb_moved_forward', label: 'KB avançou ao apoiar' },
  { code: 'arms_not_extended', label: 'Braços não estendidos' }
];

const WALL_BALL_NO_REP_REASONS: RaceNoRepReason[] = [
  { code: 'shallow_squat', label: 'Agachamento raso' },
  { code: 'missed_target', label: 'Errou o alvo' },
  { code: 'wrong_target', label: 'Alvo errado' },
  { code: 'not_standing_start', label: 'Não iniciou em pé' },
  { code: 'caught_after_bounce', label: 'Pegou após quicar' },
  { code: 'one_hand_throw', label: 'Lançou com uma mão' }
];

// Gerais (planonovo.md, "Gerais"). Ajuda externa vale 2 ou 3 min: o preset sai com 2 min, editável.
const GENERAL_RULES: RaceGeneralRule[] = [
  { code: 'unassigned_lane_or_equipment', label: 'Raia ou equipamento não atribuído', seconds: 120 },
  { code: 'chalk_misplaced', label: 'Magnésio fora do lugar', seconds: 120 },
  { code: 'in_out_arches', label: 'Arcos IN/OUT', seconds: 120 },
  { code: 'litter', label: 'Lixo', seconds: 120 },
  { code: 'spitting', label: 'Cuspir', seconds: 120 },
  { code: 'water_soaking', label: 'Se molhar com a água', seconds: 120 },
  { code: 'external_help', label: 'Ajuda externa', seconds: 120 },
  { code: 'station_out_of_order', label: 'Estação fora de ordem', seconds: 180 }
];

const station = (warnings: number, reasons: RaceReason[]): RaceStationRules => ({ warnings, secondsAfterWarning: 15, reasons });

// Monta um preset com objetos novos (nada é compartilhado entre os dois).
const buildPreset = (
  preset: RaceRulePresetId,
  name: string,
  sandbag: RaceReason,
  missingUnit: RaceRuleset['missingUnit']
): RaceRuleset => {
  const stations: Record<RaceStationKind, RaceStationRules> = {
    ergometer: station(1, ERGOMETER_REASONS.map((item) => ({ ...item }))),
    sled: station(1, SLED_REASONS.map((item) => ({ ...item }))),
    sections: station(1, sectionReasons(sandbag)),
    wall_ball: station(0, []),
    generic: station(1, [])
  };
  return {
    preset,
    name,
    verified: false,
    immediateConsumesWarning: true,
    stations,
    wallBall: {
      secondsPerMissingRep: 15,
      missingRepsLabel: 'Repetições faltantes no Wall Ball',
      chalkSeconds: 120,
      chalkLabel: 'Magnésio no Wall Ball',
      noRepReasons: WALL_BALL_NO_REP_REASONS.map((item) => ({ ...item }))
    },
    general: GENERAL_RULES.map((item) => ({ ...item })),
    returnWrong: { label: 'Devolução incorreta (Farmers ou Sandbag)', seconds: 30 },
    wrongLoad: { label: 'Carga errada: refazer', declinedLabel: 'Não refez com a carga certa', declinedSeconds: 180 },
    missingUnit
  };
};

/** 2025/26: sandbag fora dos ombros 15 s por ocorrência; trecho ou volta faltando 3 min por unidade. */
export const RACE_RULE_PRESET_2025_26: RaceRuleset = buildPreset(
  '2025_26',
  'Fitness Race 2025/26',
  { ...SANDBAG_OUTSIDE_SHOULDERS, immediate: true, seconds: 15 },
  { label: 'Trecho ou volta faltando', perUnitSeconds: 180 }
);

/** 2026/27: sandbag fora dos ombros 15 s por ocorrência; estação incompleta cobra 3 min por unidade (valor de partida, a conferir). */
export const RACE_RULE_PRESET_2026_27: RaceRuleset = buildPreset(
  '2026_27',
  'Fitness Race 2026/27',
  { ...SANDBAG_OUTSIDE_SHOULDERS, immediate: true, seconds: 15 },
  { label: 'Estação incompleta', perUnitSeconds: 180 }
);

export const RACE_RULE_PRESETS: Record<RaceRulePresetId, RaceRuleset> = {
  '2025_26': RACE_RULE_PRESET_2025_26,
  '2026_27': RACE_RULE_PRESET_2026_27
};
