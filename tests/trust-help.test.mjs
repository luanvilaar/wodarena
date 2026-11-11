import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { importServerModule } from './support/serverModuleHarness.mjs';

// Story 1.135: confiança e ajuda ao atleta (P8 de docs/design/mobile-competitivo/).

const { readCompanyInfo, whatsappHref } = await importServerModule('lib/companyInfo.ts');
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const footer = read('../src/components/Footer.tsx');
const help = read('../src/app/[locale]/ajuda/page.tsx');
const eventView = read('../src/app/[locale]/event/[id]/EventView.tsx');
const claude = read('../CLAUDE.md');
const messages = Object.fromEntries(['pt-br', 'pt-pt', 'en-gb'].map((l) => [l, JSON.parse(read(`../src/messages/${l}.json`))]));

test('dados da empresa e do suporte só aparecem quando configurados', () => {
  assert.deepEqual(readCompanyInfo({}), { legalName: null, cnpj: null, supportEmail: null, supportWhatsapp: null });
  const info = readCompanyInfo({
    NEXT_PUBLIC_COMPANY_LEGAL_NAME: ' WODArena Ltda ', NEXT_PUBLIC_COMPANY_CNPJ: '00.000.000/0001-00',
    NEXT_PUBLIC_SUPPORT_EMAIL: 'suporte@exemplo.com', NEXT_PUBLIC_SUPPORT_WHATSAPP: '+55 (85) 99999-0000'
  });
  assert.equal(info.legalName, 'WODArena Ltda');
  assert.equal(info.supportWhatsapp, '5585999990000');
  assert.equal(readCompanyInfo({ NEXT_PUBLIC_SUPPORT_WHATSAPP: '123' }).supportWhatsapp, null, 'número curto demais não vira link');
  assert.equal(whatsappHref('5585999990000'), 'https://wa.me/5585999990000');
});

test('rodapé escuro, links distintos, pagamento e empresa condicional', () => {
  assert.match(footer, /<footer className="mt-auto border-t border-card-border bg-dark-gray text-foreground">/);
  assert.doesNotMatch(footer, /bg-surface-soft-light|text-ink|hairline-light|#a87f00/);
  assert.equal((footer.match(/href="\/#eventos"/g) ?? []).length, 0, 'sem links repetidos para /#eventos');
  assert.match(footer, /<Link href="\/ajuda"/);
  assert.match(footer, /<NextLink href="\/admin#inscricoes"/);
  assert.match(footer, /\{company\.legalName && \(/);
  assert.match(footer, /t\('paymentMethods'\)/);
});

test('central de ajuda com as dúvidas do atleta e canal condicional', () => {
  for (const key of ['voucher', 'pixPending', 'changeDivision', 'refund', 'ranking', 'password', 'teamData']) {
    assert.match(help, new RegExp(`'${key}'`));
    for (const [locale, json] of Object.entries(messages)) {
      assert.ok(json.Help.q[key] && json.Help.a[key], `${locale}: Help.${key}`);
    }
  }
  assert.match(help, /<details key=\{key\} className="group">/);
  assert.match(help, /\{hasSupport \? \(/);
  assert.match(help, /t\('contactOrganizer'\)/);
});

test('página do evento: bloco da organização com contatos e a central de ajuda', () => {
  assert.match(eventView, /tSidebar\('organizerHeading'\)/);
  assert.match(eventView, /<Link href="\/ajuda"/);
  assert.doesNotMatch(eventView, /tSidebar\('supportHeading'\)/);
  for (const json of Object.values(messages)) {
    assert.ok(json.Event.sidebar.organizerHeading && json.Event.sidebar.helpCenterLink);
    assert.ok(json.Footer.helpLink && json.Footer.athleteHeading && json.Footer.companyLine);
  }
});

test('variáveis novas documentadas no CLAUDE.md', () => {
  for (const name of ['NEXT_PUBLIC_COMPANY_LEGAL_NAME', 'NEXT_PUBLIC_COMPANY_CNPJ', 'NEXT_PUBLIC_SUPPORT_EMAIL', 'NEXT_PUBLIC_SUPPORT_WHATSAPP']) {
    assert.match(claude, new RegExp(name));
  }
});
