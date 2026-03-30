import { notionFetch } from "./client";

const READ_ONLY_BLOCK_FIELDS = new Set([
  "id",
  "object",
  "created_time",
  "last_edited_time",
  "created_by",
  "last_edited_by",
  "parent",
  "archived",
  "in_trash"
]);

const UNSUPPORTED_BLOCK_TYPES = new Set([
  "child_page",
  "child_database",
  "link_preview",
  "unsupported"
]);

const SUPPORTED_BLOCK_TYPES = new Set([
  "paragraph",
  "heading_1",
  "heading_2",
  "heading_3",
  "bulleted_list_item",
  "numbered_list_item",
  "to_do",
  "toggle",
  "quote",
  "callout",
  "code",
  "divider",
  "equation",
  "table",
  "table_row",
  "bookmark",
  "embed",
  "image",
  "video",
  "file",
  "pdf",
  "audio",
  "column_list",
  "column",
  "synced_block"
]);

export async function listAllBlockChildren(env, blockId) {
  const results = [];
  let cursor = null;

  while (true) {
    const query = new URLSearchParams({ page_size: "100" });
    if (cursor) query.set("start_cursor", cursor);

    const res = await notionFetch(
      `https://api.notion.com/v1/blocks/${blockId}/children?${query.toString()}`,
      env
    );

    if (!res.ok) {
      const bodyText = await res.text().catch(() => "");
      const error = new Error(`Failed to list block children (${blockId})`);
      error.notionStatus = res.status;
      error.notionBody = bodyText;
      throw error;
    }

    const data = await res.json();
    results.push(...(Array.isArray(data?.results) ? data.results : []));

    if (!data?.has_more) break;
    cursor = data?.next_cursor;
    if (!cursor) break;
  }

  return results;
}

export async function cloneWritableBlockTree(env, sourceBlock) {
  const blockType = sourceBlock?.type;
  if (!blockType) return { writableBlock: null, skippedType: "unknown" };
  if (UNSUPPORTED_BLOCK_TYPES.has(blockType) || !SUPPORTED_BLOCK_TYPES.has(blockType)) {
    return { writableBlock: null, skippedType: blockType };
  }

  const typePayload = sanitizeTypePayload(sourceBlock[blockType]);
  const writableBlock = {
    type: blockType,
    [blockType]: typePayload
  };

  if (blockType === "table") {
    const rows = await listAllBlockChildren(env, sourceBlock.id);
    writableBlock.table.children = rows
      .filter((row) => row?.type === "table_row")
      .map((row) => ({
        type: "table_row",
        table_row: sanitizeTypePayload(row.table_row)
      }));
  }

  return { writableBlock, skippedType: null };
}

export async function appendBlocksInBatches(env, parentBlockId, blocks) {
  const createdResults = [];
  let batchCount = 0;

  for (let i = 0; i < blocks.length; i += 100) {
    const chunk = blocks.slice(i, i + 100);
    const res = await notionFetch(
      `https://api.notion.com/v1/blocks/${parentBlockId}/children`,
      env,
      {
        method: "PATCH",
        body: JSON.stringify({ children: chunk })
      }
    );

    if (!res.ok) {
      const bodyText = await res.text().catch(() => "");
      const error = new Error(`Failed to append blocks to ${parentBlockId}`);
      error.notionStatus = res.status;
      error.notionBody = bodyText;
      error.failedBatchIndex = batchCount;
      error.failedBlockTypes = chunk.map((block) => block?.type || "unknown");
      throw error;
    }

    const data = await res.json();
    createdResults.push(...(Array.isArray(data?.results) ? data.results : []));
    batchCount += 1;
  }

  return { createdResults, batchCount };
}

export async function copyPageBody(env, sourcePageId, targetPageId) {
  const summary = {
    sourceTopLevelCount: 0,
    appendedCount: 0,
    skippedCount: 0,
    skippedTypes: [],
    batchCount: 0
  };

  const skippedTypeCounter = new Map();
  const topLevelBlocks = await listAllBlockChildren(env, sourcePageId);
  summary.sourceTopLevelCount = topLevelBlocks.length;

  await copyBlockLevel({
    env,
    sourceBlocks: topLevelBlocks,
    targetParentId: targetPageId,
    summary,
    skippedTypeCounter
  });

  summary.skippedTypes = Array.from(skippedTypeCounter.entries()).map(([type, count]) => ({
    type,
    count
  }));

  return summary;
}

async function copyBlockLevel({ env, sourceBlocks, targetParentId, summary, skippedTypeCounter }) {
  const appendPayloads = [];
  const payloadMeta = [];
  const promotedChildren = [];

  for (const sourceBlock of sourceBlocks) {
    const blockType = sourceBlock?.type || "unknown";
    const { writableBlock, skippedType } = await cloneWritableBlockTree(env, sourceBlock);

    if (!writableBlock) {
      summary.skippedCount += 1;
      skippedTypeCounter.set(skippedType || blockType, (skippedTypeCounter.get(skippedType || blockType) || 0) + 1);

      if (sourceBlock?.has_children) {
        const children = await listAllBlockChildren(env, sourceBlock.id);
        promotedChildren.push(...children);
      }
      continue;
    }

    appendPayloads.push(writableBlock);
    payloadMeta.push({
      sourceId: sourceBlock.id,
      blockType,
      hasChildren: Boolean(sourceBlock?.has_children && blockType !== "table")
    });
  }

  if (appendPayloads.length > 0) {
    const { createdResults, batchCount } = await appendBlocksInBatches(env, targetParentId, appendPayloads);
    summary.batchCount += batchCount;
    summary.appendedCount += createdResults.length;

    for (let i = 0; i < createdResults.length; i += 1) {
      const created = createdResults[i];
      const meta = payloadMeta[i];
      if (!meta?.hasChildren || !meta?.sourceId || !created?.id) continue;

      const childBlocks = await listAllBlockChildren(env, meta.sourceId);
      if (childBlocks.length === 0) continue;

      await copyBlockLevel({
        env,
        sourceBlocks: childBlocks,
        targetParentId: created.id,
        summary,
        skippedTypeCounter
      });
    }
  }

  if (promotedChildren.length > 0) {
    await copyBlockLevel({
      env,
      sourceBlocks: promotedChildren,
      targetParentId,
      summary,
      skippedTypeCounter
    });
  }
}

function sanitizeTypePayload(typePayload) {
  if (!typePayload || typeof typePayload !== "object") return {};
  const cloned = JSON.parse(JSON.stringify(typePayload));

  for (const key of Object.keys(cloned)) {
    if (READ_ONLY_BLOCK_FIELDS.has(key)) {
      delete cloned[key];
      continue;
    }
    if (key === "children") {
      delete cloned[key];
      continue;
    }
  }

  return cloned;
}
