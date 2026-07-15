import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { mpRequest, handleMpError } from '../services/mercadopago.js';
import { ResponseFormat, MpRefund } from '../types.js';

const ACCESS_TOKEN_FIELD = z
  .string()
  .optional()
  .describe('Optional access token override. Defaults to MERCADOPAGO_ACCESS_TOKEN env var.');

export function registerRefundTools(server: McpServer): void {
  server.registerTool(
    'mp_create_refund',
    {
      title: 'Create Mercado Pago Refund',
      description: `Create a full or partial refund for a Mercado Pago payment.

⚠️ IRREVERSIBLE OPERATION. Only approved payments can be refunded.
Partial refunds are supported by specifying an amount less than the original transaction.
Multiple partial refunds can be created for the same payment (up to the full amount).

Args:
  - payment_id (number): The numeric ID of the approved payment to refund
  - amount (number, optional): Amount to refund in BRL. Omit for a full refund.
  - metadata (object, optional): Arbitrary metadata for the refund record
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')
  - access_token (string, optional): Override the default access token

Returns:
  {
    "id": number,           // Refund ID
    "payment_id": number,   // Original payment ID
    "amount": number,       // Refunded amount in BRL
    "status": string,       // Refund status (usually 'approved')
    "date_created": string  // ISO 8601 timestamp
  }

Examples:
  - Use when: "Refund the full amount for payment 123456789"
  - Use when: "Partially refund R$50 from payment 987654321"

Error Handling:
  - Returns "Error: Resource not found" for unknown payment IDs
  - Returns "Error: Bad request" if payment is not approved or already fully refunded`,
      inputSchema: z
        .object({
          payment_id: z.number().int().positive().describe('Payment ID to refund'),
          amount: z
            .number()
            .positive()
            .optional()
            .describe('Amount to refund in BRL (omit for full refund)'),
          metadata: z.record(z.unknown()).optional().describe('Optional metadata for the refund'),
          response_format: z
            .nativeEnum(ResponseFormat)
            .default(ResponseFormat.MARKDOWN)
            .describe("Output format: 'markdown' for human-readable or 'json' for machine-readable"),
          access_token: ACCESS_TOKEN_FIELD,
        })
        .strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ payment_id, amount, metadata, response_format, access_token }) => {
      try {
        const body: Record<string, unknown> = {};
        if (amount !== undefined) body.amount = amount;
        if (metadata) body.metadata = metadata;

        const refund = await mpRequest<MpRefund>(
          'POST',
          `/v1/payments/${payment_id}/refunds`,
          {
            data: Object.keys(body).length > 0 ? body : undefined,
            accessToken: access_token,
            idempotencyKey: `refund-${payment_id}-${amount ?? 'full'}-${Date.now()}`,
          }
        );

        let result: string;
        if (response_format === ResponseFormat.JSON) {
          result = JSON.stringify(refund, null, 2);
        } else {
          result = [
            '## Refund Created',
            '',
            `- **Refund ID:** ${refund.id}`,
            `- **Payment ID:** ${refund.payment_id}`,
            `- **Amount Refunded:** BRL ${refund.amount.toFixed(2)}`,
            `- **Status:** ${refund.status}`,
            `- **Date:** ${new Date(refund.date_created).toLocaleString('pt-BR')}`,
          ].join('\n');
        }

        return { content: [{ type: 'text', text: result }] };
      } catch (error) {
        return { content: [{ type: 'text', text: handleMpError(error) }] };
      }
    }
  );

  server.registerTool(
    'mp_list_refunds',
    {
      title: 'List Mercado Pago Refunds',
      description: `List all refunds for a specific Mercado Pago payment.

Args:
  - payment_id (number): The payment ID to list refunds for
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')
  - access_token (string, optional): Override the default access token

Returns: List of refund objects with id, amount, status, and date_created.
Returns empty list if no refunds exist for the payment.

Examples:
  - Use when: "Has payment 123456789 been refunded?"
  - Use when: "How much has been refunded from payment 987654321?"
  - Use when: "List all refunds for a payment I need to reconcile"`,
      inputSchema: z
        .object({
          payment_id: z.number().int().positive().describe('Payment ID to list refunds for'),
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
        const refunds = await mpRequest<MpRefund[]>(
          'GET',
          `/v1/payments/${payment_id}/refunds`,
          { accessToken: access_token }
        );

        let result: string;
        if (response_format === ResponseFormat.JSON) {
          result = JSON.stringify(refunds, null, 2);
        } else {
          if (!refunds || refunds.length === 0) {
            result = `## Refunds for Payment #${payment_id}\n\nNo refunds found for this payment.`;
          } else {
            const totalRefunded = refunds.reduce((sum, r) => sum + r.amount, 0);
            const lines: string[] = [
              `## Refunds for Payment #${payment_id}`,
              '',
              `**Total Refunded:** BRL ${totalRefunded.toFixed(2)} across ${refunds.length} refund(s)`,
              '',
            ];
            for (const r of refunds) {
              lines.push(`### Refund #${r.id}`);
              lines.push(`- **Amount:** BRL ${r.amount.toFixed(2)}`);
              lines.push(`- **Status:** ${r.status}`);
              lines.push(`- **Date:** ${new Date(r.date_created).toLocaleString('pt-BR')}`);
              lines.push('');
            }
            result = lines.join('\n');
          }
        }

        return { content: [{ type: 'text', text: result }] };
      } catch (error) {
        return { content: [{ type: 'text', text: handleMpError(error) }] };
      }
    }
  );
}
