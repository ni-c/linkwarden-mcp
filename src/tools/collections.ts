import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { LinkwardenApi } from '../api.js';
import { jsonResult, run } from '../result.js';
import { collectionId, idPath } from '../schema.js';
import {
  shapeCollection,
  UNTRUSTED_METADATA_NOTE,
  type RawCollection,
} from '../shape.js';

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
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () =>
      run(async () => {
        const collections = (await api.get('/collections')) as RawCollection[];
        return jsonResult({
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
      inputSchema: { collection_id: collectionId },
      annotations: { readOnlyHint: true },
    },
    async ({ collection_id }) =>
      run(async () => {
        const collection = (await api.get(
          idPath('/collections', collection_id)
        )) as RawCollection | null;
        if (collection === null) {
          return jsonResult({
            collection: null,
            notes: [
              `No collection with id ${collection_id} is visible to this account.`,
            ],
          });
        }
        return jsonResult({
          collection: shapeCollection(collection),
          notes: [UNTRUSTED_METADATA_NOTE],
        });
      })
  );
}
