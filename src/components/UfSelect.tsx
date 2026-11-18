import { BR_UFS, normalizeUf } from '@/lib/ufFlags';

// Seletor das 27 UFs do cadastro (Story 1.154). Mostra "CE · Ceará" e devolve só a
// sigla. O valor passa por normalizeUf: um rascunho ou cadastro antigo com o nome
// por extenso ("Ceará") aparece já selecionado, e um valor que não é UF aparece vazio.
// O rótulo (com ou sem "*") fica por conta de quem usa.

type UfSelectProps = {
  id: string;
  name: string;
  value: string;
  onChange: (uf: string) => void;
  placeholder: string;
  className: string;
  required?: boolean;
};

export function UfSelect({ id, name, value, onChange, placeholder, className, required = false }: UfSelectProps) {
  return (
    <select
      id={id}
      name={name}
      required={required}
      value={normalizeUf(value) ?? ''}
      onChange={(event) => onChange(event.target.value)}
      className={className}
    >
      <option value="">{placeholder}</option>
      {BR_UFS.map((item) => (
        <option key={item.uf} value={item.uf}>{item.uf} · {item.name}</option>
      ))}
    </select>
  );
}
