import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const appContext = read('../src/context/AppContext.tsx');
const localStorageHook = read('../src/hooks/useLocalStorage.ts');
const publicPayload = read('../src/lib/bootstrapPayload.ts');
const privateRoute = read('../src/app/api/app/bootstrap/route.ts');
const publicEventRoute = read('../src/app/api/app/bootstrap/public/event/[id]/route.ts');
const loadingWrapper = read('../src/components/AppLoadingWrapper.tsx');
const loadingOverlay = read('../src/components/LoadingOverlay.tsx');
const eventPage = read('../src/app/event/[id]/page.tsx');
const leaderboard = read('../src/components/Leaderboard.tsx');
const envExample = read('../.env.example');

test('session hydration gates bootstrap selection and prevents the reload race', () => {
  assert.match(localStorageHook, /const \[isHydrated, setIsHydrated\] = useState\(false\)/);
  assert.match(localStorageHook, /setIsHydrated\(true\)/);
  assert.match(localStorageHook, /return \[storedValue, setValue, isHydrated\]/);
  assert.match(appContext, /if \(!isSessionHydrated\) return/);
  assert.match(appContext, /bootstrapAbortRef\.current\?\.abort\(\)/);
  assert.match(appContext, /const requestId = \+\+bootstrapRequestIdRef\.current/);
  assert.match(appContext, /requestId !== bootstrapRequestIdRef\.current/);
});

test('bootstrap has timeout, cancellation, controlled 401 fallback and retry states', () => {
  assert.match(appContext, /export const BOOTSTRAP_TIMEOUT_MS/);
  assert.match(appContext, /setTimeout\(\(\) => timeoutController\.abort\(\), BOOTSTRAP_TIMEOUT_MS\)/);
  assert.match(appContext, /cache: 'no-store'/);
  assert.match(appContext, /if \(preferPrivate && httpResponse\.response\.status === 401\)/);
  assert.match(appContext, /skipNextPublicBootstrapRef\.current = true/);
  assert.match(appContext, /'loading' \| 'ready' \| 'degraded' \| 'error'/);
  assert.match(appContext, /setRetryNonce\(previous => previous \+ 1\)/);
  assert.match(appContext, /setBootstrapStatus\(hasLoadedBootstrapRef\.current \? 'degraded' : 'error'\)/);
  assert.match(appContext, /\[Bootstrap Client\] Falha/);
  assert.match(appContext, /status: response\.status/);
});

test('public bootstrap is minimal and event data is lazy and single-flight', () => {
  const publicBuilder = publicPayload.match(/export const buildPublicBootstrapPayload[\s\S]*?export const buildPublicEventBootstrapPayload/)?.[0] || '';
  assert.match(publicBuilder, /PUBLIC_EVENT_SELECT/);
  assert.match(publicBuilder, /PUBLIC_DIVISION_SELECT/);
  assert.match(publicBuilder, /PUBLIC_WORKOUT_SELECT/);
  assert.doesNotMatch(publicBuilder, /from\('athletes'\)|from\('scores'\)|from\('leaderboard_entries'\)/);
  assert.match(publicPayload, /export const buildPublicEventBootstrapPayload/);
  assert.match(publicPayload, /\.eq\('event_id', eventId\)/);
  assert.match(appContext, /publicEventRequestsRef = useRef\(new Map<string, Promise<void>>\(\)\)/);
  assert.match(appContext, /const existingRequest = publicEventRequestsRef\.current\.get\(eventId\)/);
  assert.match(appContext, /PUBLIC_EVENT_BOOTSTRAP_ENDPOINT/);
  assert.match(appContext, /const loadPublicEventData = useCallback\(async \(eventId: string\) => \{\s*\/\/ A pagina publica[\s\S]*?if \(!eventId\) return;/);
  assert.doesNotMatch(appContext, /if \(!eventId \|\| currentUser\?\.role === 'owner' \|\| currentUser\?\.role === 'manager'\) return;/);
  assert.match(eventPage, /loadPublicEventData\(eventId\)/);
  assert.match(leaderboard, /loadPublicEventData\(event\.id\)/);
});

test('public event hydration retries empty athlete payloads with a bounded cache', () => {
  assert.match(appContext, /const MAX_PUBLIC_EVENT_DATA_ATTEMPTS = 2/);
  assert.match(appContext, /publicEventLoadAttemptsRef = useRef\(new Map<string, number>\(\)\)/);
  assert.match(appContext, /if \(previousAttempts >= MAX_PUBLIC_EVENT_DATA_ATTEMPTS\) return/);
  assert.match(appContext, /do \{[\s\S]*?publicEventLoadAttemptsRef\.current\.set\(eventId, attemptCount\)[\s\S]*?\} while \(mappedAthletes\.length === 0 && attemptCount < MAX_PUBLIC_EVENT_DATA_ATTEMPTS\)/);
  assert.match(appContext, /setLeaderboardEntries\([\s\S]*?setPublicEventDataStatus\(previous => \(\{ \.\.\.previous, \[eventId\]: 'ready' \}\)\)/);
  assert.doesNotMatch(appContext, /loadedPublicEventIdsRef/);
});

test('private bootstrap applies role scope before returning rows', () => {
  assert.match(privateRoute, /\.eq\('organizer_id', session\.id\)/);
  assert.match(privateRoute, /\.in\('event_id', eventIdFilter\)/);
  assert.match(privateRoute, /\.in\('division_id', divisionIds\)/);
  assert.match(privateRoute, /\.in\('workout_id', workoutIds\)/);
  assert.match(privateRoute, /\.eq\('user_id', session\.id\)/);
  assert.match(privateRoute, /registrationsCount: null/);
  assert.match(privateRoute, /readBootstrapQuery/);
});

test('shell remains visible and exposes recoverable bootstrap errors', () => {
  assert.match(loadingWrapper, /\{children\}/);
  assert.match(loadingWrapper, /bootstrapStatus === 'error' \|\| bootstrapStatus === 'degraded'/);
  assert.match(loadingWrapper, /onClick=\{retryBootstrap\}/);
  assert.match(loadingOverlay, /role="status"/);
  assert.doesNotMatch(loadingOverlay, /fixed inset-0/);
  assert.doesNotMatch(appContext, /INITIAL_(EVENTS|ATHLETES|SCORES|USERS)/);
});

test('public event endpoint and timeout configuration are present', () => {
  assert.match(publicEventRoute, /buildPublicEventBootstrapPayload/);
  assert.match(publicEventRoute, /status: 404/);
  assert.match(publicEventRoute, /status: 500/);
  assert.match(envExample, /NEXT_PUBLIC_BOOTSTRAP_TIMEOUT_MS=12000/);
});
