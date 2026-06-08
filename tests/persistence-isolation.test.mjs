import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const context = readFileSync(new URL('../src/context/AppContext.tsx', import.meta.url), 'utf8');
const admin = readFileSync(new URL('../src/app/admin/page.tsx', import.meta.url), 'utf8');

test('event and child creation waits for Supabase before updating local state', () => {
  assert.match(context, /const addEvent = async[\s\S]*Promise<Event>/);
  assert.match(context, /const \{ error: eventError \} = await supabase\.from\('events'\)\.insert/);
  assert.match(context, /if \(eventError\)[\s\S]*throw eventError/);
  assert.match(context, /setEvents\(prev => \[\.\.\.prev, newEvent\]\)/);
  assert.match(context, /const addDivision = async[\s\S]*Promise<\{ division: Division; autoWorkout: Workout \| null \}>/);
  assert.match(context, /const addWorkout = async[\s\S]*Promise<Workout>/);
});

test('manager mutations are scoped by organizer and event ids', () => {
  assert.match(context, /createScopedId\('evt', currentUser\.id, eventData\.name\)/);
  assert.match(context, /\.delete\(\)[\s\S]*\.eq\('id', eventId\)[\s\S]*\.eq\('organizer_id', currentUser\.id\)/);
  assert.match(context, /\.update\(dbPayload\)[\s\S]*\.eq\('id', eventId\)[\s\S]*\.eq\('organizer_id', currentUser\.id\)/);
  assert.match(context, /\.update\(dbPayload\)[\s\S]*\.eq\('id', divisionId\)[\s\S]*\.eq\('event_id', eventId\)/);
  assert.match(context, /\.delete\(\)[\s\S]*\.eq\('id', workoutId\)[\s\S]*\.eq\('event_id', eventId\)/);
  assert.match(context, /e\.organizerId === currentUser\?\.id/);
});

test('admin create handlers await persistence before success notices', () => {
  assert.match(admin, /const handleCreateEvent = async/);
  assert.match(admin, /await addEvent\(/);
  assert.match(admin, /const handleCreateCategory = async/);
  assert.match(admin, /const \{ division, autoWorkout \} = await addDivision/);
  assert.match(admin, /const handleCreateWorkout = async/);
  assert.match(admin, /const newWod = await addWorkout/);
  assert.match(admin, /const handleCreateCoupon = async/);
  assert.match(admin, /await addCoupon\(/);
  assert.match(admin, /const freshEvent = managerEvents\.find\(evt => evt\.id === selectedEventToManage\.id\)/);
});
