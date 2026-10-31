import { Anton } from 'next/font/google';

// Fonte de display só da tela de login (Story 1.92, docs/design/login-novo/).
// Declarada aqui, e não no layout, para carregar apenas em /admin.
export const loginDisplayFont = Anton({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-login-display',
  display: 'swap',
});
