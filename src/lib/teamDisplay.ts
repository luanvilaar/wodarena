/**
 * Deriva o nome de exibição da equipe a partir do campo `name` do atleta.
 *
 * Inscrições de equipe gravam o nome no formato
 * "Nome da Equipe (Atleta1 / Atleta2)". Esse `name` é acoplado ao `athlete_name`
 * da inscrição (usado, por exemplo, na busca de envio de e-mail), então não o
 * alteramos na origem — derivamos o nome "limpo" apenas na camada de exibição.
 * Funciona tanto para inscrições novas quanto legadas.
 *
 * Para atletas individuais (não-equipe) retorna o nome sem alteração.
 */
export const getTeamDisplayName = (athlete: { name: string; isTeam?: boolean }): string => {
  if (!athlete?.name) return '';
  if (!athlete.isTeam) return athlete.name;
  const stripped = athlete.name.replace(/\s*\([^()]*\)\s*$/, '').trim();
  return stripped || athlete.name;
};
