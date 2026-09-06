import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const compiled = ts.transpileModule(readFileSync(new URL('../next.config.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
}).outputText;
const { default: nextConfig } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('successive production builds cannot reuse font CSS containing an earlier deployment URL', () => {
  const makeConfig = () => ({ cache: { type: 'filesystem', version: 'next-version', cacheDirectory: '/tmp/cache' } });
  const first = nextConfig.webpack(makeConfig(), { dev: false, buildId: 'build-a' });
  const second = nextConfig.webpack(makeConfig(), { dev: false, buildId: 'build-b' });
  assert.notEqual(first.cache.version, second.cache.version);
  assert.equal(first.cache.type, 'filesystem');
  assert.equal(first.cache.cacheDirectory, '/tmp/cache');
});

test('development cache and explicitly disabled cache remain unchanged', () => {
  assert.deepEqual(nextConfig.turbopack, {});
  const development = { cache: { type: 'filesystem', version: 'next-version' } };
  nextConfig.webpack(development, { dev: true, buildId: 'development' });
  assert.equal(development.cache.version, 'next-version');
  assert.equal(nextConfig.webpack({ cache: false }, { dev: false, buildId: 'production' }).cache, false);
});
