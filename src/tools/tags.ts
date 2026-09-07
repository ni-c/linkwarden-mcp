import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import {
  notes,
  tag,
  truncationNote,
  untrustedFields,
} from '../output-schema.js';
import {
  cursor,
  idPath,
  tagId,
  tagSort,
  tagSortValue,
  withQuery,
} from '../schema.js';
import { Notes, shapeTag, UNTRUSTED_METADATA_NOTE } from '../shape.js';
import {
  cursorOf,
  objectOf,
  readTag,
  readTags,
  recordOf,
  skippedNote,
} from '../boundary.js';

import type { LinkwardenApi } from '../api.js';
import { READ_ONLY } from './annotations.js';
import { run, untrustedResult } from '../result.js';

/** Defensive cap; the instance itself pages at PAGINATION_TAKE_COUNT. */
const MAX_TAGS = 200;

export function registerTagReadTools(
  server: McpServer,
  api: LinkwardenApi
): void {
  server.registerTool(
    'list_tags',
    {
      title: 'List tags',
      description:
        'Lists the tags of the authenticated account with the number of links each ' +
        'one is attached to. Tags cut across collections. The per-tag archival ' +
        'settings are included: null there means "inherit the account default", ' +
        'which is not the same as false.',
      inputSchema: z.object({
        search: z
          .string()
          .max(50)
          .optional()
          .describe('Only return tags whose name contains this text'),
        sort: tagSort,
        cursor,
      }),
      annotations: READ_ONLY,
      outputSchema: z.object({
        ...untrustedFields,
        truncated: truncationNote,
        count: z.number().int(),
        // Declared, because it is answered — on every call, `null` included.
        // A `z.object` emits `additionalProperties: false`, so a client that
        // had loaded `tools/list` refused every successful `list_tags` result
        // with "Structured content does not match the tool's output schema".
        // The server-side check strips the key and passes, which is why 400
        // green tests never saw it: none of them listed first.
        next_cursor: z
          .number()
          .int()
          .describe('Pass as cursor to continue; null when the list ends.')
          .nullable()
          .optional(),
        tags: z.array(tag),
        notes,
      }),
    },
    async ({ search, sort, cursor: from }) =>
      run(async () => {
        const payload =
          objectOf(
            await api.get(
              withQuery('/tags', {
                search,
                sort: tagSortValue(sort),
                cursor: from,
              })
            )
          ) ?? {};

        const read = readTags(payload.tags);
        const tags = read.items.slice(0, MAX_TAGS);
        const resultNotes = new Notes();
        resultNotes.add(UNTRUSTED_METADATA_NOTE);
        resultNotes.add(skippedNote(read.skipped, 'tag'));
        const nextCursor = cursorOf(payload.nextCursor);
        if (nextCursor !== null) {
          resultNotes.add(
            `More tags exist: call list_tags again with the same arguments and cursor=${nextCursor}.`
          );
        }

        return untrustedResult({
          count: tags.length,
          next_cursor: nextCursor,
          tags: tags.map(shapeTag),
          notes: resultNotes.list(),
        });
      })
  );

  server.registerTool(
    'get_tag',
    {
      title: 'Get a tag',
      description:
        'Fetches one tag with its archival settings. Use search_links with tag_id ' +
        'to get the links carrying it.',
      inputSchema: z.object({ tag_id: tagId }),
      annotations: READ_ONLY,
      outputSchema: z.object({
        ...untrustedFields,
        tag: tag.nullable(),
        notes,
      }),
    },
    async ({ tag_id }) =>
      run(async () => {
        const payload = await api.get(idPath('/tags', tag_id));
        if (payload === null) {
          return untrustedResult({
            tag: null,
            notes: [`No tag with id ${tag_id} is visible to this account.`],
          });
        }
        const rawTag = readTag(recordOf(payload, `tag ${tag_id}`)) ?? {};
        return untrustedResult({
          tag: shapeTag(rawTag),
          notes: [UNTRUSTED_METADATA_NOTE],
        });
      })
  );
}
