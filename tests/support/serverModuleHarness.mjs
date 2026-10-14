// Carrega módulos reais do servidor (src/**/*.ts) dentro do node --test.
// - resolve o alias @/ e imports relativos sem extensão para arquivos de src/;
// - transpila TypeScript com o pacote typescript (imports só de tipo somem);
// - troca next/dynamic por um componente vazio, next/server por um NextResponse
//   mínimo e @supabase/supabase-js por
//   um createClient que devolve o banco em memória ativo (ver fakeSupabase.mjs).
// Nada de rede, banco real ou .env. Os hooks valem só para o processo do teste
// que importar este arquivo (o node --test isola cada arquivo de teste).

import { existsSync, readFileSync, statSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const SRC_URL = new URL('../../src/', import.meta.url);
const STUB_URL_PREFIX = `${import.meta.url}?stub=`;

const STUB_SOURCES = {
  'next/server': `
export class NextResponse extends Response {
  static json(body, init = {}) {
    const headers = new Headers(init.headers);
    if (!headers.has('content-type')) headers.set('content-type', 'application/json');
    return new NextResponse(JSON.stringify(body), { ...init, headers });
  }
}
`,
  // next/dynamic: componentes carregados sob demanda no navegador (ex.: o mapa do Mapbox,
  // Story 1.42) não renderizam nada no servidor, que é o que o teste de marcação enxerga.
  'next/dynamic': `
export default function dynamic() {
  return function DynamicComponentStub() { return null; };
}
`,
  '@supabase/supabase-js': `
import { getActiveSupabaseClient } from ${JSON.stringify(import.meta.url)};
export const createClient = () => getActiveSupabaseClient();
export class SupabaseClient {}
`
};

let activeSupabaseClient = null;

export const setActiveSupabaseClient = (client) => {
  activeSupabaseClient = client;
};

export const getActiveSupabaseClient = () => {
  if (!activeSupabaseClient) {
    throw new Error('serverModuleHarness: nenhum banco em memória ativo (chame setActiveSupabaseClient).');
  }
  return activeSupabaseClient;
};

const isFile = (url) => {
  const path = fileURLToPath(url);
  return existsSync(path) && statSync(path).isFile();
};

const resolveSourceFile = (url) => {
  const candidates = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'].map((suffix) => `${url.href}${suffix}`);
  const found = candidates.find(isFile);
  if (!found) throw new Error(`serverModuleHarness: módulo não encontrado em src/: ${url.href}`);
  return found;
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (Object.hasOwn(STUB_SOURCES, specifier)) {
      return { url: `${STUB_URL_PREFIX}${encodeURIComponent(specifier)}`, shortCircuit: true };
    }
    if (specifier.startsWith('@/')) {
      return { url: resolveSourceFile(new URL(specifier.slice(2), SRC_URL)), shortCircuit: true };
    }
    const fromSource = context.parentURL?.startsWith(SRC_URL.href);
    if (fromSource && (specifier.startsWith('./') || specifier.startsWith('../'))) {
      return { url: resolveSourceFile(new URL(specifier, context.parentURL)), shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith(STUB_URL_PREFIX)) {
      const specifier = decodeURIComponent(url.slice(STUB_URL_PREFIX.length));
      return { format: 'module', source: STUB_SOURCES[specifier], shortCircuit: true };
    }
    if (url.startsWith(SRC_URL.href) && /\.tsx?$/.test(new URL(url).pathname)) {
      const fileName = fileURLToPath(url);
      const { outputText } = ts.transpileModule(readFileSync(fileName, 'utf8'), {
        fileName,
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
          jsx: ts.JsxEmit.ReactJSX
        }
      });
      return { format: 'module', source: outputText, shortCircuit: true };
    }
    return nextLoad(url, context);
  }
});

/** Importa um módulo de src/ (ex.: 'lib/serverCheckout.ts') já com os hooks ativos. */
export const importServerModule = (pathFromSrc) => import(new URL(pathFromSrc, SRC_URL).href);
