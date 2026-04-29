import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchWidgetInbox } from '../src/notion/inbox.js';

const env = { NOTION_TOKEN: 'secret', INBOX_DB_ID: 'inbox-db' };

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

test('fetchWidgetInbox returns count and items, and fills empty title as 無題', async () => {
  const originalFetch = global.fetch;
  const pageSizes = [];
  global.fetch = async (_url, options = {}) => {
    const body = JSON.parse(options.body);
    pageSizes.push(body.page_size);
    if (body.page_size === 100) return jsonResponse({ results: [{ id: '1' }, { id: '2' }] });
    return jsonResponse({
      results: [
        { id: '1', properties: { Name: { title: [] } }, url: 'https://notion.so/1', created_time: '2026-04-30T00:00:00.000Z' }
      ]
    });
  };
  try {
    const result = await fetchWidgetInbox(env, 5);
    assert.equal(result.count, 2);
    assert.equal(result.items[0].title, '無題');
    assert.deepEqual(pageSizes, [100, 5]);
  } finally {
    global.fetch = originalFetch;
  }
});

test('fetchWidgetInbox throws on notion API error', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response('err', { status: 500 });
  try {
    await assert.rejects(() => fetchWidgetInbox(env, 5), /Failed to fetch widget inbox/);
  } finally {
    global.fetch = originalFetch;
  }
});
