// Rótulo do status de pagamento de uma inscrição com a origem dele (Story 1.138).
// "Cancelado" sozinho juntava o PIX que expirou sem pagamento, o cancelamento
// feito pelo gestor e o estorno no Mercado Pago, e o gestor não tinha como
// saber quem cancelou. Módulo puro, sem imports, para o node --test.

export type PaymentStatusTone = 'success' | 'danger' | 'warning';

export type RegistrationCancellationOrigin =
  // O gestor cancelou pelo painel ou pela CLI (cancelled_by preenchido).
  | 'manager'
  // O PIX gerado não foi pago e expirou: cancelamento automático do Mercado Pago.
  | 'pix_expired'
  // O próprio atleta cancelou o pagamento no Mercado Pago.
  | 'payer_cancelled'
  // O pagamento foi estornado no Mercado Pago.
  | 'refunded'
  // O titular do cartão contestou a cobrança (chargeback).
  | 'charged_back'
  // Pagamento aprovado depois do cancelamento pelo gestor (Story 1.137).
  | 'paid_after_cancellation'
  // Outro cancelamento vindo do gateway.
  | 'gateway';

export type RegistrationPaymentStatusInput = {
  paymentStatus?: string | null;
  paymentStatusDetail?: string | null;
  cancelledBy?: string | null;
};

export type RegistrationPaymentStatusDescription = {
  label: string;
  tone: PaymentStatusTone;
  cancellation?: {
    origin: RegistrationCancellationOrigin;
    title: string;
    // Texto fixo da origem; o motivo e a data do gestor entram na tela.
    description: string;
    // Houve dinheiro recebido nesta inscrição (mostra a área de reembolso).
    moneyReceived: boolean;
  };
};

const CANCELLATIONS: Record<RegistrationCancellationOrigin, {
  label: string;
  tone: PaymentStatusTone;
  title: string;
  description: string;
  moneyReceived: boolean;
}> = {
  paid_after_cancellation: {
    label: 'Pago após o cancelamento',
    tone: 'warning',
    title: 'Pagamento recebido após o cancelamento',
    description: 'O atleta pagou depois que a inscrição foi cancelada, e ela continua cancelada. Devolva o valor ao atleta ou, para mantê-lo no evento, faça uma nova inscrição pela bilheteria.',
    moneyReceived: true
  },
  refunded: {
    label: 'Estornado',
    tone: 'danger',
    title: 'Pagamento estornado no Mercado Pago',
    description: 'O valor foi devolvido ao atleta pelo Mercado Pago e a inscrição foi cancelada automaticamente.',
    moneyReceived: true
  },
  charged_back: {
    label: 'Contestado',
    tone: 'danger',
    title: 'Pagamento contestado pelo titular do cartão',
    description: 'O titular do cartão contestou a cobrança (chargeback) e a inscrição foi cancelada automaticamente.',
    moneyReceived: true
  },
  manager: {
    label: 'Cancelado pelo gestor',
    tone: 'danger',
    title: 'Cancelada pelo gestor',
    description: 'Cancelamento registrado pela organização do evento.',
    moneyReceived: true
  },
  pix_expired: {
    label: 'PIX expirado',
    tone: 'warning',
    title: 'PIX expirado sem pagamento',
    description: 'O PIX gerado não foi pago dentro do prazo e o Mercado Pago o cancelou automaticamente. Ninguém da equipe cancelou esta inscrição.',
    moneyReceived: false
  },
  payer_cancelled: {
    label: 'Cancelado pelo atleta',
    tone: 'warning',
    title: 'Pagamento cancelado pelo atleta',
    description: 'O atleta cancelou o pagamento no Mercado Pago antes de concluir.',
    moneyReceived: false
  },
  gateway: {
    label: 'Cancelado no pagamento',
    tone: 'danger',
    title: 'Pagamento cancelado no Mercado Pago',
    description: 'O pagamento foi cancelado pelo meio de pagamento, sem ação da equipe.',
    moneyReceived: false
  }
};

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

export const getCancellationOrigin = (registration: RegistrationPaymentStatusInput): RegistrationCancellationOrigin => {
  const detail = text(registration.paymentStatusDetail);
  // Os casos que só acontecem depois de um pagamento vêm primeiro: dizem mais
  // que o "cancelado pelo gestor" que os antecedeu.
  if (detail === 'paid_after_cancellation') return 'paid_after_cancellation';
  if (detail === 'refunded') return 'refunded';
  if (detail === 'charged_back') return 'charged_back';
  if (text(registration.cancelledBy)) return 'manager';
  if (detail === 'expired') return 'pix_expired';
  if (detail === 'by_payer') return 'payer_cancelled';
  return 'gateway';
};

export const describeRegistrationPaymentStatus = (
  registration: RegistrationPaymentStatusInput
): RegistrationPaymentStatusDescription => {
  switch (registration.paymentStatus) {
    case 'payment_approved':
      return { label: 'Aprovado', tone: 'success' };
    case 'payment_failed':
      return { label: 'Pagamento recusado', tone: 'danger' };
    case 'payment_in_review':
      return { label: 'Em análise', tone: 'warning' };
    case 'payment_cancelled': {
      const origin = getCancellationOrigin(registration);
      const { label, tone, title, description, moneyReceived } = CANCELLATIONS[origin];
      return { label, tone, cancellation: { origin, title, description, moneyReceived } };
    }
    case 'payment_pending':
    default:
      return { label: 'Pendente', tone: 'warning' };
  }
};
