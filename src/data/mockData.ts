import { Event, Athlete, Score, User } from '../types';

export const INITIAL_USERS: User[] = [
  {
    id: 'user-owner',
    name: 'Carlos Proprietário',
    email: 'owner@wodarena.com',
    password: 'owner',
    role: 'owner',
    organization: 'WODArena Corp'
  },
  {
    id: 'org-1',
    name: 'Rodrigo Imperium',
    email: 'org1@wodarena.com',
    password: 'manager1',
    role: 'manager',
    organization: 'CrossFit Imperium'
  },
  {
    id: 'org-2',
    name: 'Juliana Arena',
    email: 'org2@wodarena.com',
    password: 'manager2',
    role: 'manager',
    organization: 'WODArena CrossFit Box'
  }
];

export const INITIAL_EVENTS: Event[] = [];

export const INITIAL_ATHLETES: Athlete[] = [];

export const INITIAL_SCORES: Score[] = [];
