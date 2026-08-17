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
import { collectionId, confirmToken, idPath } from '../schema.js';
import { shapeCollection, type RawCollection } from '../shape.js';

/**
 * The body `PUT /collections/{id}` expects.
 *
 * `name` and `members` are required by the upstream schema, and the route deletes
 * every membership row before recreating them from `members`. Sending an
 * incomplete body therefore silently removes collaborators, so every update reads
 * the collection first and merges.
 */
interface CollectionUpdateBody {
  id: number;
  name: string;
  description?: string;
  color?: string;
  icon?: string | null;
  iconWeight?: string | null;
  isPublic?: boolean;
  parentId?: number | 'root';
  members: {
    userId: number;
    canCreate: boolean;
    canUpdate: boolean;
    canDelete: boolean;
  }[];
}

export function registerCollectionWriteTools(
  server: McpServer,
  api: LinkwardenApi,
  confirmations: ConfirmationStore
): void {
  server.registerTool(
    'create_collection',
    {
      title: 'Create a collection',
      description:
        'Creates a collection. Pass parent_id to nest it under an existing ' +
        'collection. New collections are private; use update_collection to publish ' +
        'one.',
      inputSchema: {
        name: z.string().trim().min(1).max(2048).describe('Collection name'),
        description: z.string().trim().max(2048).optional(),
        parent_id: collectionId
          .optional()
          .describe('Nest the new collection under this one'),
        color: z
          .string()
          .trim()
          .max(50)
          .optional()
          .describe('Accent colour as a hex value, e.g. #0ea5e9'),
      },
      annotations: {},
    },
    async ({ name, description, parent_id, color }) =>
      run(async () => {
        const created = await api.post('/collections', {
          name,
          ...(description !== undefined ? { description } : {}),
          ...(parent_id !== undefined ? { parentId: parent_id } : {}),
          ...(color !== undefined ? { color } : {}),
        });
        assertNotErrorMessage(created, 'Creating the collection');
        return jsonResult({
          created: shapeCollection(created as RawCollection),
        });
      })
  );

  server.registerTool(
    'update_collection',
    {
      title: 'Update a collection',
      description:
        'Changes a collection. Fields that are not given stay as they are: the tool ' +
        'reads the collection first and merges, because the underlying route rebuilds ' +
        'the member list from the request body and would otherwise remove every ' +
        'collaborator.\n\n' +
        'Only the owner of a collection may update it. To move a collection to the ' +
        'top level pass parent_id=0 — Linkwarden needs an explicit marker for that ' +
        'and ignores null.\n\n' +
        'Setting is_public=true needs a confirmation token: it makes the collection ' +
        'and every link in it readable by anyone who has the URL, without logging in.',
      inputSchema: {
        collection_id: collectionId,
        name: z.string().trim().min(1).max(2048).optional(),
        description: z.string().trim().max(2048).optional(),
        parent_id: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe(
            'Id of the new parent collection, or 0 to move this collection to the top level'
          ),
        is_public: z
          .boolean()
          .optional()
          .describe(
            'true publishes the collection to anyone with the link (needs confirmation), false makes it private again'
          ),
        color: z.string().trim().max(50).optional(),
        confirm_token: confirmToken,
      },
      annotations: { idempotentHint: true },
    },
    async ({
      collection_id,
      name,
      description,
      parent_id,
      is_public,
      color,
      confirm_token,
    }) =>
      run(async () => {
        const current = (await api.get(
          idPath('/collections', collection_id)
        )) as RawCollection | null;
        if (current === null || current.id === undefined) {
          throw new Error(
            `collection ${collection_id} does not exist or is not accessible`
          );
        }
        if (current.name === undefined) {
          throw new Error(
            `collection ${collection_id} came back without a name — cannot build a safe update`
          );
        }

        const widensVisibility =
          is_public === true && current.isPublic !== true;
        if (widensVisibility) {
          // Bound to the whole effect: a confirmation for "publish it" must not be
          // replayable with a rename or a re-parent attached.
          const effect = createHash('sha256')
            .update(
              JSON.stringify({
                name: name ?? null,
                description: description ?? null,
                parent_id: parent_id ?? null,
                color: color ?? null,
              })
            )
            .digest('hex')
            .slice(0, 16);
          const resource = `update_collection:${collection_id}:publish:${effect}`;
          if (!confirmations.consume(resource, confirm_token)) {
            if (confirm_token !== undefined) {
              return errorResult(
                'The confirmation token is invalid, expired, or was issued for a ' +
                  'different change. Call update_collection without a token to get a new one.'
              );
            }
            const token = confirmations.issue(resource);
            return textResult(
              `This will publish collection ${collection_id} and the ${String(
                current._count?.links ?? 'unknown number of'
              )} link(s) in it: anyone with the URL can then read them without ` +
                'logging in, and search engines may index them. Publishing cannot ' +
                'un-publish what has already been copied.\n\n' +
                `To proceed, call this tool again with confirm_token="${token}".\n` +
                `The token is valid for ${confirmations.ttlMinutes} minutes and can be used once.`
            );
          }
        }

        const body: CollectionUpdateBody = {
          id: current.id,
          name: name ?? current.name,
          description: description ?? current.description ?? '',
          ...(color !== undefined
            ? { color }
            : current.color !== undefined
              ? { color: current.color }
              : {}),
          icon: current.icon ?? null,
          iconWeight: current.iconWeight ?? null,
          isPublic: is_public ?? current.isPublic ?? false,
          // Rebuilt from the current state — the route wipes the membership rows
          // and recreates them from exactly this list.
          members: (current.members ?? []).map((member) => ({
            userId: member.userId as number,
            canCreate: member.canCreate ?? false,
            canUpdate: member.canUpdate ?? false,
            canDelete: member.canDelete ?? false,
          })),
        };
        if (parent_id !== undefined) {
          body.parentId = parent_id === 0 ? 'root' : parent_id;
        } else if (
          current.parentId !== null &&
          current.parentId !== undefined
        ) {
          body.parentId = current.parentId;
        }

        const updated = await api.put(
          idPath('/collections', collection_id),
          body
        );
        assertNotErrorMessage(updated, 'Updating the collection');
        return jsonResult({
          updated: shapeCollection(updated as RawCollection),
        });
      })
  );

  server.registerTool(
    'delete_collection',
    {
      title: 'Delete a collection',
      description:
        'Deletes a collection. This cascades: every link inside it, every preserved ' +
        'copy of those pages, and every sub-collection below it are deleted too. ' +
        'Two-step: the first call reports how many links would be lost and returns a ' +
        'confirmation token.',
      inputSchema: { collection_id: collectionId, confirm_token: confirmToken },
      annotations: { destructiveHint: true },
    },
    async ({ collection_id, confirm_token }) =>
      run(async () => {
        const resource = setResourceKey('delete_collection', [
          String(collection_id),
        ]);
        if (!confirmations.consume(resource, confirm_token)) {
          if (confirm_token !== undefined) {
            return errorResult(
              'The confirmation token is invalid, expired, or was issued for a ' +
                'different collection. Call delete_collection without a token to get a new one.'
            );
          }
          const current = (await api.get(
            idPath('/collections', collection_id)
          )) as RawCollection | null;
          if (current === null || current.id === undefined) {
            throw new Error(
              `collection ${collection_id} does not exist or is not accessible`
            );
          }
          const token = confirmations.issue(resource);
          // Counts and flags only — the collection name is user-supplied text.
          return textResult(
            confirmationPrompt(
              `permanently delete collection ${collection_id} together with its ${String(
                current._count?.links ?? 'unknown number of'
              )} link(s), their preserved copies and all sub-collections` +
                (current.members !== undefined && current.members.length > 0
                  ? `, which ${current.members.length} other member(s) also have access to`
                  : ''),
              token,
              confirmations.ttlMinutes
            ) +
              '\nThe collection name is withheld on purpose: it is user-supplied text.'
          );
        }

        const deleted = await api.delete(idPath('/collections', collection_id));
        assertNotErrorMessage(deleted, 'Deleting the collection');
        return textResult(
          `Collection ${collection_id} and its contents were deleted.`
        );
      })
  );
}
