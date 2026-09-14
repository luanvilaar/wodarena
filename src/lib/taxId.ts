import type { EventCountryCode } from '@/types';

export type TaxIdField = 'cpf' | 'nif' | null;

export type TaxIdRequirement = {
  field: TaxIdField;
  required: boolean;
};

// BR: o Mercado Pago exige identification.type='CPF' em toda cobrança.
// PT: NIF é opcional (só interessa para o recibo), o Stripe não exige.
// GB: não existe documento fiscal de pessoa física equivalente no checkout.
export const getTaxIdRequirement = (countryCode: EventCountryCode): TaxIdRequirement => {
  switch (countryCode) {
    case 'BR':
      return { field: 'cpf', required: true };
    case 'PT':
      return { field: 'nif', required: false };
    case 'GB':
    default:
      return { field: null, required: false };
  }
};

export const isValidCPF = (value: string): boolean => {
  const clean = value.replace(/\D/g, '');
  if (clean.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(clean)) return false;

  let sum = 0;
  let remainder;
  for (let i = 1; i <= 9; i++) sum += parseInt(clean.substring(i - 1, i), 10) * (11 - i);
  remainder = (sum * 10) % 11;
  if (remainder === 10 || remainder === 11) remainder = 0;
  if (remainder !== parseInt(clean.substring(9, 10), 10)) return false;

  sum = 0;
  for (let i = 1; i <= 10; i++) sum += parseInt(clean.substring(i - 1, i), 10) * (12 - i);
  remainder = (sum * 10) % 11;
  if (remainder === 10 || remainder === 11) remainder = 0;
  if (remainder !== parseInt(clean.substring(10, 11), 10)) return false;

  return true;
};

// Checksum mod-11 do NIF português (dígito de controlo).
export const isValidNIF = (value: string): boolean => {
  const clean = value.replace(/\D/g, '');
  if (clean.length !== 9) return false;

  const digits = clean.split('').map((d) => parseInt(d, 10));
  const checkDigit = digits[8];
  const sum = digits.slice(0, 8).reduce((acc, digit, index) => acc + digit * (9 - index), 0);
  const remainder = sum % 11;
  const expected = remainder < 2 ? 0 : 11 - remainder;

  return checkDigit === expected;
};

export const isValidTaxId = (field: TaxIdField, value: string): boolean => {
  if (field === 'cpf') return isValidCPF(value);
  if (field === 'nif') return isValidNIF(value);
  return true;
};
