import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { handleMpError } from '../services/mercadopago.js';
import { ResponseFormat, MpOAuthTokenResponse } from '../types.js';
import { MP_AUTH_BASE_URL } from '../constants.js';

type MpOAuthErrorBody = {
  error?: string;
  message?: string;
  cause?: Array<{ description?: string }>;
};

async function exchangeOAuthToken(params: {
  grant_type: 'authorization_code' | 'refresh_token';
  client_id: string;
  client_secret: string;
  code?: string;
  redirect_uri?: string;
  refresh_token?: string;
}): Promise<{ ok: true; data: MpOAuthTokenResponse } | { ok: false; error: string }> {
  const body = new URLSearchParams({
    client_id: params.client_id,
    client_secret: params.client_secret,
    grant_type: params.grant_type,
    ...(params.code ? { code: params.code } : {}),
    ...(params.redirect_uri ? { redirect_uri: params.redirect_uri } : {}),
    ...(params.refresh_token ? { refresh_token: params.refresh_token } : {}),
  });

  const response = await fetch('https://api.mercadopago.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorData = (await response.json()) as MpOAuthErrorBody;
    const errorCode = errorData.error || 'unknown';
    const errorMsg = errorData.message || errorData.cause?.[0]?.description || '';
    return {
      ok: false,
      error: `Error: OAuth token exchange failed (${errorCode})${errorMsg ? ': ' + errorMsg : ''}. `,
    };
  }

  return { ok: true, data: (await response.json()) as MpOAuthTokenResponse };
}

