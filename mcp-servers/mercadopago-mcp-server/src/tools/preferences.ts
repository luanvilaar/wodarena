import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { mpRequest, handleMpError } from '../services/mercadopago.js';
import { ResponseFormat, MpPreference } from '../types.js';
import { CHARACTER_LIMIT } from '../constants.js';

const ACCESS_TOKEN_FIELD = z
  .string()
  .optional()
  .describe(
    'Optional access token override. Defaults to MERCADOPAGO_ACCESS_TOKEN env var. ' +
    'Use for marketplace scenarios where you act on behalf of a connected account.'
  );

function formatPreferenceMarkdown(preference: MpPreference): string {
  const totalAmount = (preference.items || []).reduce(
    (sum, item) => sum + item.unit_price * item.quantity,
    0
  );
  const lines: string[] = [
    `## Preference: ${preference.id}`,
    '',
    `- **Init Point (Payment URL):** ${preference.init_point}`,
    ...(preference.sandbox_init_point ? [`- **Sandbox URL:** ${preference.sandbox_init_point}`] : []),
    `- **Total Amount:** BRL ${totalAmount.toFixed(2)}`,
    `- **Items:** ${(preference.items || []).map((i) => `${i.title} (${i.quantity}x R$${i.unit_price})`).join(', ')}`,
    ...(preference.external_reference ? [`- **External Ref:** ${preference.external_reference}`] : []),
    ...(preference.marketplace_fee !== undefined
      ? [`- **Marketplace Fee:** BRL ${preference.marketplace_fee.toFixed(2)}`]
      : []),
    ...(preference.notification_url ? [`- **Webhook:** ${preference.notification_url}`] : []),
    ...(preference.date_created
      ? [`- **Created:** ${new Date(preference.date_created).toLocaleString('pt-BR')}`]
      : []),
  ];
  return lines.join('\n');
}

