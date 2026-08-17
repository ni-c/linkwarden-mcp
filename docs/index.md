---
layout: home

hero:
  name: linkwarden-mcp
  text: Your bookmarks, readable by an assistant
  tagline: An MCP server for Linkwarden — search a bookmark collection, keep it organised, and read the article text of a page Linkwarden has already preserved.
  image:
    src: /favicon.svg
    alt: linkwarden-mcp
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Tool reference
      link: /reference/tools
    - theme: alt
      text: GitHub
      link: https://github.com/ni-c/linkwarden-mcp

features:
  - title: Reads what Linkwarden preserved
    details: Linkwarden keeps a permanent copy of every page it saves. get_link_content serves that article text, so a saved link can be summarised or quoted without fetching the live site again — and long articles are sliced, not dumped.
  - title: Organises without clobbering
    details: Linkwarden's update routes replace whole records. This server reads the current state and merges, so changing a title never silently strips a link's tags or a collection's collaborators.
  - title: Destructive actions are two-step
    details: Deleting, re-preserving or publishing needs a server-issued confirmation token bound to the exact target. A model cannot satisfy that gate on its own, and a token for one link cannot be replayed for another.
  - title: Read-only when you want it
    details: LINKWARDEN_READ_ONLY=true does not register the write tools at all — they are absent from tools/list, not merely refused at call time.
---

<div class="diagram">
<figure>
<!-- SYNC: this diagram is duplicated as docs/public/architecture.svg for the README
     and npm, which cannot use CSS variables. Change both together. -->
<svg viewBox="0 0 720 260" role="img" aria-labelledby="arch-title arch-desc">
  <title id="arch-title">How linkwarden-mcp sits between an MCP client and Linkwarden</title>
  <desc id="arch-desc">An MCP client speaks stdio to linkwarden-mcp, which calls the Linkwarden REST API over HTTPS. Linkwarden stores bookmarks and preserved copies of pages.</desc>
  <defs>
    <marker id="arrow" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
      <path d="M0,0 L7,3 L0,6 z" />
    </marker>
    <marker id="arrow-accent" class="accent" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
      <path d="M0,0 L7,3 L0,6 z" />
    </marker>
  </defs>

  <rect class="node" x="20" y="70" width="160" height="80" rx="10" />
  <text class="label-title" x="100" y="103" text-anchor="middle">MCP client</text>
  <text class="label-muted" x="100" y="123" text-anchor="middle">Claude, Codex, …</text>

  <rect class="node-accent" x="280" y="60" width="170" height="100" rx="10" />
  <text class="label-title" x="365" y="95" text-anchor="middle">linkwarden-mcp</text>
  <text class="label-muted" x="365" y="115" text-anchor="middle">28 tools · allowlisted output</text>
  <text class="label-muted" x="365" y="133" text-anchor="middle">confirm tokens</text>

  <rect class="node" x="550" y="70" width="150" height="80" rx="10" />
  <text class="label-title" x="625" y="103" text-anchor="middle">Linkwarden</text>
  <text class="label-muted" x="625" y="123" text-anchor="middle">bookmarks + archives</text>

  <path class="edge-accent" d="M180,110 L272,110" marker-end="url(#arrow-accent)" />
  <text class="label-mono" x="226" y="98" text-anchor="middle">stdio</text>

  <path class="edge-accent" d="M450,110 L542,110" marker-end="url(#arrow-accent)" />
  <text class="label-mono" x="496" y="98" text-anchor="middle">HTTPS</text>
  <text class="label-muted" x="496" y="130" text-anchor="middle">/api/v1</text>

  <path class="edge edge-dashed" d="M625,150 L625,196" marker-end="url(#arrow)" />
  <text class="label-muted" x="625" y="216" text-anchor="middle">preserved pages: readable text, PDF,</text>
  <text class="label-muted" x="625" y="232" text-anchor="middle">screenshot, single-file HTML</text>
</svg>
<figcaption>The server holds no state of its own beyond short-lived confirmation tokens.</figcaption>
</figure>
</div>

## In one command

```sh
claude mcp add linkwarden \
  -e LINKWARDEN_URL=https://links.example.net \
  -e LINKWARDEN_TOKEN=… \
  -- npx -y linkwarden-mcp
```

Then ask for something you saved months ago:

> *"What did that article I bookmarked about the Model Context Protocol actually say about transports?"*

The assistant searches your collection, finds the link, and reads the copy Linkwarden
preserved — even if the original page has since changed or gone.

::: warning A token is an account, not a scope
Linkwarden has no per-token permissions: a token carries everything the account that
created it can do. Create a dedicated account with access only to the collections this
server should see. See [Security](/guide/security).
:::
