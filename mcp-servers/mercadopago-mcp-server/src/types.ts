export enum ResponseFormat {
  MARKDOWN = 'markdown',
  JSON = 'json',
}

export interface MpIdentification {
  type: string;
  number: string;
}

export interface MpPayer {
  id?: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  identification?: MpIdentification;
  phone?: { area_code?: string; number?: string };
}

export interface MpFeeDetail {
  type: string;
  amount: number;
  fee_payer: string;
}

export interface MpPixData {
  qr_code?: string;
  qr_code_base64?: string;
  ticket_url?: string;
  transaction_id?: string;
}

export interface MpPayment {
  id: number;
  status: string;
  status_detail: string;
  transaction_amount: number;
  net_received_amount?: number;
  currency_id: string;
  description?: string;
  payment_method_id: string;
  payment_type_id: string;
  payer: MpPayer;
  date_created: string;
  date_approved?: string | null;
  date_last_updated: string;
  external_reference?: string | null;
  metadata?: Record<string, unknown>;
  installments?: number;
  application_fee?: number;
  fee_details?: MpFeeDetail[];
  point_of_interaction?: { transaction_data?: MpPixData };
  card?: {
    first_six_digits?: string;
    last_four_digits?: string;
    expiration_month?: number;
    expiration_year?: number;
    cardholder?: { name?: string };
  };
}

export interface MpItem {
  id?: string;
  title: string;
  description?: string;
  quantity: number;
  currency_id: string;
  unit_price: number;
}

export interface MpPreference {
  id: string;
  init_point: string;
  sandbox_init_point?: string;
  items: MpItem[];
  payer?: { name?: string; email?: string; phone?: { number?: string } };
  back_urls?: { success?: string; failure?: string; pending?: string };
  auto_return?: string;
  notification_url?: string;
  metadata?: Record<string, unknown>;
  date_created?: string;
  marketplace_fee?: number;
  external_reference?: string;
}

export interface MpRefund {
  id: number;
  payment_id: number;
  amount: number;
  status: string;
  date_created: string;
  metadata?: Record<string, unknown>;
}

export interface MpPaymentMethod {
  id: string;
  name: string;
  payment_type_id: string;
  status: string;
  min_allowed_amount?: number;
  max_allowed_amount?: number;
  processing_modes?: string[];
}

export interface MpSearchResult<T> {
  results: T[];
  paging: { total: number; limit: number; offset: number };
}

export interface MpOAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
  user_id: number;
  refresh_token?: string;
  public_key?: string;
  live_mode?: boolean;
}
