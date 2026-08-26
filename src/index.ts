#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { loadConfig } from './config.js';
import { createServer } from './server.js';
import { ToolFilterError } from './tool-filter.js';

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

  let server;
  try {
    server = createServer(config);
  } catch (error) {
    // A bad tool list is operator feedback, not a crash: print the sentence on
    // its own rather than behind "fatal error:" with a stack after it.
    if (error instanceof ToolFilterError) {
      console.error(`linkwarden-mcp: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
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
