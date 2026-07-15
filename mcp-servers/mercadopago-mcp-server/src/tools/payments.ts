import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { mpRequest, handleMpError } from '../services/mercadopago.js';
import { ResponseFormat, MpPayment, MpSearchResult, MpPaymentMethod } from '../types.js';
import { CHARACTER_LIMIT, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../constants.js';

const ACCESS_TOKEN_FIELD = z
  .string()
  .optional()
  .describe(
    'Optional access token override. Defaults to MERCADOPAGO_ACCESS_TOKEN env var. ' +
    'Use for marketplace scenarios where you act on behalf of a connected account.'
  );

function formatPaymentMarkdown(p: MpPayment): string {
  const lines: string[] = [
    `## Payment #${p.id}`,
    '',
    `- **Status:** ${p.status} (${p.status_detail})`,
    `- **Amount:** ${p.currency_id} ${p.transaction_amount.toFixed(2)}`,
    `- **Method:** ${p.payment_method_id} (${p.payment_type_id})`,
    `- **Created:** ${new Date(p.date_created).toLocaleString('pt-BR')}`,
  ];

  if (p.date_approved) {
    lines.push(`- **Approved:** ${new Date(p.date_approved).toLocaleString('pt-BR')}`);
  }
  if (p.external_reference) {
    lines.push(`- **External Ref:** ${p.external_reference}`);
  }
  if (p.description) {
    lines.push(`- **Description:** ${p.description}`);
  }
  if (p.payer?.email) {
    const name = [p.payer.first_name, p.payer.last_name].filter(Boolean).join(' ');
    lines.push(`- **Payer:** ${name ? name + ' ' : ''}<${p.payer.email}>`);
  }
  if (p.installments && p.installments > 1) {
    lines.push(`- **Installments:** ${p.installments}x`);
  }
  if (p.card?.last_four_digits) {
    lines.push(`- **Card:** **** **** **** ${p.card.last_four_digits}`);
  }
  if (p.net_received_amount !== undefined) {
    lines.push(`- **Net Received:** ${p.currency_id} ${p.net_received_amount.toFixed(2)}`);
  }
  if (p.application_fee) {
    lines.push(`- **Application Fee:** ${p.currency_id} ${p.application_fee.toFixed(2)}`);
  }
  if (p.fee_details?.length) {
    lines.push('');
    lines.push('**Fee Details:**');
    for (const fee of p.fee_details) {
      lines.push(`  - ${fee.type}: ${p.currency_id} ${fee.amount.toFixed(2)} (paid by ${fee.fee_payer})`);
    }
  }
  if (p.point_of_interaction?.transaction_data?.ticket_url) {
    lines.push('');
    lines.push(`**PIX Ticket URL:** ${p.point_of_interaction.transaction_data.ticket_url}`);
  }
  if (p.metadata && Object.keys(p.metadata).length > 0) {
    lines.push('');
    lines.push(`**Metadata:** \`${JSON.stringify(p.metadata)}\``);
  }

  return lines.join('\n');
}

export function registerPaymentTools(server: McpServer): void {
  server.registerTool(
    'mp_get_payment',
    {
      title: 'Get Mercado Pago Payment',
      description: `Get the full details of a Mercado Pago payment by its numeric ID.

Returns payment status, amount, payer info, fee details, and PIX/card transaction data.

Args:
  - payment_id (number): The numeric Mercado Pago payment ID
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')
  - access_token (string, optional): Override the default access token

Returns (markdown): Formatted payment details with status, amount, payer, fees
Returns (json): Full payment object with all API fields

Examples:
  - Use when: "Check if payment 123456789 was approved"
  - Use when: "Get PIX ticket URL for payment 987654321"
  - Use when: "How much was the net amount received for payment 111222333?"
  - Don't use when: Searching by date or external reference (use mp_search_payments)

Error Handling:
  - Returns "Error: Resource not found" for unknown payment IDs
  - Returns "Error: Invalid or expired access token" for auth failures`,
      inputSchema: z
        .object({
          payment_id: z.number().int().positive().describe('Mercado Pago payment numeric ID'),
          response_format: z
            .nativeEnum(ResponseFormat)
            .default(ResponseFormat.MARKDOWN)
            .describe("Output format: 'markdown' for human-readable or 'json' for machine-readable"),
          access_token: ACCESS_TOKEN_FIELD,
        })
        .strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ payment_id, response_format, access_token }) => {
      try {
        const payment = await mpRequest<MpPayment>('GET', `/v1/payments/${payment_id}`, {
          accessToken: access_token,
        });

        let result =
          response_format === ResponseFormat.JSON
            ? JSON.stringify(payment, null, 2)
            : formatPaymentMarkdown(payment);

        if (result.length > CHARACTER_LIMIT) {
          result =
            result.slice(0, CHARACTER_LIMIT) +
            '\n\n[Response truncated. Use response_format=json for complete data.]';
        }

        return { content: [{ type: 'text', text: result }] };
      } catch (error) {
        return { content: [{ type: 'text', text: handleMpError(error) }] };
      }
    }
  );

  server.registerTool(
    'mp_search_payments',
    {
      title: 'Search Mercado Pago Payments',
      description: `Search and list Mercado Pago payments with optional filters.

Supports filtering by status, date range, external reference, payer email, and payment method.

Args:
  - status (string, optional): 'approved', 'pending', 'in_process', 'rejected', 'cancelled', 'refunded', 'charged_back'
  - external_reference (string, optional): Your internal order/registration ID
  - payer_email (string, optional): Filter by payer email address
  - payment_method_id (string, optional): e.g., 'pix', 'visa', 'master', 'bolbradesco'
  - begin_date (string, optional): ISO 8601 start date (e.g., '2025-01-01T00:00:00.000-03:00')
  - end_date (string, optional): ISO 8601 end date (e.g., '2025-12-31T23:59:59.000-03:00')
  - limit (number, optional): Max results per page, 1-100 (default: 20)
  - offset (number, optional): Pagination offset (default: 0)
  - sort (string, optional): Sort field (default: 'date_created')
  - criteria (string, optional): 'asc' or 'desc' (default: 'desc')
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')
  - access_token (string, optional): Override the default access token

Returns:
  {
    "total": number,       // Total matching payments
    "count": number,       // Payments in this response
    "offset": number,      // Current offset
    "payments": [...],     // Array of payment objects
    "has_more": boolean,
    "next_offset": number  // For pagination
  }

Examples:
  - Use when: "List all approved PIX payments this month"
  - Use when: "Find payments for external_reference 'reg-abc123'"
  - Use when: "Check pending payments for atleta@email.com"`,
      inputSchema: z
        .object({
          status: z
            .enum(['approved', 'pending', 'in_process', 'rejected', 'cancelled', 'refunded', 'charged_back'])
            .optional()
            .describe('Filter by payment status'),
          external_reference: z
            .string()
            .max(256)
            .optional()
            .describe('Filter by your internal order/registration ID'),
          payer_email: z
            .string()
            .email()
            .optional()
            .describe('Filter by payer email address'),
          payment_method_id: z
            .string()
            .max(64)
            .optional()
            .describe("Filter by payment method: 'pix', 'visa', 'master', 'bolbradesco', etc."),
          begin_date: z
            .string()
            .optional()
            .describe("Start date in ISO 8601 (e.g., '2025-01-01T00:00:00.000-03:00')"),
          end_date: z
            .string()
            .optional()
            .describe("End date in ISO 8601 (e.g., '2025-12-31T23:59:59.000-03:00')"),
          limit: z
            .number()
            .int()
            .min(1)
            .max(MAX_PAGE_SIZE)
            .default(DEFAULT_PAGE_SIZE)
            .describe('Max results per page (1-100, default: 20)'),
          offset: z
            .number()
            .int()
            .min(0)
            .default(0)
            .describe('Results to skip for pagination (default: 0)'),
          sort: z.string().default('date_created').describe("Sort field (default: 'date_created')"),
          criteria: z
            .enum(['asc', 'desc'])
            .default('desc')
            .describe("Sort direction: 'asc' or 'desc' (default: 'desc')"),
          response_format: z
            .nativeEnum(ResponseFormat)
            .default(ResponseFormat.MARKDOWN)
            .describe("Output format: 'markdown' for human-readable or 'json' for machine-readable"),
          access_token: ACCESS_TOKEN_FIELD,
        })
        .strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const {
          status,
          external_reference,
          payer_email,
          payment_method_id,
          begin_date,
          end_date,
          limit,
          offset,
          sort,
          criteria,
          response_format,
          access_token,
        } = params;

        const searchParams: Record<string, string | number | boolean | undefined> = {
          limit,
          offset,
          sort,
          criteria,
          ...(status ? { status } : {}),
          ...(external_reference ? { external_reference } : {}),
          ...(payer_email ? { 'payer.email': payer_email } : {}),
          ...(payment_method_id ? { payment_method_id } : {}),
          ...(begin_date ? { begin_date } : {}),
          ...(end_date ? { end_date } : {}),
        };

        const data = await mpRequest<MpSearchResult<MpPayment>>('GET', '/v1/payments/search', {
          params: searchParams,
          accessToken: access_token,
        });

        const payments = data.results || [];
        const total = data.paging?.total || 0;

        let result: string;

        if (response_format === ResponseFormat.JSON) {
          const resp = {
            total,
            count: payments.length,
            offset,
            payments,
            has_more: total > offset + payments.length,
            ...(total > offset + payments.length ? { next_offset: offset + payments.length } : {}),
          };
          result = JSON.stringify(resp, null, 2);
        } else {
          if (payments.length === 0) {
            result = '# Payments Search\n\nNo payments found matching the specified filters.';
          } else {
            const lines: string[] = [
              '# Payments Search Results',
              '',
              `Found **${total}** payments (showing ${payments.length}, offset ${offset})`,
              '',
            ];
            for (const p of payments) {
              lines.push(formatPaymentMarkdown(p));
              lines.push('');
              lines.push('---');
              lines.push('');
            }
            if (total > offset + payments.length) {
              lines.push(
                `> More results available. Use \`offset: ${offset + payments.length}\` to get the next page.`
              );
            }
            result = lines.join('\n');
          }
        }

        if (result.length > CHARACTER_LIMIT) {
          const half = payments.slice(0, Math.max(1, Math.floor(payments.length / 2)));
          result = JSON.stringify(
            {
              total,
              count: half.length,
              offset,
              payments: half,
              has_more: true,
              next_offset: offset + half.length,
              truncated: true,
              truncation_message: `Response truncated from ${payments.length} to ${half.length} items. Use 'offset' to paginate or add filters.`,
            },
            null,
            2
          );
        }

        return { content: [{ type: 'text', text: result }] };
      } catch (error) {
        return { content: [{ type: 'text', text: handleMpError(error) }] };
      }
    }
  );

  server.registerTool(
    'mp_get_payment_methods',
    {
      title: 'Get Mercado Pago Payment Methods',
      description: `List all payment methods available for a Mercado Pago account.

Returns payment method IDs, names, types, status, and min/max amounts.
Useful to discover valid payment_method_id values for search filters.

Args:
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')
  - access_token (string, optional): Override the default access token

Returns: List of payment methods grouped by type (credit_card, debit_card, bank_transfer, ticket, etc.)

Examples:
  - Use when: "What credit cards does Mercado Pago support in Brazil?"
  - Use when: "Is boleto (bolbradesco) available for payments?"
  - Use when: "Get valid payment_method_id values to use in search filters"`,
      inputSchema: z
        .object({
          response_format: z
            .nativeEnum(ResponseFormat)
            .default(ResponseFormat.MARKDOWN)
            .describe("Output format: 'markdown' for human-readable or 'json' for machine-readable"),
          access_token: ACCESS_TOKEN_FIELD,
        })
        .strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ response_format, access_token }) => {
      try {
        const methods = await mpRequest<MpPaymentMethod[]>('GET', '/v1/payment_methods', {
          accessToken: access_token,
        });

        let result: string;
        if (response_format === ResponseFormat.JSON) {
          result = JSON.stringify(methods, null, 2);
        } else {
          const grouped: Record<string, MpPaymentMethod[]> = {};
          for (const m of methods) {
            if (!grouped[m.payment_type_id]) grouped[m.payment_type_id] = [];
            grouped[m.payment_type_id].push(m);
          }

          const lines: string[] = ['# Available Payment Methods', ''];
          for (const [type, items] of Object.entries(grouped)) {
            lines.push(`## ${type}`);
            for (const m of items) {
              const limits =
                m.min_allowed_amount || m.max_allowed_amount
                  ? ` (min: R$${m.min_allowed_amount ?? 0}, max: R$${m.max_allowed_amount ?? '∞'})`
                  : '';
              lines.push(`- **${m.name}** (\`${m.id}\`) — ${m.status}${limits}`);
            }
            lines.push('');
          }
          result = lines.join('\n');
        }

        if (result.length > CHARACTER_LIMIT) {
          result = result.slice(0, CHARACTER_LIMIT) + '\n\n[Response truncated.]';
        }

        return { content: [{ type: 'text', text: result }] };
      } catch (error) {
        return { content: [{ type: 'text', text: handleMpError(error) }] };
      }
    }
  );
}
