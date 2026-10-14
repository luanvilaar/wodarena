// Token do Mapbox no navegador (Story 1.42). O mapa interativo (Mapbox GL JS)
// roda no cliente e precisa do token no JavaScript da página. O next.config.ts
// preenche essa variável no build com o valor dela ou, na falta, com o token
// de servidor (decisão do usuário de usar o token que já está no .env). Sem
// token, o mapa não aparece e o card segue só com os botões.
//
// A referência literal a process.env.NEXT_PUBLIC_MAPBOX_TOKEN precisa ficar
// escrita assim: é o que o Next troca pelo valor no build.
export const getMapboxPublicToken = () => (process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '').trim();
