import { createHash } from 'node:crypto';

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
  assertFetchableUrl,
  collectionId,
  confirmToken,
  httpUrl,
  idPath,
  linkId,
} from '../schema.js';
import { shapeLink, type RawLink } from '../shape.js';

/** Upper bound on how many links one bulk call may touch. */
const MAX_BULK_LINKS = 200;

const tagNames = z
  .array(z.string().trim().min(1).max(50))
  .max(50)
  .describe('Tag names. Tags that do not exist yet are created.');

/**
 * The body `PUT /links/{id}` expects.
 *
 * Linkwarden validates this against a schema that requires the whole object:
 * `name` and `description` are written as `data.name || ""`, the tag list is
 * applied with `set: []` first, and a missing `url` makes the route answer
 * "Invalid URL.". Omitting any of them therefore *clears* it, which is why every
 * update reads the link first and merges.
 */
interface LinkUpdateBody {
  id: number;
  name: string;
  url: string | null;
  description: string;
  icon?: string | null;
  iconWeight?: string | null;
  color?: string | null;
  collection: { id: number; ownerId: number };
  tags: { name: string }[];
  pinnedBy?: { id?: number }[];
}

async function fetchLink(api: LinkwardenApi, id: number): Promise<RawLink> {
  const link = (await api.get(idPath('/links', id))) as RawLink | null;
  if (link === null || link.id === undefined) {
    throw new Error(`link ${id} does not exist or is not accessible`);
  }
  return link;
}

function baseUpdateBody(link: RawLink): LinkUpdateBody {
  const collection = link.collection;
  if (collection?.id === undefined || collection.ownerId === undefined) {
    throw new Error(
      `link ${String(link.id)} came back without its collection — cannot build a safe update`
    );
  }
  return {
    id: link.id as number,
    name: link.name ?? '',
    url: link.url ?? null,
    description: link.description ?? '',
    icon: link.icon ?? null,
    iconWeight: link.iconWeight ?? null,
    color: link.color ?? null,
    collection: { id: collection.id, ownerId: collection.ownerId },
    tags: (link.tags ?? [])
      .map((tag) => tag.name)
      .filter((name): name is string => typeof name === 'string')
      .map((name) => ({ name })),
  };
}

/** The parsed form of a stored URL, or the value itself when it does not parse. */
function canonical(value: string | null): string | null {
  if (value === null) return null;
  try {
    return new URL(value).toString();
  } catch {
    return value;
  }
}

function fingerprint(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(value))
    .digest('hex')
    .slice(0, 16);
}

