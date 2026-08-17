#!/usr/bin/env node
/**
 * Drives the three beats of the demo GIF (see demo.tape). Run from the repo root:
 *
 *   LINKWARDEN_URL=… LINKWARDEN_TOKEN=… node docs/demo.mjs
 *
 * Talks to the built server over stdio exactly as a client would. It only ever
 * READS, plus one first-call-of-a-destructive-tool that returns a confirmation
 * token and deletes nothing — so it is safe to point at any instance. Requires
 * `npm run build`, at least one link, and one link with a readable archive for
 * the second beat.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BEAT = Number(process.env.DEMO_BEAT_MS ?? 1400);

function out(s = '') {
  process.stdout.write(s + '\n');
}

/**
 * Text of a tool result. Results carrying upstream content are prefixed with the
 * untrusted-data marker, so JSON payloads start at the first brace rather than at
 * character zero.
 */
function textOf(result) {
  const raw = (result.content ?? []).map((c) => c.text ?? '').join('\n');
  const start = raw.search(/[[{]/);
  return start === -1 ? raw : raw.slice(start);
}

const client = new Client({ name: 'demo', version: '1' });
await client.connect(
  new StdioClientTransport({
    command: 'node',
    args: ['dist/index.js'],
    env: {
      PATH: process.env.PATH,
      LINKWARDEN_URL: process.env.LINKWARDEN_URL,
      LINKWARDEN_TOKEN: process.env.LINKWARDEN_TOKEN,
    },
    stderr: 'ignore',
  })
);

// ---------------------------------------------------------------- beat 1
const { tools } = await client.listTools();
const read = tools.filter((t) => t.annotations?.readOnlyHint).length;
out('$ tools/list');
out(`  ${tools.length} tools — ${read} read, ${tools.length - read} write`);
await sleep(BEAT);

// ---------------------------------------------------------------- beat 2
out('');
out('$ search_links  →  get_link_content');
const found = JSON.parse(
  textOf(await client.callTool({ name: 'search_links', arguments: {} }))
);
// search_links has no per-call limit — it returns up to 100 and a next_cursor —
// so the GIF trims the list rather than pretending there is an argument for it.
for (const link of (found.links ?? []).slice(0, 3)) {
  const tags = (link.tags ?? []).map((t) => t.name).join(', ');
  out(`  ${link.id}  ${link.name}${tags ? `  [${tags}]` : ''}`);
}

// The point of the whole server: read the copy Linkwarden preserved.
const readable = (found.links ?? [])
  .slice(0, 3)
  .find((l) => l.preserved?.readable);
if (readable) {
  const article = JSON.parse(
    textOf(
      await client.callTool({
        name: 'get_link_content',
        arguments: { link_id: readable.id, max_chars: 160 },
      })
    )
  );
  out('');
  out(`  link ${readable.id} was preserved — reading the saved copy:`);
  const snippet = (article.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
  out(`  "${snippet}…"`);
  out(`  (${article.total_chars} characters archived, sliced on request)`);
} else {
  out('  (no link on this instance has a readable archive yet)');
}
await sleep(BEAT);

// ---------------------------------------------------------------- beat 3
out('');
out('$ delete_link  (first call — nothing is deleted)');
const target = (found.links ?? [])[0];
if (target) {
  const answer = textOf(
    await client.callTool({
      name: 'delete_link',
      arguments: { link_id: target.id },
    })
  );
  for (const line of answer.split('\n')) out(`  ${line}`);
} else {
  out('  (no link on this instance to demonstrate with)');
}
await sleep(BEAT);

await client.close();
