import type { McpServer } from '@modelcontextprotocol/server';
import {
  shapeCollection,
  UNTRUSTED_METADATA_NOTE,
  type RawCollection,
} from '../shape.js';
import { z } from 'zod';
import {
  collection,
  notes,
  truncationNote,
  untrustedFields,
} from '../output-schema.js';

import type { LinkwardenApi } from '../api.js';
import { READ_ONLY } from './annotations.js';
import { run, untrustedResult } from '../result.js';
import { collectionId, idPath } from '../schema.js';

export function registerCollectionReadTools(
  server: McpServer,
  api: LinkwardenApi
): void {
  server.registerTool(
    'list_collections',
    {
      title: 'List collections',
      description:
        'Lists every collection the authenticated account owns or is a member of, ' +
        'with its link count. The list is flat: nesting is expressed through ' +
        'parentId, where null means the collection sits at the top level. ' +
        'Linkwarden does not page this route, so all collections come back at once.',
      inputSchema: z.object({}),
      annotations: READ_ONLY,
      outputSchema: z.object({
        ...untrustedFields,
        truncated: truncationNote,
        count: z.number().int(),
        collections: z.array(collection),
        notes,
      }),
    },
    async () =>
      run(async () => {
        const collections = (await api.get('/collections')) as RawCollection[];
        return untrustedResult({
          count: collections.length,
          collections: collections.map(shapeCollection),
          notes: [UNTRUSTED_METADATA_NOTE],
        });
      })
  );

  server.registerTool(
    'get_collection',
    {
      title: 'Get a collection',
      description:
        'Fetches one collection with its link count and the per-member ' +
        'create/update/delete permissions. Use search_links with collection_id to ' +
        'get the links inside it.',
      inputSchema: z.object({ collection_id: collectionId }),
      annotations: READ_ONLY,
      outputSchema: z.object({
        ...untrustedFields,
        collection: collection.nullable(),
        notes,
      }),
    },
    async ({ collection_id }) =>
      run(async () => {
        const collection = (await api.get(
          idPath('/collections', collection_id)
        )) as RawCollection | null;
        if (collection === null) {
          return untrustedResult({
            collection: null,
            notes: [
              `No collection with id ${collection_id} is visible to this account.`,
            ],
          });
        }
        return untrustedResult({
          collection: shapeCollection(collection),
          notes: [UNTRUSTED_METADATA_NOTE],
        });
      })
  );
}