export function registerLinkWriteTools(
  server: McpServer,
  api: LinkwardenApi,
  confirmations: ConfirmationStore
): void {
  server.registerTool(
    'create_link',
    {
      title: 'Create a link',
      description:
        'Saves a bookmark. Linkwarden fetches the page title itself when no name is ' +
        'given, and queues the page for preservation according to the account ' +
        'defaults (get_current_user shows them).\n\nThe collection is optional; ' +
        'without one the link lands in "Unorganized". Naming a collection that does ' +
        'not exist creates it. If the account has "prevent duplicate links" enabled, ' +
        'saving a URL twice fails with HTTP 409.\n\n' +
        'Linkwarden does the fetching, so a URL addressing its own loopback, the ' +
        'link-local range or a cloud metadata endpoint is refused here. A private ' +
        'LAN address is accepted by this server, but Linkwarden 2.14 and later ' +
        'refuse to preserve one themselves — the bookmark is created and stays ' +
        'without an archive, so get_link_content will have nothing to return.',
      inputSchema: {
        url: httpUrl.describe('URL to bookmark, including the scheme'),
        name: z
          .string()
          .trim()
          .max(2048)
          .optional()
          .describe('Title. Omit to let Linkwarden read it from the page.'),
        description: z.string().trim().max(2048).optional(),
        collection_id: collectionId
          .optional()
          .describe(
            'Target collection. Mutually exclusive with collection_name.'
          ),
        collection_name: z
          .string()
          .trim()
          .max(2048)
          .optional()
          .describe(
            'Target collection by name; it is created if it does not exist. Mutually exclusive with collection_id.'
          ),
        tags: tagNames.optional(),
      },
      annotations: {},
    },
    async ({ url, name, description, collection_id, collection_name, tags }) =>
      run(async () => {
        if (collection_id !== undefined && collection_name !== undefined) {
          return errorResult(
            'Give either collection_id or collection_name, not both.'
          );
        }
        const collection =
          collection_id !== undefined
            ? { id: collection_id }
            : collection_name !== undefined
              ? { name: collection_name }
              : undefined;

        // What goes on the wire is the parsed URL, not the argument: the point
        // of the check is that the URL Linkwarden fetches is the one that was
        // looked at.
        const target = await assertFetchableUrl(url);

        const created = await api.post('/links', {
          type: 'url',
          url: target,
          ...(name !== undefined ? { name } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(collection !== undefined ? { collection } : {}),
          tags: (tags ?? []).map((tagName) => ({ name: tagName })),
        });
        assertNotErrorMessage(created, 'Creating the link');
        return jsonResult({ created: shapeLink(created as RawLink) });
      })
  );

  server.registerTool(
    'update_link',
    {
      title: 'Update a link',
      description:
        'Changes a bookmark. Fields that are not given stay as they are: the tool ' +
        'reads the link first and merges, because the underlying route replaces the ' +
        'whole record and would otherwise clear the title, description and every ' +
        'tag.\n\n' +
        'The tags argument REPLACES the tag list — pass the full set you want. ' +
        'Moving a link to another collection only works for the collection owner.\n\n' +
        'Changing the URL is destructive and needs a confirmation token: Linkwarden ' +
        'deletes every preserved copy of the old page (screenshot, PDF, readable ' +
        'text, single-file HTML) and starts over.',
      inputSchema: {
        link_id: linkId,
        name: z.string().trim().max(2048).optional().describe('New title'),
        url: httpUrl
          .optional()
          .describe('New URL — destroys the existing preserved copies'),
        description: z.string().trim().max(2048).optional(),
        collection_id: collectionId
          .optional()
          .describe('Move the link to this collection (owner only)'),
        tags: tagNames
          .optional()
          .describe(
            'Replacement tag list. Omit to keep the current tags, pass [] to remove all of them.'
          ),
        confirm_token: confirmToken,
      },
      annotations: { idempotentHint: true },
    },
    async ({
      link_id,
      name,
      url,
      description,
      collection_id,
      tags,
      confirm_token,
    }) =>
      run(async () => {
        const link = await fetchLink(api, link_id);
        const body = baseUpdateBody(link);

        // Before the confirmation, not after it: a URL that will be refused must
        // not first be confirmed. Both sides are compared in parsed form, so
        // re-sending the stored URL spelled differently is not treated as a
        // change and does not destroy the preserved copies for nothing.
        const target =
          url === undefined ? undefined : await assertFetchableUrl(url);
        const urlChanges =
          target !== undefined &&
          target !== body.url &&
          target !== canonical(body.url);
        if (urlChanges) {
          // Bound to the whole effect, not just the new URL: a confirmation
          // obtained for the URL change must not also carry a collection move or a
          // tag replacement that was added afterwards.
          const resource = `update_link:${link_id}:url:${fingerprint({
            url,
            name: name ?? null,
            description: description ?? null,
            collection_id: collection_id ?? null,
            tags: tags ?? null,
          })}`;
          if (!confirmations.consume(resource, confirm_token)) {
            if (confirm_token !== undefined) {
              return errorResult(
                'The confirmation token is invalid, expired, or was issued for a ' +
                  'different change. Call update_link without a token to get a new one.'
              );
            }
            const token = confirmations.issue(resource);
            const existing = Object.entries({
              screenshot: link.image,
              pdf: link.pdf,
              readable: link.readable,
              monolith: link.monolith,
            })
              .filter(
                ([, path]) =>
                  typeof path === 'string' &&
                  path !== '' &&
                  path !== 'unavailable'
              )
              .map(([format]) => format);
            // Only server-side metadata in this text — no titles or URLs, which
            // come from a saved page and are read here by a model.
            return textResult(
              confirmationPrompt(
                `change the URL of link ${link_id} and delete its ${
                  existing.length > 0
                    ? `${existing.length} preserved format(s) (${existing.join(', ')})`
                    : 'preservation state'
                }`,
                token,
                confirmations.ttlMinutes
              )
            );
          }
        }

        if (name !== undefined) body.name = name;
        // Only when it really changes: Linkwarden compares the old and new URL
        // with exact string equality and deletes every preserved copy when they
        // differ, so writing a merely re-spelled URL back would destroy the
        // archives — and without the confirmation, since urlChanges said no.
        if (urlChanges) body.url = target;
        if (description !== undefined) body.description = description;
        if (collection_id !== undefined) body.collection.id = collection_id;
        if (tags !== undefined) body.tags = tags.map((n) => ({ name: n }));

        const updated = await api.put(idPath('/links', link_id), body);
        assertNotErrorMessage(updated, 'Updating the link');
        return jsonResult({ updated: shapeLink(updated as RawLink) });
      })
  );

  server.registerTool(
    'set_link_pinned',
    {
      title: 'Pin or unpin a link',
      description:
        "Pins a link to the account's dashboard, or removes the pin. Pins are per " +
        'account, so this only affects the account the token belongs to. Pinned ' +
        'links can be listed with search_links and pinned_only=true.',
      inputSchema: {
        link_id: linkId,
        pinned: z.boolean().describe('true to pin, false to unpin'),
      },
      annotations: { idempotentHint: true },
    },
    async ({ link_id, pinned }) =>
      run(async () => {
        // The route decides between connect and disconnect by comparing
        // pinnedBy[0].id with the authenticated user's id, so it has to be known.
        const me = (await api.get('/users/me')) as { id?: number };
        if (me.id === undefined) {
          throw new Error('could not determine the authenticated account id');
        }
        const link = await fetchLink(api, link_id);
        const body = baseUpdateBody(link);
        // Pinning connects the account; anything that is not the account's own id
        // disconnects it. An empty object is the least surprising "not me".
        body.pinnedBy = pinned ? [{ id: me.id }] : [{}];

        const updated = await api.put(idPath('/links', link_id), body);
        assertNotErrorMessage(
          updated,
          pinned ? 'Pinning the link' : 'Unpinning the link'
        );
        return jsonResult({
          link_id,
          pinned,
          link: shapeLink(updated as RawLink),
        });
      })
  );

  server.registerTool(
    'delete_link',
    {
      title: 'Delete a link',
      description:
        'Deletes a bookmark and every preserved copy of the page. Two-step: the ' +
        'first call returns a confirmation token, the second call with that token ' +
        'performs the deletion.',
      inputSchema: { link_id: linkId, confirm_token: confirmToken },
      annotations: { destructiveHint: true },
    },
    async ({ link_id, confirm_token }) =>
      run(async () => {
        const resource = setResourceKey('delete_link', [String(link_id)]);
        if (!confirmations.consume(resource, confirm_token)) {
          if (confirm_token !== undefined) {
            return errorResult(
              'The confirmation token is invalid, expired, or was issued for a ' +
                'different link. Call delete_link without a token to get a new one.'
            );
          }
          // Fetching first also makes the tool fail early on an id the account
          // cannot see, instead of after the confirmation round trip.
          const link = await fetchLink(api, link_id);
          const token = confirmations.issue(resource);
          return textResult(
            confirmationPrompt(
              `permanently delete link ${link_id} from collection ${String(
                link.collection?.id ?? link.collectionId
              )}, including its preserved copies`,
              token,
              confirmations.ttlMinutes
            ) +
              '\nThe title and URL are withheld on purpose: they come from a saved page.'
          );
        }

        const deleted = await api.delete(idPath('/links', link_id));
        assertNotErrorMessage(deleted, 'Deleting the link');
        return textResult(`Link ${link_id} deleted.`);
      })
  );

  server.registerTool(
    'bulk_update_links',
    {
      title: 'Retag or move many links at once',
      description:
        'Applies the same tag list and/or target collection to a set of links. ' +
        'Cheaper than one update_link per link, but far blunter: it can only set ' +
        'tags and move collections, and the tag list applies to every link in the ' +
        'set.\n\n' +
        'With replace_tags=true the given tags REPLACE whatever each link had, so ' +
        'an empty tag list strips all tags from all of them. With replace_tags=false ' +
        'the tags are added to the existing ones. Either way this needs a ' +
        'confirmation token, because it rewrites many records at once.',
      inputSchema: {
        link_ids: z
          .array(linkId)
          .min(1)
          .max(MAX_BULK_LINKS)
          .describe(`Link ids, at most ${MAX_BULK_LINKS}`),
        tags: tagNames.describe(
          'Tag names to apply to every link in the set. Pass [] with replace_tags=true to strip all tags.'
        ),
        replace_tags: z
          .boolean()
          .describe(
            "true replaces each link's tags with the given list, false adds to them"
          ),
        collection_id: collectionId
          .optional()
          .describe('Move every link to this collection (owner only)'),
        confirm_token: confirmToken,
      },
      annotations: { destructiveHint: true },
    },
    async ({ link_ids, tags, replace_tags, collection_id, confirm_token }) =>
      run(async () => {
        const ids = [...new Set(link_ids)];
        // The token covers the id set AND the change, so a confirmation for
        // "add one tag" cannot be replayed as "replace all tags with nothing".
        const resource = setResourceKey(
          `bulk_update_links:${fingerprint({
            tags: [...tags].sort(),
            replace_tags,
            collection_id: collection_id ?? null,
          })}`,
          ids.map(String)
        );

        if (!confirmations.consume(resource, confirm_token)) {
          if (confirm_token !== undefined) {
            return errorResult(
              'The confirmation token is invalid, expired, or was issued for a ' +
                'different set of links or a different change. Call ' +
                'bulk_update_links without a token to get a new one.'
            );
          }
          const token = confirmations.issue(resource);
          return textResult(
            confirmationPrompt(
              `${replace_tags ? 'replace the tags of' : 'add tags to'} ${ids.length} link(s)` +
                (collection_id !== undefined
                  ? ` and move them to collection ${collection_id}`
                  : '') +
                (replace_tags && tags.length === 0
                  ? ', which removes every tag from all of them'
                  : ''),
              token,
              confirmations.ttlMinutes
            )
          );
        }

        const result = await api.put('/links', {
          links: ids.map((id) => ({ id })),
          removePreviousTags: replace_tags,
          newData: {
            tags: tags.map((name) => ({ name })),
            ...(collection_id !== undefined
              ? { collectionId: collection_id }
              : {}),
          },
        });
        assertNotErrorMessage(result, 'Updating the links');
        // Deliberately not the upstream payload: every other tool routes API data
        // through the allowlist in shape.ts so that a column added by a future
        // Linkwarden release cannot land in the model context unannounced, and
        // `PUT /links` answers with a bare status sentence that carries nothing
        // worth forwarding.
        return jsonResult({
          updated_link_ids: ids,
          updated_count: ids.length,
        });
      })
  );

  server.registerTool(
    'bulk_delete_links',
    {
      title: 'Delete many links at once',
      description:
        'Deletes a set of bookmarks and all their preserved copies. Two-step: the ' +
        'first call returns a confirmation token that is bound to exactly this set ' +
        'of ids — adding an id afterwards invalidates it.',
      inputSchema: {
        link_ids: z
          .array(linkId)
          .min(1)
          .max(MAX_BULK_LINKS)
          .describe(`Link ids, at most ${MAX_BULK_LINKS}`),
        confirm_token: confirmToken,
      },
      annotations: { destructiveHint: true },
    },
    async ({ link_ids, confirm_token }) =>
      run(async () => {
        const ids = [...new Set(link_ids)];
        const resource = setResourceKey('bulk_delete_links', ids.map(String));

        if (!confirmations.consume(resource, confirm_token)) {
          if (confirm_token !== undefined) {
            return errorResult(
              'The confirmation token is invalid, expired, or was issued for a ' +
                'different set of links. Call bulk_delete_links without a token to ' +
                'get a new one.'
            );
          }
          const token = confirmations.issue(resource);
          return textResult(
            confirmationPrompt(
              `permanently delete ${ids.length} link(s) (ids ${ids.join(', ')}) including their preserved copies`,
              token,
              confirmations.ttlMinutes
            )
          );
        }

        const result = await api.delete('/links', { linkIds: ids });
        assertNotErrorMessage(result, 'Deleting the links');
        return textResult(`Deleted ${ids.length} link(s): ${ids.join(', ')}.`);
      })
  );

  server.registerTool(
    'represerve_link',
    {
      title: 'Preserve a link again',
      description:
        'Has Linkwarden archive the page again. This first DELETES the existing ' +
        'preserved copies and only then re-queues the link, so if the site is gone ' +
        'or now blocks the archiver, the old copies are lost and nothing replaces ' +
        'them. That is why it needs a confirmation token.\n\n' +
        'The work happens in a background worker; get_worker_stats shows the queue.',
      inputSchema: { link_id: linkId, confirm_token: confirmToken },
      annotations: { destructiveHint: true },
    },
    async ({ link_id, confirm_token }) =>
      run(async () => {
        const resource = setResourceKey('represerve_link', [String(link_id)]);
        if (!confirmations.consume(resource, confirm_token)) {
          if (confirm_token !== undefined) {
            return errorResult(
              'The confirmation token is invalid, expired, or was issued for a ' +
                'different link. Call represerve_link without a token to get a new one.'
            );
          }
          const token = confirmations.issue(resource);
          return textResult(
            confirmationPrompt(
              `delete the preserved copies of link ${link_id} and archive the page again`,
              token,
              confirmations.ttlMinutes
            )
          );
        }

        // This route answers 200 with "Invalid URL." when the link has none.
        const result = await api.put(idPath('/links', link_id, '/archive'));
        assertNotErrorMessage(result, 'Re-preserving the link');
        return textResult(
          `Link ${link_id} was queued for preservation. Check get_worker_stats for progress.`
        );
      })
  );

  server.registerTool(
    'delete_link_preservations',
    {
      title: 'Delete the preserved copies of links',
      description:
        'Removes the archived screenshot, PDF, readable text and single-file HTML of ' +
        'a set of links while keeping the bookmarks themselves. Useful to reclaim ' +
        'disk space. Unlike represerve_link this does NOT re-archive anything — use ' +
        'that tool if the copies should be recreated.',
      inputSchema: {
        link_ids: z
          .array(linkId)
          .min(1)
          .max(MAX_BULK_LINKS)
          .describe(`Link ids, at most ${MAX_BULK_LINKS}`),
        confirm_token: confirmToken,
      },
      annotations: { destructiveHint: true },
    },
    async ({ link_ids, confirm_token }) =>
      run(async () => {
        const ids = [...new Set(link_ids)];
        const resource = setResourceKey(
          'delete_link_preservations',
          ids.map(String)
        );

        if (!confirmations.consume(resource, confirm_token)) {
          if (confirm_token !== undefined) {
            return errorResult(
              'The confirmation token is invalid, expired, or was issued for a ' +
                'different set of links. Call delete_link_preservations without a ' +
                'token to get a new one.'
            );
          }
          const token = confirmations.issue(resource);
          return textResult(
            confirmationPrompt(
              `permanently delete every preserved copy of ${ids.length} link(s) (ids ${ids.join(', ')}), keeping the bookmarks`,
              token,
              confirmations.ttlMinutes
            )
          );
        }

        const result = await api.delete('/links/archive', { linkIds: ids });
        assertNotErrorMessage(result, 'Deleting the preserved copies');
        return textResult(
          `Deleted the preserved copies of ${ids.length} link(s): ${ids.join(', ')}.`
        );
      })
  );
}
