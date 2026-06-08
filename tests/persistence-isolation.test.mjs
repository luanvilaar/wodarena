import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const context = readFileSync(new URL('../src/context/AppContext.tsx', import.meta.url), 'utf8');
const admin = readFileSync(new URL('../src/app/admin/page.tsx', import.meta.url), 'utf8');
const persistenceRoute = readFileSync(new URL('../src/app/api/admin/persistence/route.ts', import.meta.url), 'utf8');

test('event and child creation waits for server persistence before updating local state', () => {
  assert.match(context, /const addEvent = async[\s\S]*Promise<Event>/);
  assert.match(context, /await adminPersist\('createEvent'/);
  assert.match(persistenceRoute, /case 'createEvent'/);
  assert.match(persistenceRoute, /supabaseAdmin\.from\('events'\)\.insert\(event\)/);
  assert.match(context, /setEvents\(prev => \[\.\.\.prev, newEvent\]\)/);
  assert.match(context, /const addDivision = async[\s\S]*Promise<\{ division: Division; autoWorkout: Workout \| null \}>/);
  assert.match(context, /const addWorkout = async[\s\S]*Promise<Workout>/);
});

test('manager mutations are routed through authenticated server ownership checks', () => {
  assert.match(context, /createScopedId\('evt', currentUser\.id, eventData\.name\)/);
  assert.match(context, /fetch\('\/api\/admin\/persistence'/);
  assert.doesNotMatch(context, /supabase\.from\(/);
  assert.match(persistenceRoute, /requireSession\(request, \['manager', 'owner'\]\)/);
  assert.match(persistenceRoute, /event\.organizer_id !== actor\.id/);
  assert.match(persistenceRoute, /ensureDivisionOwner\(supabaseAdmin, actor, payload\.divisionId, payload\.eventId\)/);
  assert.match(persistenceRoute, /ensureWorkoutOwner\(supabaseAdmin, actor, payload\.workoutId, payload\.eventId\)/);
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
