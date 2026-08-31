import type { McpServer } from '@modelcontextprotocol/server';
import {
  shapeLink,
  shapeRssSubscription,
  UNTRUSTED_METADATA_NOTE,
  type RawLink,
  type RawRssSubscription,
} from '../shape.js';
import { z } from 'zod';

import type { LinkwardenApi } from '../api.js';
import { jsonResult, run } from '../result.js';

interface RawUser {
  id?: number;
  username?: string | null;
  name?: string | null;
  isPrivate?: boolean;
  archiveAsScreenshot?: boolean;
  archiveAsMonolith?: boolean;
  archiveAsPDF?: boolean;
  archiveAsReadable?: boolean;
  archiveAsWaybackMachine?: boolean;
  aiTaggingMethod?: string;
  aiPredefinedTags?: string[];
  preventDuplicateLinks?: boolean;
  hasUnIndexedLinks?: boolean;
}

interface RawWorkerStats {
  link?: { pending?: number; done?: number; failed?: number };
  search?: { pending?: number; done?: number };
}

export function registerOverviewReadTools(
  server: McpServer,
  api: LinkwardenApi
): void {
  server.registerTool(
    'get_current_user',
    {
      title: 'Get the authenticated account',
      description:
        'Reports which Linkwarden account the configured token belongs to and that ' +
        "account's archival defaults — which formats new links get preserved in, and " +
        'whether duplicate URLs are rejected. Useful as a connectivity check and ' +
        'before creating links, because the defaults decide what get_link_content ' +
        'will later have to read.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () =>
      run(async () => {
        const user = (await api.get('/users/me')) as RawUser;
        return jsonResult({
          id: user.id,
          username: user.username ?? null,
          name: user.name ?? null,
          profile_is_private: user.isPrivate ?? false,
          prevent_duplicate_links: user.preventDuplicateLinks ?? false,
          archival_defaults: {
            screenshot: user.archiveAsScreenshot ?? false,
            monolith: user.archiveAsMonolith ?? false,
            pdf: user.archiveAsPDF ?? false,
            readable: user.archiveAsReadable ?? false,
            wayback_machine: user.archiveAsWaybackMachine ?? false,
          },
          ai_tagging_method: user.aiTaggingMethod ?? null,
          ai_predefined_tags: user.aiPredefinedTags ?? [],
          has_unindexed_links: user.hasUnIndexedLinks ?? false,
        });
      })
  );

  server.registerTool(
    'get_dashboard',
    {
      title: 'Get the dashboard links',
      description:
        'Returns the links Linkwarden shows on its dashboard: the most recently ' +
        'added ones together with everything the account has pinned, deduplicated. ' +
        'A quick "what is going on here" overview — use search_links for anything ' +
        'targeted.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () =>
      run(async () => {
        // This route answers with a flat array of links, not with an object.
        const links = (await api.get('/dashboard')) as RawLink[];
        const list = Array.isArray(links) ? links : [];
        return jsonResult({
          count: list.length,
          links: list.map(shapeLink),
          notes: [UNTRUSTED_METADATA_NOTE],
        });
      })
  );

  server.registerTool(
    'list_rss_subscriptions',
    {
      title: 'List RSS subscriptions',
      description:
        'Lists the RSS feeds this account subscribes to. Linkwarden polls them and ' +
        'files new entries as links in the configured collection.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () =>
      run(async () => {
        const subscriptions = (await api.get('/rss')) as RawRssSubscription[];
        return jsonResult({
          count: subscriptions.length,
          subscriptions: subscriptions.map(shapeRssSubscription),
          notes: [UNTRUSTED_METADATA_NOTE],
        });
      })
  );

  server.registerTool(
    'get_worker_stats',
    {
      title: 'Get preservation queue statistics',
      description:
        'Reports how many links are waiting to be preserved, how many succeeded and ' +
        'how many failed, plus the search-index backlog. Use it to find out whether ' +
        'a page requested through represerve_link has been archived yet.\n\n' +
        'Requires the instance administrator account (the id in NEXT_PUBLIC_ADMIN, 1 ' +
        'by default); every other account gets HTTP 403 here. The counts cover the ' +
        'whole instance, not just this account.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () =>
      run(async () => {
        const stats = (await api.get('/worker')) as RawWorkerStats;
        return jsonResult({
          links: {
            pending: stats.link?.pending ?? 0,
            preserved: stats.link?.done ?? 0,
            failed: stats.link?.failed ?? 0,
          },
          search_index: {
            pending: stats.search?.pending ?? 0,
            indexed: stats.search?.done ?? 0,
          },
        });
      })
  );
}
