import { createRequire } from 'node:module';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { LinkwardenApi } from './api.js';
import type { Config } from './config.js';
import { ConfirmationStore } from './confirm.js';
import { buildToolFilter, installToolFilter } from './tool-filter.js';
import { registerCollectionReadTools } from './tools/collections.js';
import { registerCollectionWriteTools } from './tools/collections-write.js';
import { registerLinkReadTools } from './tools/links.js';
import { registerLinkWriteTools } from './tools/links-write.js';
import { registerOverviewReadTools } from './tools/overview.js';
import { registerRssWriteTools } from './tools/rss-write.js';
import { registerTagReadTools } from './tools/tags.js';
import { registerTagWriteTools } from './tools/tags-write.js';

function packageVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require('../package.json') as { version: string };
    return pkg.version;
  } catch {
    return '0.0.0';
  }
}

export function createServer(config: Config): McpServer {
  // Before anything is built: an unusable tool list should fail on the way in,
  // not leave a server running with tools quietly missing.
  const filter = buildToolFilter(config);

  const api = new LinkwardenApi(config);

  const server = new McpServer({
    name: 'linkwarden-mcp',
    version: packageVersion(),
  });

  installToolFilter(server, filter);

  registerLinkReadTools(server, api);
  registerCollectionReadTools(server, api);
  registerTagReadTools(server, api);
  registerOverviewReadTools(server, api);

  // Read-only mode does not register the write tools at all. Rejecting them at
  // call time would still advertise capabilities the server refuses to provide,
  // and the model would keep retrying against a wall.
  if (!config.readOnly) {
    // One store for the whole server, so a token issued by one tool can never be
    // consumed by another: the resource key carries the operation name.
    const confirmations = new ConfirmationStore();
    registerLinkWriteTools(server, api, confirmations);
    registerCollectionWriteTools(server, api, confirmations);
    registerTagWriteTools(server, api, confirmations);
    registerRssWriteTools(server, api, confirmations);
  }

  return server;
}