function formatTokenMarkdown(tokenData: MpOAuthTokenResponse, action: 'exchange' | 'refresh'): string {
  const expiresAt = new Date(Date.now() + (tokenData.expires_in || 15_552_000) * 1_000);
  const expiryDays = Math.round((tokenData.expires_in || 15_552_000) / 86_400);

  return [
    `## OAuth Token ${action === 'exchange' ? 'Exchange' : 'Refresh'} Successful`,
    '',
    `- **User ID:** ${tokenData.user_id}`,
    `- **Scope:** ${tokenData.scope}`,
    `- **Live Mode:** ${tokenData.live_mode ? 'Yes (production)' : 'No (sandbox)'}`,
    `- **Expires In:** ${expiryDays} days (${expiresAt.toLocaleDateString('pt-BR')})`,
    ...(tokenData.public_key ? [`- **Public Key:** ${tokenData.public_key}`] : []),
    '',
    '⚠️ Store **access_token** and **refresh_token** securely — they grant full account access.',
    `- **access_token:** \`${tokenData.access_token.substring(0, 20)}...\` (truncated for security)`,
    `- **refresh_token:** ${tokenData.refresh_token ? `\`${tokenData.refresh_token.substring(0, 10)}...\`` : 'N/A'}`,
  ].join('\n');
}

export function registerOAuthTools(server: McpServer): void {
  server.registerTool(
    'mp_get_oauth_url',
    {
      title: 'Get Mercado Pago OAuth Authorization URL',
      description: `Generate the OAuth 2.0 authorization URL for connecting a Mercado Pago account.

The returned URL should be opened in the user's browser.
After authorization, Mercado Pago redirects to your redirect_uri with a 'code' parameter valid for 10 minutes.
Use mp_exchange_oauth_token to exchange that code for an access token.

Args:
  - redirect_uri (string): The redirect URI registered in your Mercado Pago application panel (must match exactly)
  - client_id (string, optional): Your app's client_id. Defaults to MERCADOPAGO_CLIENT_ID env var.
  - state (string, optional): CSRF protection state (recommended: random unique value; verify on return)
  - platform_id (string, optional): Platform identifier (default: 'mp' for Brazil)

Returns: The full authorization URL to open in the user's browser

Examples:
  - Use when: "Generate the OAuth URL to connect a manager's Mercado Pago account"
  - Use when: "Create the authorization link for our WODArena marketplace integration"

⚠️ The authorization code received is valid for 10 minutes only.`,
      inputSchema: z
        .object({
          redirect_uri: z
            .string()
            .url()
            .describe('Redirect URI registered in Mercado Pago application panel (must match exactly)'),
          client_id: z
            .string()
            .optional()
            .describe("App's client_id. Defaults to MERCADOPAGO_CLIENT_ID env var."),
          state: z
            .string()
            .optional()
            .describe('CSRF protection parameter (recommended: random unique value)'),
          platform_id: z
            .string()
            .optional()
            .describe("Platform identifier (default: 'mp' for Brazil)"),
        })
        .strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ redirect_uri, client_id, state, platform_id }) => {
      try {
        const appClientId = client_id || process.env.MERCADOPAGO_CLIENT_ID;
        if (!appClientId) {
          return {
            content: [{
              type: 'text',
              text: 'Error: client_id is required. Pass it as a parameter or set MERCADOPAGO_CLIENT_ID environment variable.',
            }],
          };
        }

        const qs = new URLSearchParams({
          client_id: appClientId,
          response_type: 'code',
          platform_id: platform_id || 'mp',
          redirect_uri,
          ...(state ? { state } : {}),
        });

        const authUrl = `${MP_AUTH_BASE_URL}/authorization?${qs.toString()}`;

        return {
          content: [{
            type: 'text',
            text: [
              '## OAuth Authorization URL',
              '',
              `**URL:** ${authUrl}`,
              '',
              '**Steps:**',
              '1. Open this URL in the user\'s browser',
              '2. The user logs in to Mercado Pago and authorizes your application',
              '3. Mercado Pago redirects to your redirect_uri with a `code` parameter',
              '4. Call `mp_exchange_oauth_token` with that code to get the access token',
              '',
              '⚠️ The authorization code expires in **10 minutes**.',
              ...(state ? [`🔒 Verify the returned \`state\` parameter matches: \`${state}\``] : []),
            ].join('\n'),
          }],
        };
      } catch (error) {
        return { content: [{ type: 'text', text: handleMpError(error) }] };
      }
    }
  );

  server.registerTool(
    'mp_exchange_oauth_token',
    {
      title: 'Exchange Mercado Pago OAuth Code for Token',
      description: `Exchange an authorization code for a Mercado Pago access token.

After the user authorizes your application via the URL from mp_get_oauth_url,
Mercado Pago redirects with a 'code' parameter. Exchange that code here.

Args:
  - code (string): The authorization code from Mercado Pago's redirect URL
  - redirect_uri (string): Must match EXACTLY the redirect_uri used in authorization
  - client_id (string, optional): App's client_id. Defaults to MERCADOPAGO_CLIENT_ID env var.
  - client_secret (string, optional): App's client_secret. Defaults to MERCADOPAGO_CLIENT_SECRET env var.
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  {
    "access_token": string,   // Bearer token for API calls (valid 180 days)
    "token_type": "bearer",
    "expires_in": number,     // Seconds until expiry (typically 15552000 = 180 days)
    "scope": string,
    "user_id": number,        // Mercado Pago account user ID
    "refresh_token": string,  // For renewal after expiry
    "public_key": string,     // For client-side SDK initialization
    "live_mode": boolean      // true = production, false = sandbox
  }

Examples:
  - Use when: "Complete the OAuth flow after the manager authorized the app"
  - Use when: "Exchange authorization code 'TG-abc123-456' for access token"

⚠️ The authorization code is single-use and expires in 10 minutes.
⚠️ Store access_token and refresh_token securely — they grant full account access.`,
      inputSchema: z
        .object({
          code: z.string().min(1).describe("Authorization code from Mercado Pago's redirect URL"),
          redirect_uri: z
            .string()
            .url()
            .describe('Redirect URI used in the authorization request (must match exactly)'),
          client_id: z
            .string()
            .optional()
            .describe("App's client_id. Defaults to MERCADOPAGO_CLIENT_ID env var."),
          client_secret: z
            .string()
            .optional()
            .describe("App's client_secret. Defaults to MERCADOPAGO_CLIENT_SECRET env var."),
          response_format: z
            .nativeEnum(ResponseFormat)
            .default(ResponseFormat.MARKDOWN)
            .describe("Output format: 'markdown' for human-readable or 'json' for machine-readable"),
        })
        .strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ code, redirect_uri, client_id, client_secret, response_format }) => {
      try {
        const appClientId = client_id || process.env.MERCADOPAGO_CLIENT_ID;
        const appClientSecret = client_secret || process.env.MERCADOPAGO_CLIENT_SECRET;

        if (!appClientId || !appClientSecret) {
          return {
            content: [{
              type: 'text',
              text: 'Error: client_id and client_secret are required. Set MERCADOPAGO_CLIENT_ID and MERCADOPAGO_CLIENT_SECRET, or pass them as parameters.',
            }],
          };
        }

        const result = await exchangeOAuthToken({
          grant_type: 'authorization_code',
          client_id: appClientId,
          client_secret: appClientSecret,
          code,
          redirect_uri,
        });

        if (!result.ok) {
          return {
            content: [{
              type: 'text',
              text:
                result.error +
                'Check that the code has not expired (10 min limit) and redirect_uri matches exactly.',
            }],
          };
        }

        const text =
          response_format === ResponseFormat.JSON
            ? JSON.stringify(result.data, null, 2)
            : formatTokenMarkdown(result.data, 'exchange');

        return { content: [{ type: 'text', text }] };
      } catch (error) {
        return { content: [{ type: 'text', text: handleMpError(error) }] };
      }
    }
  );

  server.registerTool(
    'mp_refresh_oauth_token',
    {
      title: 'Refresh Mercado Pago OAuth Token',
      description: `Renew an expired or soon-to-expire Mercado Pago access token using the refresh token.

Access tokens expire after 180 days. Use this tool to get a new access token without re-authorization.
Each refresh returns a NEW refresh_token — always update both stored tokens.

Args:
  - refresh_token (string): The refresh token from a previous OAuth exchange or refresh
  - client_id (string, optional): App's client_id. Defaults to MERCADOPAGO_CLIENT_ID env var.
  - client_secret (string, optional): App's client_secret. Defaults to MERCADOPAGO_CLIENT_SECRET env var.
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns: New access_token, refresh_token, and expiration info (same schema as mp_exchange_oauth_token)

Examples:
  - Use when: "Refresh the Mercado Pago token for organizer account before it expires"
  - Use when: "Renew a connected account token that's about to expire"

⚠️ The old refresh_token is invalidated after use. Update both access_token and refresh_token.`,
      inputSchema: z
        .object({
          refresh_token: z
            .string()
            .min(1)
            .describe('Refresh token from previous OAuth exchange'),
          client_id: z
            .string()
            .optional()
            .describe("App's client_id. Defaults to MERCADOPAGO_CLIENT_ID env var."),
          client_secret: z
            .string()
            .optional()
            .describe("App's client_secret. Defaults to MERCADOPAGO_CLIENT_SECRET env var."),
          response_format: z
            .nativeEnum(ResponseFormat)
            .default(ResponseFormat.MARKDOWN)
            .describe("Output format: 'markdown' for human-readable or 'json' for machine-readable"),
        })
        .strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ refresh_token, client_id, client_secret, response_format }) => {
      try {
        const appClientId = client_id || process.env.MERCADOPAGO_CLIENT_ID;
        const appClientSecret = client_secret || process.env.MERCADOPAGO_CLIENT_SECRET;

        if (!appClientId || !appClientSecret) {
          return {
            content: [{
              type: 'text',
              text: 'Error: client_id and client_secret are required. Set MERCADOPAGO_CLIENT_ID and MERCADOPAGO_CLIENT_SECRET, or pass them as parameters.',
            }],
          };
        }

        const result = await exchangeOAuthToken({
          grant_type: 'refresh_token',
          client_id: appClientId,
          client_secret: appClientSecret,
          refresh_token,
        });

        if (!result.ok) {
          return {
            content: [{
              type: 'text',
              text:
                result.error +
                'The refresh_token may be expired or already used. Re-authorization may be required.',
            }],
          };
        }

        const text =
          response_format === ResponseFormat.JSON
            ? JSON.stringify(result.data, null, 2)
            : formatTokenMarkdown(result.data, 'refresh');

        return { content: [{ type: 'text', text }] };
      } catch (error) {
        return { content: [{ type: 'text', text: handleMpError(error) }] };
      }
    }
  );
}
