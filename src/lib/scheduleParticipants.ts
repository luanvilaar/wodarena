import type { Athlete, Event } from '../types';

export type HeatSlotLabel = 'Vaga' | 'Raia';

export interface HeatParticipantSlot {
  athleteId: string;
  slotIndex: number;
  displayIndex: number;
}

export interface ResolvedHeatParticipantSlot extends HeatParticipantSlot {
  athlete: Athlete;
}

export interface HeatParticipantResolution {
  slots: HeatParticipantSlot[];
  resolvedParticipants: ResolvedHeatParticipantSlot[];
  unresolvedParticipants: HeatParticipantSlot[];
  totalCount: number;
  resolvedCount: number;
  unresolvedCount: number;
}

export const getHeatSlotLabel = (eventType?: Event['eventType']): HeatSlotLabel => (
  eventType === 'fitness_racing' ? 'Vaga' : 'Raia'
);

export const getFilledHeatParticipantSlots = (
  athleteIds?: Array<string | null | undefined>
): HeatParticipantSlot[] => (
  (athleteIds || [])
    .map((athleteId, slotIndex) => ({
      athleteId: typeof athleteId === 'string' ? athleteId.trim() : '',
      slotIndex,
      displayIndex: slotIndex + 1
    }))
    .filter(slot => Boolean(slot.athleteId))
);

export const resolveHeatParticipantSlots = (
  athleteIds: Array<string | null | undefined> | undefined,
  athletes: Athlete[]
): HeatParticipantResolution => {
  const slots = getFilledHeatParticipantSlots(athleteIds);
  const athletesById = new Map(athletes.map(athlete => [athlete.id, athlete]));
  const resolvedParticipants: ResolvedHeatParticipantSlot[] = [];
  const unresolvedParticipants: HeatParticipantSlot[] = [];

  slots.forEach(slot => {
    const athlete = athletesById.get(slot.athleteId);
    if (athlete) {
      resolvedParticipants.push({ ...slot, athlete });
    } else {
      unresolvedParticipants.push(slot);
    }
  });

  return {
    slots,
    resolvedParticipants,
    unresolvedParticipants,
    totalCount: slots.length,
    resolvedCount: resolvedParticipants.length,
    unresolvedCount: unresolvedParticipants.length
  };
};
