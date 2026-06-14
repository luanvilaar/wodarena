import { Event, Athlete, Score, User } from '../types';

export const INITIAL_USERS: User[] = [
  {
    id: 'user-owner',
    name: 'Luan Vilaar',
    email: 'l.vilaar@gmail.com',
    password: 'janela47',
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
  }
];

export const INITIAL_EVENTS: Event[] = [];

export const INITIAL_ATHLETES: Athlete[] = [];

export const INITIAL_SCORES: Score[] = [];
