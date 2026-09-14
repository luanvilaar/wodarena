import { getMessages } from 'next-intl/server';

// Narrowing de namespaces: cada página client component só recebe as chaves
// de tradução que ela (e os componentes que renderiza) realmente usa, em vez
// do dicionário inteiro — evita que a home carregue o namespace de checkout
// no bundle, por exemplo.
export async function getScopedMessages<K extends string>(namespaces: K[]): Promise<Record<K, unknown>> {
  const messages = (await getMessages()) as Record<string, unknown>;
  const scoped = {} as Record<K, unknown>;
  for (const namespace of namespaces) {
    scoped[namespace] = messages[namespace];
  }
  return scoped;
}