export function registerPreferenceTools(server: McpServer): void {
  server.registerTool(
    'mp_create_preference',
    {
      title: 'Create Mercado Pago Checkout Preference',
      description: `Create a Checkout Pro preference to generate a payment link.

A preference defines what will be charged and where to redirect after payment.
The returned init_point URL can be shared with the payer to complete payment via Mercado Pago's hosted checkout.

Args:
  - items (array): Products/services to charge. Each needs: title, quantity, unit_price, currency_id
  - payer_email (string, optional): Payer's email address
  - payer_name (string, optional): Payer's full name
  - back_url_success (string, optional): Redirect URL after successful payment
  - back_url_failure (string, optional): Redirect URL after failed payment
  - back_url_pending (string, optional): Redirect URL for pending payment
  - notification_url (string, optional): Webhook URL for async notifications (HTTPS required in production)
  - auto_return ('approved' | 'all', optional): Auto-redirect mode after payment
  - marketplace_fee (number, optional): Platform commission in BRL (marketplace split)
  - external_reference (string, optional): Your internal order/registration ID
  - metadata (object, optional): Arbitrary key-value pairs for tracking
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')
  - access_token (string, optional): Override the default access token

Returns:
  - init_point: URL to redirect the payer for payment (production)
  - sandbox_init_point: URL for sandbox testing
  - id: Preference ID (use to track the payment later via mp_search_payments with external_reference)

Examples:
  - Use when: "Create a payment link for a R$199 WODArena event registration"
  - Use when: "Generate Checkout Pro preference for order #REG-12345 with 10% marketplace fee"
  - Don't use when: Charging a card directly with a token (use POST /v1/payments instead)`,
      inputSchema: z
        .object({
          items: z
            .array(
              z.object({
                id: z.string().optional().describe('Item ID (e.g., division ID or SKU)'),
                title: z
                  .string()
                  .min(1)
                  .max(256)
                  .describe("Item title (e.g., 'Inscrição WODArena - Open')"),
                description: z.string().max(600).optional().describe('Item description'),
                quantity: z.number().int().min(1).describe('Item quantity'),
                currency_id: z
                  .string()
                  .length(3)
                  .default('BRL')
                  .describe("Currency code (e.g., 'BRL')"),
                unit_price: z.number().positive().describe('Unit price in BRL (e.g., 199.90)'),
              })
            )
            .min(1)
            .describe('List of items to charge (at least one required)'),
          payer_email: z.string().email().optional().describe("Payer's email address"),
          payer_name: z.string().max(256).optional().describe("Payer's full name"),
          back_url_success: z
            .string()
            .url()
            .optional()
            .describe('Redirect URL after successful payment'),
          back_url_failure: z
            .string()
            .url()
            .optional()
            .describe('Redirect URL after failed payment'),
          back_url_pending: z
            .string()
            .url()
            .optional()
            .describe('Redirect URL for pending payment'),
          notification_url: z
            .string()
            .url()
            .optional()
            .describe('Webhook URL for async payment notifications (HTTPS required in production)'),
          auto_return: z
            .enum(['approved', 'all'])
            .optional()
            .describe("Auto-redirect after payment: 'approved' or 'all'"),
          marketplace_fee: z
            .number()
            .min(0)
            .optional()
            .describe('Platform commission in BRL for marketplace split'),
          external_reference: z
            .string()
            .max(256)
            .optional()
            .describe('Your internal order/registration ID for tracking'),
          metadata: z
            .record(z.unknown())
            .optional()
            .describe('Arbitrary metadata key-value pairs'),
          response_format: z
            .nativeEnum(ResponseFormat)
            .default(ResponseFormat.MARKDOWN)
            .describe("Output format: 'markdown' for human-readable or 'json' for machine-readable"),
          access_token: ACCESS_TOKEN_FIELD,
        })
        .strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const {
          items,
          payer_email,
          payer_name,
          back_url_success,
          back_url_failure,
          back_url_pending,
          notification_url,
          auto_return,
          marketplace_fee,
          external_reference,
          metadata,
          response_format,
          access_token,
        } = params;

        const preferencePayload: Record<string, unknown> = {
          items,
          ...(payer_email || payer_name
            ? { payer: { ...(payer_name ? { name: payer_name } : {}), ...(payer_email ? { email: payer_email } : {}) } }
            : {}),
          ...(back_url_success || back_url_failure || back_url_pending
            ? {
                back_urls: {
                  ...(back_url_success ? { success: back_url_success } : {}),
                  ...(back_url_failure ? { failure: back_url_failure } : {}),
                  ...(back_url_pending ? { pending: back_url_pending } : {}),
                },
              }
            : {}),
          ...(notification_url ? { notification_url } : {}),
          ...(auto_return ? { auto_return } : {}),
          ...(marketplace_fee !== undefined ? { marketplace_fee } : {}),
          ...(external_reference ? { external_reference } : {}),
          ...(metadata ? { metadata } : {}),
        };

        const preference = await mpRequest<MpPreference>('POST', '/checkout/preferences', {
          data: preferencePayload,
          accessToken: access_token,
        });

        let result: string;
        if (response_format === ResponseFormat.JSON) {
          result = JSON.stringify(preference, null, 2);
        } else {
          const totalAmount = items.reduce((sum, i) => sum + i.unit_price * i.quantity, 0);
          result = [
            '## Preference Created',
            '',
            `- **ID:** ${preference.id}`,
            `- **Init Point (Payment URL):** ${preference.init_point}`,
            ...(preference.sandbox_init_point ? [`- **Sandbox URL:** ${preference.sandbox_init_point}`] : []),
            `- **Total Amount:** BRL ${totalAmount.toFixed(2)}`,
            `- **Items:** ${items.map((i) => `${i.title} (${i.quantity}x R$${i.unit_price})`).join(', ')}`,
            ...(external_reference ? [`- **External Ref:** ${external_reference}`] : []),
            ...(marketplace_fee !== undefined ? [`- **Marketplace Fee:** BRL ${marketplace_fee.toFixed(2)}`] : []),
            ...(notification_url ? [`- **Webhook:** ${notification_url}`] : []),
            '',
            '> Share the **Init Point** URL with the payer to complete payment.',
            '> Use `mp_search_payments` with the external_reference to track payment status.',
          ].join('\n');
        }

        return { content: [{ type: 'text', text: result }] };
      } catch (error) {
        return { content: [{ type: 'text', text: handleMpError(error) }] };
      }
    }
  );

  server.registerTool(
    'mp_get_preference',
    {
      title: 'Get Mercado Pago Checkout Preference',
      description: `Get a Checkout Pro preference by its ID.

Retrieves the preference configuration including items, payer info, payment URLs, and metadata.

Args:
  - preference_id (string): The Mercado Pago preference ID
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')
  - access_token (string, optional): Override the default access token

Returns: Preference details including init_point URL and all configured parameters

Examples:
  - Use when: "Check the details of preference 123456789-abcd-efgh"
  - Use when: "Get the payment URL for a previously created preference"
  - Don't use when: Tracking actual payment status (use mp_get_payment or mp_search_payments)`,
      inputSchema: z
        .object({
          preference_id: z.string().min(1).describe('Mercado Pago preference ID'),
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
    async ({ preference_id, response_format, access_token }) => {
      try {
        const preference = await mpRequest<MpPreference>(
          'GET',
          `/checkout/preferences/${preference_id}`,
          { accessToken: access_token }
        );

        let result =
          response_format === ResponseFormat.JSON
            ? JSON.stringify(preference, null, 2)
            : formatPreferenceMarkdown(preference);

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
