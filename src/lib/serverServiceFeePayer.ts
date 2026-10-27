import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeServiceFeePayer, type ServiceFeePayer } from '@/lib/serviceFee';

/**
 * Escolha do gestor sobre quem paga a taxa da plataforma, ou null quando ele
 * ainda não escolheu (vale o padrão do gateway, ver resolveServiceFeePayer).
 * Lança em erro de leitura: cobrar com a regra errada é pior que recusar a venda.
 */
export const loadManagerServiceFeePayer = async (
  supabaseAdmin: SupabaseClient,
  organizerId: string
): Promise<ServiceFeePayer | null> => {
  const { data, error } = await supabaseAdmin
    .from('manager_payment_settings')
    .select('service_fee_payer')
    .eq('user_id', organizerId)
    .maybeSingle<{ service_fee_payer: string | null }>();

  if (error) {
    throw new Error(`Falha ao carregar quem paga a taxa de serviço: ${error.message}`);
  }

  return normalizeServiceFeePayer(data?.service_fee_payer);
};
