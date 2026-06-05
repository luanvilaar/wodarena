import { CategoryType, CourseStage, Division, Workout } from '@/types';

export const FITNESS_RACING_AGE_GROUPS = [
  '16-24',
  '25-29',
  '30-34',
  '35-39',
  '40-44',
  '45-49',
  '50-54',
  '55-59',
  '60+'
];

export type FitnessRacingStationPreset = Omit<CourseStage, 'id' | 'orderIndex'>;

export const FITNESS_RACING_STATION_LIBRARY: FitnessRacingStationPreset[] = [
  { name: 'Ski Erg', type: 'station', distance: '1000m' },
  { name: 'Sled Push', type: 'station', distance: '50m', maleWeight: '152kg', femaleWeight: '102kg' },
  { name: 'Sled Pull', type: 'station', distance: '50m', maleWeight: '103kg', femaleWeight: '78kg' },
  { name: 'Burpee Broad Jump', type: 'station', distance: '80m' },
  { name: 'Row', type: 'station', distance: '1000m' },
  { name: 'Farmers Carry', type: 'station', distance: '200m', maleWeight: '2x24kg', femaleWeight: '2x16kg' },
  { name: 'Sandbag Lunges', type: 'station', distance: '100m', maleWeight: '20kg', femaleWeight: '10kg' },
  { name: 'Wall Balls', type: 'station', reps: 100, maleWeight: '9kg', femaleWeight: '6kg' }
];

export const buildFitnessRacingCourse = (divisionName = ''): CourseStage[] => {
  const isPro = divisionName.toLowerCase().includes('pro');

  const stationOverrides: Record<string, Partial<CourseStage>> = isPro
    ? {
        'Sled Push': { maleWeight: '202kg', femaleWeight: '152kg' },
        'Sled Pull': { maleWeight: '153kg', femaleWeight: '103kg' },
        'Farmers Carry': { maleWeight: '2x32kg', femaleWeight: '2x24kg' },
        'Sandbag Lunges': { maleWeight: '30kg', femaleWeight: '20kg' },
        'Wall Balls': { reps: 100, maleWeight: '9kg', femaleWeight: '9kg' }
      }
    : {};

  const stations = FITNESS_RACING_STATION_LIBRARY.map((station) => ({
    ...station,
    ...(stationOverrides[station.name] || {})
  }));

  return stations.flatMap((station, index) => {
    const runOrder = index * 2 + 1;
    const stationOrder = runOrder + 1;
    return [
      {
        id: `run-${index + 1}`,
        name: `Run ${index + 1}`,
        type: 'run' as const,
        orderIndex: runOrder,
        distance: '1000m'
      },
      {
        ...station,
        id: station.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
        orderIndex: stationOrder
      }
    ];
  });
};

const defaultCategoryRows: {
  name: string;
  category: CategoryType;
  type: Division['type'];
}[] = [
  { name: 'Open Masculino', category: 'male', type: 'individual' },
  { name: 'Open Feminino', category: 'female', type: 'individual' },
  { name: 'Pro Masculino', category: 'male', type: 'individual' },
  { name: 'Pro Feminino', category: 'female', type: 'individual' },
  { name: 'Dupla Masculina', category: 'male', type: 'duo' },
  { name: 'Dupla Feminina', category: 'female', type: 'duo' },
  { name: 'Dupla Mista', category: 'team', type: 'duo' },
  { name: 'Revezamento Masculino', category: 'male', type: 'team' },
  { name: 'Revezamento Feminino', category: 'female', type: 'team' },
  { name: 'Revezamento Misto', category: 'team', type: 'team' }
];

export const buildFitnessRacingDefaults = (eventId: string, price: number, slotsLimit = 100) => {
  const divisions: Division[] = defaultCategoryRows.map((categoryRow) => {
    const divisionId = `div-${eventId}-${categoryRow.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    return {
      id: divisionId,
      name: categoryRow.name,
      category: categoryRow.category,
      type: categoryRow.type,
      slotsLimit,
      price,
      isActive: true,
      useAgeGroups: false,
      ageGroups: [...FITNESS_RACING_AGE_GROUPS],
      courseLayout: buildFitnessRacingCourse(categoryRow.name)
    };
  });

  const workouts: Workout[] = divisions.map((division) => ({
    id: `wod-${division.id}-total`,
    name: 'Percurso Completo',
    description: 'Tempo oficial total do percurso de Fitness Racing.',
    type: 'fortime',
    code: 'TOTAL',
    orderIndex: 1,
    divisionId: division.id,
    tieBreaker: ''
  }));

  return { divisions, workouts };
};

export const getAgeGroupFromDate = (birthDateStr?: string, ageGroups: string[] = FITNESS_RACING_AGE_GROUPS): string => {
  if (!birthDateStr || !ageGroups || ageGroups.length === 0) return 'Geral';
  try {
    let formattedDateStr = birthDateStr.trim();
    if (formattedDateStr.includes('/')) {
      const parts = formattedDateStr.split('/');
      if (parts.length === 3) {
        if (parts[0].length === 4) {
          formattedDateStr = `${parts[0]}-${parts[1]}-${parts[2]}`;
        } else {
          formattedDateStr = `${parts[2]}-${parts[1]}-${parts[0]}`;
        }
      }
    } else if (formattedDateStr.includes('-')) {
      const parts = formattedDateStr.split('-');
      if (parts.length === 3 && parts[0].length !== 4) {
        formattedDateStr = `${parts[2]}-${parts[1]}-${parts[0]}`;
      }
    }
    const birthDate = new Date(formattedDateStr);
    if (isNaN(birthDate.getTime())) return 'Geral';
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    
    // Procura em qual faixa a idade se encaixa
    for (const group of ageGroups) {
      const trimmed = group.trim();
      if (trimmed.endsWith('+')) {
        const minAge = parseInt(trimmed.slice(0, -1), 10);
        if (!isNaN(minAge) && age >= minAge) {
          return group;
        }
      } else if (trimmed.includes('-')) {
        const parts = trimmed.split('-');
        const minAge = parseInt(parts[0], 10);
        const maxAge = parseInt(parts[1], 10);
        if (!isNaN(minAge) && !isNaN(maxAge) && age >= minAge && age <= maxAge) {
          return group;
        }
      }
    }
    return 'Geral';
  } catch {
    return 'Geral';
  }
};

export const normalizeInstagram = (handle?: string) => (
  (handle || '').trim().replace(/^@+/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/\/$/, '')
);
