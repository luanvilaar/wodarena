// Rotas de painel com moldura própria, sem o menu e o rodapé do site público
// (Story 1.123, decisão D2 de docs/design/painel-proprietario/).
export const isStandalonePanelPath = (pathname: string | null | undefined): boolean =>
  pathname === '/owner' || Boolean(pathname?.startsWith('/owner/'));
