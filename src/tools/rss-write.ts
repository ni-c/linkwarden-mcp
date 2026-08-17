import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { LinkwardenApi } from '../api.js';
import {
  confirmationPrompt,
  setResourceKey,
  type ConfirmationStore,
} from '../confirm.js';
import {
  assertNotErrorMessage,
  errorResult,
  jsonResult,
  run,
  textResult,
} from '../result.js';
import {
  collectionId,
  confirmToken,
  httpUrl,
  idPath,
  rssSubscriptionId,
} from '../schema.js';
import { shapeRssSubscription, type RawRssSubscription } from '../shape.js';

export function registerRssWriteTools(
  server: McpServer,
  api: LinkwardenApi,
  confirmations: ConfirmationStore
): void {
  server.registerTool(
    'create_rss_subscription',
    {
      title: 'Subscribe to an RSS feed',
      description:
        'Subscribes to an RSS or Atom feed. Linkwarden polls it and files every new ' +
        'entry as a link in the given collection, preserving the pages according to ' +
        'the account defaults.\n\n' +
        'Linkwarden fetches the feed once immediately, so a feed that is unreachable ' +
        'or points at a private address is rejected right away. Subscription names ' +
        'must be unique per account, and instances cap the number of subscriptions ' +
        '(20 by default).',
      inputSchema: {
        name: z
          .string()
          .trim()
          .min(1)
          .max(50)
          .describe('Name for the subscription, unique within the account'),
        url: httpUrl.describe('Feed URL, including the scheme'),
        collection_id: collectionId
          .optional()
          .describe(
            'Collection the entries land in. Mutually exclusive with collection_name.'
          ),
        collection_name: z
          .string()
          .trim()
          .max(50)
          .optional()
          .describe(
            'Collection by name; it is created if it does not exist. Mutually exclusive with collection_id.'
          ),
      },
      annotations: {},
    },
    async ({ name, url, collection_id, collection_name }) =>
      run(async () => {
        if (collection_id !== undefined && collection_name !== undefined) {
          return errorResult(
            'Give either collection_id or collection_name, not both.'
          );
        }
        const created = await api.post('/rss', {
          name,
          url,
          ...(collection_id !== undefined
            ? { collectionId: collection_id }
            : {}),
          ...(collection_name !== undefined
            ? { collectionName: collection_name }
            : {}),
        });
        assertNotErrorMessage(created, 'Creating the RSS subscription');
        return jsonResult({
          created: shapeRssSubscription(created as RawRssSubscription),
        });
      })
  );

  server.registerTool(
    'delete_rss_subscription',
    {
      title: 'Delete an RSS subscription',
      description:
        'Stops polling a feed. Links that were already created from it stay where ' +
        'they are — only the subscription goes away.',
      inputSchema: {
        rss_subscription_id: rssSubscriptionId,
        confirm_token: confirmToken,
      },
      annotations: { destructiveHint: true },
    },
    async ({ rss_subscription_id, confirm_token }) =>
      run(async () => {
        const resource = setResourceKey('delete_rss_subscription', [
          String(rss_subscription_id),
        ]);
        if (!confirmations.consume(resource, confirm_token)) {
          if (confirm_token !== undefined) {
            return errorResult(
              'The confirmation token is invalid, expired, or was issued for a ' +
                'different subscription. Call delete_rss_subscription without a ' +
                'token to get a new one.'
            );
          }
          const token = confirmations.issue(resource);
          return textResult(
            confirmationPrompt(
              `delete RSS subscription ${rss_subscription_id}, so its feed is no longer polled`,
              token,
              confirmations.ttlMinutes
            )
          );
        }

        const deleted = await api.delete(idPath('/rss', rss_subscription_id));
        assertNotErrorMessage(deleted, 'Deleting the RSS subscription');
        return textResult(
          `RSS subscription ${rss_subscription_id} deleted. The links it already created remain.`
        );
      })
  );
}
