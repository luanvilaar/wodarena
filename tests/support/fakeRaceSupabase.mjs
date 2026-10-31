// Extensão do banco em memória (fakeSupabase.mjs) para a súmula Fitness Race
// (Story 1.94). O fakeSupabase só conhece as chaves únicas das tabelas antigas;
// este arquivo acrescenta as das tabelas race_* (as mesmas da migration
// 20261030120000_race_sheets.sql), devolvendo 23505 sem gravar, e simula o
// banco sem a migration (42P01 em qualquer tabela race_*). Fica num arquivo
// próprio para não mexer no fakeSupabase.mjs nem no serverModuleHarness.mjs.

const RACE_UNIQUE_KEYS = {
  race_rulesets: [
    { name: 'race_rulesets_pkey', key: (row) => row.id },
    { name: 'race_rulesets_event_id_version_key', key: (row) => `${row.event_id}|${row.version}` }
  ],
  race_runs: [
    { name: 'race_runs_pkey', key: (row) => row.id },
    { name: 'race_runs_one_active_per_athlete', key: (row) => (row.status === 'cancelled' ? null : `${row.event_id}|${row.athlete_id}`) }
  ],
  race_attempts: [
    { name: 'race_attempts_pkey', key: (row) => row.id },
    { name: 'race_attempts_one_active_per_station', key: (row) => (row.status === 'cancelled' ? null : `${row.run_id}|${row.station_id}`) }
  ],
  race_attempt_events: [
    { name: 'race_attempt_events_pkey', key: (row) => `${row.attempt_id}|${row.seq}` },
    { name: 'race_attempt_events_attempt_id_client_event_id_key', key: (row) => `${row.attempt_id}|${row.client_event_id}` }
  ],
  race_infractions: [
    { name: 'race_infractions_pkey', key: (row) => row.id },
    { name: 'race_infractions_run_id_source_key_key', key: (row) => `${row.run_id}|${row.source_key}` }
  ],
  race_decisions: [{ name: 'race_decisions_pkey', key: (row) => row.id }],
  race_heat_marks: [{ name: 'race_heat_marks_pkey', key: (row) => `${row.event_id}|${row.heat_id}` }]
};

const resolved = (result) => {
  const query = new Proxy({}, {
    get: (_, prop) => (prop === 'then' ? (resolve) => resolve(result) : () => query)
  });
  return query;
};

const conflictIn = (table, existing, candidates) => {
  for (const [index, candidate] of candidates.entries()) {
    const others = [...existing, ...candidates.slice(0, index)];
    for (const { name, key } of RACE_UNIQUE_KEYS[table]) {
      const value = key(candidate);
      if (value === null || value === undefined) continue;
      if (others.some((row) => key(row) === value)) return name;
    }
  }
  return null;
};

/**
 * Cliente para o harness: o `database` de createFakeSupabase com as chaves
 * únicas das tabelas race_* e `neq` (o fakeSupabase só tem `not`).
 * - `state.missingRaceTables = true`: qualquer consulta a race_* falha como no
 *   banco sem a migration;
 * - `state.beforeUpdate[tabela] = fn`: roda `fn(database)` uma vez, quando o
 *   próximo update da tabela é montado (antes dos filtros rodarem): simula
 *   outra requisição gravando no meio;
 * - `state.beforeCount[tabela] = fn`: idem, na próxima contagem (`head: true`).
 */
export const createRaceClient = (getDatabase, state = { missingRaceTables: false }) => ({
  from: (table) => {
    const database = getDatabase();
    if (table.startsWith('race_') && state.missingRaceTables) {
      return resolved({ data: null, error: { code: '42P01', message: `relation "public.${table}" does not exist` } });
    }
    const query = database.client.from(table);
    if (!RACE_UNIQUE_KEYS[table]) return query;
    const once = (hooks) => {
      const callback = hooks?.[table];
      if (!callback) return;
      delete hooks[table];
      callback(database);
    };
    const proxy = new Proxy(query, {
      get(target, prop) {
        if (prop === 'insert') {
          return (payload) => {
            // O gatilho de onceBeforeInsert (outra requisição gravando no meio) roda antes da conferência.
            database.runBeforeInsert(table);
            const candidates = Array.isArray(payload) ? payload : [payload];
            const conflict = conflictIn(table, database.rows(table), candidates);
            if (conflict) {
              return resolved({ data: null, error: { code: '23505', message: `duplicate key value violates unique constraint "${conflict}"` } });
            }
            target.insert(payload);
            return proxy;
          };
        }
        if (prop === 'neq') return (column, value) => { target.not(column, 'eq', value); return proxy; };
        if (prop === 'update') return (patch) => { once(state.beforeUpdate); target.update(patch); return proxy; };
        if (prop === 'select') {
          return (columns, options) => {
            if (options?.head) once(state.beforeCount);
            target.select(columns, options);
            return proxy;
          };
        }
        const value = target[prop];
        if (typeof value !== 'function') return value;
        // Encadeamento: o que devolve a própria consulta volta pelo proxy.
        return (...args) => {
          const result = value.apply(target, args);
          return result === target ? proxy : result;
        };
      }
    });
    return proxy;
  },
  rpc: (name, args) => getDatabase().client.rpc(name, args)
});
