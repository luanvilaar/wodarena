import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  describeRegistrationPaymentStatus,
  getCancellationOrigin
} from '../src/lib/registrationPaymentStatusLabel.ts';

// Story 1.138: o painel diz de onde veio o cancelamento. Antes, o PIX que
// expirou aparecia como "Cancelado" com o texto "Cancelamento registrado pelo
// gestor.", e o gestor não tinha como saber que ninguém da equipe cancelou.

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const adminPage = read('../src/app/admin/page.tsx');
const dashboard = read('../src/components/admin/DashboardOverview.tsx');

const cancelled = (overrides = {}) => ({ paymentStatus: 'payment_cancelled', paymentStatusDetail: null, cancelledBy: null, ...overrides });

test('status sem cancelamento mantêm os rótulos, com "Pagamento recusado" no lugar de "Pagamento falhou"', () => {
  assert.deepEqual(describeRegistrationPaymentStatus({ paymentStatus: 'payment_approved' }), { label: 'Aprovado', tone: 'success' });
  assert.deepEqual(describeRegistrationPaymentStatus({ paymentStatus: 'payment_pending' }), { label: 'Pendente', tone: 'warning' });
  assert.deepEqual(describeRegistrationPaymentStatus({ paymentStatus: 'payment_in_review' }), { label: 'Em análise', tone: 'warning' });
  assert.deepEqual(describeRegistrationPaymentStatus({ paymentStatus: 'payment_failed' }), { label: 'Pagamento recusado', tone: 'danger' });
  assert.deepEqual(describeRegistrationPaymentStatus({}), { label: 'Pendente', tone: 'warning' });
});

test('PIX expirado é automático, diz que ninguém da equipe cancelou e não tem reembolso', () => {
  const status = describeRegistrationPaymentStatus(cancelled({ paymentStatusDetail: 'expired' }));
  assert.equal(status.label, 'PIX expirado');
  assert.equal(status.cancellation.origin, 'pix_expired');
  assert.match(status.cancellation.description, /Ninguém da equipe cancelou/);
  assert.equal(status.cancellation.moneyReceived, false);
});

test('cancelamento do gestor (painel ou CLI) aparece como dele, com área de reembolso', () => {
  for (const detail of ['manager_cancelled', 'manager_cancelled_cli', 'expired']) {
    const status = describeRegistrationPaymentStatus(cancelled({ paymentStatusDetail: detail, cancelledBy: 'org-1' }));
    assert.equal(status.label, 'Cancelado pelo gestor', detail);
    assert.equal(status.cancellation.origin, 'manager', detail);
    assert.equal(status.cancellation.moneyReceived, true, detail);
  }
});

test('estorno, contestação e pagamento após o cancelamento têm rótulo próprio, mesmo com o gestor como autor', () => {
  assert.equal(describeRegistrationPaymentStatus(cancelled({ paymentStatusDetail: 'refunded' })).label, 'Estornado');
  assert.equal(describeRegistrationPaymentStatus(cancelled({ paymentStatusDetail: 'charged_back' })).label, 'Contestado');
  const late = describeRegistrationPaymentStatus(cancelled({ paymentStatusDetail: 'paid_after_cancellation', cancelledBy: 'org-1' }));
  assert.equal(late.label, 'Pago após o cancelamento');
  assert.equal(late.tone, 'warning');
  assert.equal(late.cancellation.moneyReceived, true);
  assert.match(late.cancellation.description, /continua cancelada/);
  assert.equal(getCancellationOrigin(cancelled({ paymentStatusDetail: 'refunded', cancelledBy: 'org-1' })), 'refunded');
});

test('pagamento cancelado pelo atleta ou outro cancelamento do gateway não é atribuído ao gestor', () => {
  assert.equal(describeRegistrationPaymentStatus(cancelled({ paymentStatusDetail: 'by_payer' })).label, 'Cancelado pelo atleta');
  const other = describeRegistrationPaymentStatus(cancelled({ paymentStatusDetail: 'by_collector' }));
  assert.equal(other.label, 'Cancelado no pagamento');
  assert.equal(other.cancellation.origin, 'gateway');
  assert.equal(other.cancellation.moneyReceived, false);
});

test('o painel usa o rótulo com a origem em todos os lugares que mostram o status', () => {
  assert.match(adminPage, /import \{ describeRegistrationPaymentStatus \} from '@\/lib\/registrationPaymentStatusLabel';/);
  assert.doesNotMatch(adminPage, /getPaymentStatusMeta\(reg\.paymentStatus\)/);
  assert.equal((adminPage.match(/getPaymentStatusMeta\(reg\.paymentStatus, reg\)/g) || []).length, 3);
  assert.doesNotMatch(dashboard, /getPaymentStatusMeta\(reg\.paymentStatus\)/);
  assert.equal((dashboard.match(/getPaymentStatusMeta\(reg\.paymentStatus, reg\)/g) || []).length, 2);
});

test('o bloco de cancelamento não atribui mais ao gestor o que ele não fez', () => {
  assert.doesNotMatch(adminPage, /'Cancelamento registrado pelo gestor\.'/);
  assert.match(adminPage, /\{cancellationInfo\.title\}/);
  assert.match(adminPage, /cancellationInfo\.origin === 'manager'\s*\?\s*\(reg\.cancellationReason \|\| cancellationInfo\.description\)/);
  assert.match(adminPage, /&& cancellationInfo\?\.moneyReceived !== false;/);
});
