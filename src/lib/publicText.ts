// Texto que o painel gravava como descrição quando o gestor deixava o campo
// vazio (até a Story 1.127). É um aviso para o gestor, não conteúdo do evento:
// nas telas públicas conta como descrição vazia.
export const LEGACY_EMPTY_DESCRIPTION = 'Sem descrição cadastrada.';

export function publicDescription(text: string | null | undefined): string {
  const trimmed = (text ?? '').trim();
  return trimmed === LEGACY_EMPTY_DESCRIPTION ? '' : trimmed;
}
