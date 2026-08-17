#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { loadConfig } from './config.js';
import { createServer } from './server.js';

async function main(): Promise<void> {
  const config = loadConfig();

  if (config.insecureTls) {
    console.error(
      'linkwarden-mcp: LINKWARDEN_INSECURE_TLS=true — TLS certificate validation is disabled for the Linkwarden connection'
    );
  }
  if (config.readOnly) {
    console.error(
      'linkwarden-mcp: LINKWARDEN_READ_ONLY=true — write tools are not registered'
    );
  }

  const server = createServer(config);
  // stdout belongs to the protocol; everything human-readable goes to stderr.
  await server.connect(new StdioServerTransport());
  console.error(
    config.url
      ? `linkwarden-mcp: connected, targeting ${config.url}`
      : 'linkwarden-mcp: connected without configuration — tools are listed but every call will fail'
  );
}

main().catch((error: unknown) => {
  console.error('linkwarden-mcp: fatal error:', error);
  process.exit(1);
});
