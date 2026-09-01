import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { setResourceKey } from 'mcp-approval';
import type { Approver, ConfirmationStore } from 'mcp-approval';
import {
  assertNotErrorMessage,
  errorResult,
  jsonResult,
  run,
  textResult,
} from '../result.js';

import type { LinkwardenApi } from '../api.js';
import { confirmToken, idPath, tagId } from '../schema.js';
import { shapeTag, type RawTag } from '../shape.js';

const MAX_TAGS_PER_CALL = 50;

/**
 * Per-tag archival overrides. Tri-state on purpose: omitting a field leaves it
 * alone, null means "inherit the account default", true/false force the setting.
 */
const archivalFlag = (what: string) =>
  z
    .boolean()
    .nullish()
    .describe(
      `${what} for links carrying this tag. null inherits the account default.`
    );

export function registerTagWriteTools(
  server: McpServer,
  api: LinkwardenApi,
  confirmations: ConfirmationStore,
  approval: Approver
): void {
  server.registerTool(
    'create_tags',
    {
      title: 'Create tags or change their archival settings',
      description:
        'Creates tags, or updates the ones that already exist — the underlying route ' +
        'is an upsert keyed on the tag name. This is also the only way to set the ' +
        'per-tag archival overrides, which decide how links carrying the tag get ' +
        'preserved.\n\n' +
        'Note that tags are usually created implicitly by create_link and ' +
        'update_link; use this tool when the archival settings matter, or to create ' +
        'a tag before any link uses it.',
      inputSchema: z.object({
        names: z
          .array(z.string().trim().min(1).max(50))
          .min(1)
          .max(MAX_TAGS_PER_CALL)
          .describe(
            `Tag names, at most ${MAX_TAGS_PER_CALL}. Existing tags are updated rather than duplicated.`
          ),
        archive_as_screenshot: archivalFlag('Store a screenshot'),
        archive_as_pdf: archivalFlag('Store a PDF'),
        archive_as_readable: archivalFlag(
          'Store the readable article text (this is what get_link_content reads)'
        ),
        archive_as_monolith: archivalFlag('Store a single-file HTML copy'),
        archive_as_wayback_machine: archivalFlag(
          'Submit the URL to the Internet Archive'
        ),
        ai_tag: archivalFlag('Let the configured AI model assign this tag'),
      }),
      annotations: {
        // Additive, and get-or-create: asking for a tag that exists returns
        // it rather than making a second.
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({
      names,
      archive_as_screenshot,
      archive_as_pdf,
      archive_as_readable,
      archive_as_monolith,
      archive_as_wayback_machine,
      ai_tag,
    }) =>
      run(async () => {
        const settings = {
          ...(archive_as_screenshot !== undefined
            ? { archiveAsScreenshot: archive_as_screenshot }
            : {}),
          ...(archive_as_pdf !== undefined
            ? { archiveAsPDF: archive_as_pdf }
            : {}),
          ...(archive_as_readable !== undefined
            ? { archiveAsReadable: archive_as_readable }
            : {}),
          ...(archive_as_monolith !== undefined
            ? { archiveAsMonolith: archive_as_monolith }
            : {}),
          ...(archive_as_wayback_machine !== undefined
            ? { archiveAsWaybackMachine: archive_as_wayback_machine }
            : {}),
          ...(ai_tag !== undefined ? { aiTag: ai_tag } : {}),
        };

        // The upstream schema calls the name "label" here — every other tag route
        // calls it "name".
        const result = await api.post('/tags', {
          tags: [...new Set(names)].map((label) => ({ label, ...settings })),
        });
        assertNotErrorMessage(result, 'Creating the tags');
        const tags = Array.isArray(result) ? (result as RawTag[]) : [];
        return jsonResult({ tags: tags.map(shapeTag) });
      })
  );

  server.registerTool(
    'rename_tag',
    {
      title: 'Rename a tag',
      description:
        'Renames a tag; every link carrying it keeps it. Tag names are unique per ' +
        'account, so renaming a tag to a name that already exists fails — use ' +
        'merge_tags to fold two tags into one instead.',
      inputSchema: z.object({
        tag_id: tagId,
        name: z.string().trim().min(1).max(50).describe('New tag name'),
      }),
      annotations: {
        // Replaces a name somebody chose, on every link that carries the tag.
        // wikijs guards update_tag for the same reason.
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ tag_id, name }) =>
      run(async () => {
        const updated = await api.put(idPath('/tags', tag_id), { name });
        assertNotErrorMessage(updated, 'Renaming the tag');
        return jsonResult({ updated: shapeTag(updated as RawTag) });
      })
  );

  server.registerTool(
    'delete_tags',
    {
      title: 'Delete tags',
      description:
        'Deletes one or more tags. The links keep existing, they just lose the tag. ' +
        'Two-step: the first call returns a confirmation token bound to exactly this ' +
        'set of ids.',
      inputSchema: z.object({
        tag_ids: z
          .array(tagId)
          .min(1)
          .max(MAX_TAGS_PER_CALL)
          .describe(`Tag ids, at most ${MAX_TAGS_PER_CALL}`),
        confirm_token: confirmToken,
      }),
      annotations: {
        // Removed from every link that carried them; the links stay.
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ tag_ids, confirm_token }, mcp) =>
      run(async () => {
        const ids = [...new Set(tag_ids)];
        const resource = setResourceKey('delete_tags', ids.map(String));

        const outcome = await approval.requestApproval(
          server,
          mcp,
          confirmations,
          {
            what: `permanently delete ${ids.length} tag(s) (ids ${ids.join(', ')}) and remove them from every link`,
            consequence:
              'The tags are removed from every link that carried them, and that association is not recoverable from here.',
            fallbackNote:
              '\nCall list_tags first if you need to know how many links each one affects.',
            resourceKey: resource,
            token: confirm_token,
            toolName: 'delete_tags',
            hint: 'Tick to go ahead, leave it to cancel.',
          }
        );
        // A token that was sent and did not match is refused with the reason
        // rather than answered with a fresh prompt; the sentence is the
        // library's, so every server refuses in the same words.
        if (outcome.decision === 'rejected') {
          return errorResult(outcome.reason);
        }
        if (outcome.decision === 'declined') {
          return errorResult(`The user declined. delete_tags did nothing.`);
        }
        if (outcome.decision === 'pending') return outcome.result;

        const result = await api.delete('/tags', { tagIds: ids });
        assertNotErrorMessage(result, 'Deleting the tags');
        return textResult(`Deleted ${ids.length} tag(s): ${ids.join(', ')}.`);
      })
  );

  server.registerTool(
    'merge_tags',
    {
      title: 'Merge tags into one',
      description:
        'Folds several tags into a single new one: every link that carried any of the ' +
        'source tags gets the new tag, and the source tags are deleted.\n\n' +
        'Two things to know before calling this. The new tag is created from scratch, ' +
        'so the name must not already be in use by this account — merging into an ' +
        'existing name fails. And the per-tag archival settings of the source tags ' +
        'are not carried over; set them again with create_tags afterwards if they ' +
        'mattered.',
      inputSchema: z.object({
        tag_ids: z
          .array(tagId)
          .min(1)
          .max(MAX_TAGS_PER_CALL)
          .describe('Ids of the tags to merge away'),
        new_name: z
          .string()
          .trim()
          .min(1)
          .max(50)
          .describe('Name of the new tag. Must not exist yet.'),
        confirm_token: confirmToken,
      }),
      annotations: {
        // The originals are deleted and their per-tag archival settings are
        // not carried over. Not idempotent — the sources no longer exist for
        // a second run.
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ tag_ids, new_name, confirm_token }, mcp) =>
      run(async () => {
        const ids = [...new Set(tag_ids)];
        // The target name is part of the key: a confirmation for merging into one
        // name must not be replayable with a different one.
        const resource = setResourceKey(
          `merge_tags:${new_name}`,
          ids.map(String)
        );

        const outcome = await approval.requestApproval(
          server,
          mcp,
          confirmations,
          {
            what: `merge ${ids.length} tag(s) (ids ${ids.join(', ')}) into one new tag, deleting the originals and losing their archival settings`,
            consequence:
              'The original tags are deleted and their per-tag archival ' +
              'settings are not carried over; neither can be restored from here.',
            resourceKey: resource,
            token: confirm_token,
            toolName: 'merge_tags',
            hint: 'Tick to go ahead, leave it to cancel.',
          }
        );
        // A token that was sent and did not match is refused with the reason
        // rather than answered with a fresh prompt; the sentence is the
        // library's, so every server refuses in the same words.
        if (outcome.decision === 'rejected') {
          return errorResult(outcome.reason);
        }
        if (outcome.decision === 'declined') {
          return errorResult(`The user declined. merge_tags did nothing.`);
        }
        if (outcome.decision === 'pending') return outcome.result;

        const result = await api.put('/tags/merge', {
          tagIds: ids,
          newTagName: new_name,
        });
        assertNotErrorMessage(result, 'Merging the tags');
        return jsonResult({
          merged_tag_ids: ids,
          new_tag: shapeTag(result as RawTag),
        });
      })
  );
}
