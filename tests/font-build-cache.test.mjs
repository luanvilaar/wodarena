import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const compiled = ts.transpileModule(readFileSync(new URL('../next.config.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
}).outputText;

// Precisa ser um arquivo real dentro do projeto (não uma data: URL) para que
// o import de especificadores nus como "next-intl/plugin" resolva contra
// node_modules normalmente.
const tempConfigUrl = new URL(`./.next-config-under-test.${Date.now()}.mjs`, import.meta.url);
writeFileSync(tempConfigUrl, compiled, 'utf8');
let nextConfig;
try {
  ({ default: nextConfig } = await import(tempConfigUrl.href));
} finally {
  unlinkSync(tempConfigUrl);
}

// O plugin do next-intl envolve nextConfig.webpack e usa config.context
// internamente (para resolver o alias de "next-intl/config") — o mock
// precisa incluir esse campo, como o webpack real sempre faz.
const projectRoot = new URL('..', import.meta.url).pathname;

test('successive production builds cannot reuse font CSS containing an earlier deployment URL', () => {
  const makeConfig = () => ({ context: projectRoot, cache: { type: 'filesystem', version: 'next-version', cacheDirectory: '/tmp/cache' } });
  const first = nextConfig.webpack(makeConfig(), { dev: false, buildId: 'build-a' });
  const second = nextConfig.webpack(makeConfig(), { dev: false, buildId: 'build-b' });
  assert.notEqual(first.cache.version, second.cache.version);
  assert.equal(first.cache.type, 'filesystem');
  assert.equal(first.cache.cacheDirectory, '/tmp/cache');
});

test('development cache and explicitly disabled cache remain unchanged', () => {
  // O plugin do next-intl injeta um resolveAlias em turbopack (aponta para
  // src/i18n/request.ts) — comportamento esperado da integração, não uma
  // regressão do nosso próprio config.
  assert.deepEqual(nextConfig.turbopack, {
    resolveAlias: { 'next-intl/config': './src/i18n/request.ts' }
  });
  const development = { context: projectRoot, cache: { type: 'filesystem', version: 'next-version' } };
  nextConfig.webpack(development, { dev: true, buildId: 'development' });
  assert.equal(development.cache.version, 'next-version');
  assert.equal(nextConfig.webpack({ context: projectRoot, cache: false }, { dev: false, buildId: 'production' }).cache, false);
});
