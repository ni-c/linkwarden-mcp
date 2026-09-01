import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { setResourceKey } from 'mcp-approval';
import type { Approver, ConfirmationStore } from 'mcp-approval';
import {
  assertNotErrorMessage,
  errorResult,
  jsonResult,
  run,
  textResult,
} from '../result.js';
import {
  assertFetchableUrl,
  collectionId,
  confirmToken,
  httpUrl,
  idPath,
  rssSubscriptionId,
} from '../schema.js';

import type { LinkwardenApi } from '../api.js';
import { shapeRssSubscription, type RawRssSubscription } from '../shape.js';

export function registerRssWriteTools(
  server: McpServer,
  api: LinkwardenApi,
  confirmations: ConfirmationStore,
  approval: Approver
): void {
  server.registerTool(
    'create_rss_subscription',
    {
      title: 'Subscribe to an RSS feed',
      description:
        'Subscribes to an RSS or Atom feed. Linkwarden polls it and files every new ' +
        'entry as a link in the given collection, preserving the pages according to ' +
        'the account defaults.\n\n' +
        'Linkwarden fetches the feed once immediately, so an unreachable feed fails ' +
        'right away. Because that fetch happens on the Linkwarden server, a URL ' +
        'addressing its own loopback or the link-local range is refused here before ' +
        'the request is made. That check covers the feed URL only — Linkwarden ' +
        'creates and preserves a link for every entry the feed contains, and on ' +
        'versions before 2.14 it does not check those addresses at all. Do not ' +
        'subscribe to a feed you do not trust.\n\n' +
        'Linkwarden 2.14 and later apply their own check as well, and it is ' +
        'stricter: the feed URL is resolved and any address on a private or ' +
        'loopback range is refused with "URL resolves to a blocked internal ' +
        'hostname". A feed on the same private network as the instance — a ' +
        'company intranet, another container — therefore cannot be subscribed ' +
        'at all, however legitimate. That refusal comes from Linkwarden, not ' +
        'from here, and no argument changes it.\n\n' +
        'Subscription names must be unique per account, and instances cap the ' +
        'number of subscriptions (20 by default).',
      inputSchema: z.object({
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
      }),
      annotations: {
        // Additive.
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ name, url, collection_id, collection_name }) =>
      run(async () => {
        if (collection_id !== undefined && collection_name !== undefined) {
          return errorResult(
            'Give either collection_id or collection_name, not both.'
          );
        }
        // Linkwarden fetches the feed immediately, so this is the same
        // server-side request create_link makes — and what goes on the wire is
        // the parsed URL, so the address that was checked is the one fetched.
        const target = await assertFetchableUrl(url);

        const created = await api.post('/rss', {
          name,
          url: target,
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
      inputSchema: z.object({
        rss_subscription_id: rssSubscriptionId,
        confirm_token: confirmToken,
      }),
      annotations: {
        // Items already imported stay; nothing further is fetched.
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ rss_subscription_id, confirm_token }, mcp) =>
      run(async () => {
        const resource = setResourceKey('delete_rss_subscription', [
          String(rss_subscription_id),
        ]);
        const outcome = await approval.requestApproval(
          server,
          mcp,
          confirmations,
          {
            what: `delete RSS subscription ${rss_subscription_id}, so its feed is no longer polled`,
            consequence:
              'Items already imported stay; nothing further is fetched from that feed.',
            resourceKey: resource,
            token: confirm_token,
            toolName: 'delete_rss_subscription',
            hint: 'Tick to go ahead, leave it to cancel.',
          }
        );
        // A token that was sent and did not match is refused with the reason
        // rather than answered with a fresh prompt; the sentence is the
        // library's, so every server refuses in the same words.
        if (outcome.decision === 'rejected') {
          return errorResult(outcome.reason);
        }
        if (outcome.decision === 'declined') {
          return errorResult(
            `The user declined. delete_rss_subscription did nothing.`
          );
        }
        if (outcome.decision === 'pending') return outcome.result;

        const deleted = await api.delete(idPath('/rss', rss_subscription_id));
        assertNotErrorMessage(deleted, 'Deleting the RSS subscription');
        return textResult(
          `RSS subscription ${rss_subscription_id} deleted. The links it already created remain.`
        );
      })
  );
}
