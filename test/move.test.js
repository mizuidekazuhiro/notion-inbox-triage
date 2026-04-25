import test from 'node:test';
import assert from 'node:assert/strict';

import { handleMoveChoose, handleMoveCore } from '../src/routes/move.js';
import { createMoveChooseSignature } from '../src/utils/signature.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function textResponse(text, status = 200) {
  return new Response(text, { status, headers: { 'Content-Type': 'text/plain' } });
}

const env = {
  NOTION_TOKEN: 'secret',
  INBOX_DB_ID: 'inbox-db',
  TASKS_DB_ID: 'tasks-db',
  ACTION_SECRET: 'action-secret'
};

const basePage = {
  id: 'inbox-page',
  properties: {
    Title: { type: 'title', title: [{ type: 'text', text: { content: 'Inbox item' } }] },
    Processed: { type: 'rich_text', rich_text: [{ type: 'text', plain_text: 'processing...', text: { content: 'processing...' } }] },
    'Processed At': { type: 'date', date: null }
  }
};

const inboxSchema = {
  properties: {
    Title: { type: 'title' },
    Processed: { type: 'rich_text' },
    'Processed At': { type: 'date' },
    'Error Message': { type: 'rich_text' }
  }
};

const tasksSchema = {
  properties: {
    Title: { type: 'title' },
    Status: { type: 'select' },
    'Triage Source': { type: 'select' },
    'Triage At': { type: 'date' },
    'Inbox Page ID': { type: 'rich_text' }
  }
};

test('handleMoveCore rolls back Processed/Processed At and writes Error Message when copyPageBody fails', async () => {
  const calls = [];
  const originalFetch = global.fetch;

  global.fetch = async (url, options = {}) => {
    const method = options.method || 'GET';
    const urlString = String(url);
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ url: urlString, method, body });

    if (urlString.endsWith('/v1/pages/inbox-page') && method === 'GET') return jsonResponse(basePage);
    if (urlString.endsWith('/v1/databases/inbox-db')) return jsonResponse(inboxSchema);
    if (urlString.endsWith('/v1/databases/tasks-db')) return jsonResponse(tasksSchema);
    if (urlString.endsWith('/v1/pages/inbox-page') && method === 'PATCH') return jsonResponse({ ok: true });
    if (urlString.endsWith('/v1/pages') && method === 'POST') return jsonResponse({ id: 'task-1', properties: {} });
    if (urlString.includes('/v1/blocks/inbox-page/children') && method === 'GET') {
      return jsonResponse({ results: [{ id: 'block-1', type: 'paragraph', paragraph: { rich_text: [] } }], has_more: false, next_cursor: null });
    }
    if (urlString.includes('/v1/blocks/task-1/children') && method === 'PATCH') {
      return textResponse('validation_error: paragraph.icon should be object or undefined', 400);
    }
    if (urlString.endsWith('/v1/pages/task-1') && method === 'PATCH') return jsonResponse({ id: 'task-1', archived: true });

    throw new Error(`Unexpected fetch: ${method} ${urlString}`);
  };

  try {
    const res = await handleMoveCore({
      env,
      pageId: 'inbox-page',
      status: 'Do',
      baseUrl: 'https://example.com'
    });

    assert.equal(res.status, 500);

    const rollbackCall = calls.find((call) =>
      call.method === 'PATCH' &&
      call.url.endsWith('/v1/pages/inbox-page') &&
      call.body?.properties?.['Processed At']?.date === null
    );

    assert.ok(rollbackCall, 'expected rollback PATCH to inbox page');
    assert.deepEqual(rollbackCall.body.properties.Processed, { rich_text: [] });
    assert.equal(
      rollbackCall.body.properties['Error Message']?.rich_text?.[0]?.text?.content,
      'validation_error: paragraph.icon should be object or undefined'
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('handleMoveCore does not treat processing... with empty Processed At as Already processed', async () => {
  const calls = [];
  const originalFetch = global.fetch;

  global.fetch = async (url, options = {}) => {
    const method = options.method || 'GET';
    const urlString = String(url);
    calls.push({ url: urlString, method, body: options.body ? JSON.parse(options.body) : null });

    if (urlString.endsWith('/v1/pages/inbox-page') && method === 'GET') return jsonResponse(basePage);
    if (urlString.endsWith('/v1/databases/inbox-db')) return jsonResponse(inboxSchema);
    if (urlString.endsWith('/v1/databases/tasks-db')) return jsonResponse(tasksSchema);
    if (urlString.endsWith('/v1/pages/inbox-page') && method === 'PATCH') return jsonResponse({ ok: true });
    if (urlString.endsWith('/v1/pages') && method === 'POST') return jsonResponse({ id: 'task-2', properties: {} });
    if (urlString.includes('/v1/blocks/inbox-page/children') && method === 'GET') {
      return jsonResponse({ results: [], has_more: false, next_cursor: null });
    }

    throw new Error(`Unexpected fetch: ${method} ${urlString}`);
  };

  try {
    const res = await handleMoveCore({
      env,
      pageId: 'inbox-page',
      status: 'Do',
      baseUrl: 'https://example.com'
    });

    assert.equal(res.status, 200);
    assert.ok(
      calls.some((call) => call.method === 'POST' && call.url.endsWith('/v1/pages')),
      'expected task creation request when retrying processing... state'
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('GET /move/choose returns status chooser for valid signature without moving', async () => {
  const sig = await createMoveChooseSignature(env.ACTION_SECRET, 'inbox-page');
  const request = new Request(`https://example.com/move/choose?inbox_page_id=inbox-page&sig=${sig}`);

  const originalFetch = global.fetch;
  let fetchCalled = false;
  global.fetch = async () => {
    fetchCalled = true;
    throw new Error('fetch should not be called on chooser GET');
  };

  try {
    const res = await handleMoveChoose(request, env);
    const html = await res.text();

    assert.equal(res.status, 200);
    assert.equal(fetchCalled, false);
    assert.match(html, /Do/);
    assert.match(html, /Waiting/);
    assert.match(html, /Someday/);
    assert.match(html, /Thinking/);
    assert.match(html, /Done/);
    assert.match(html, /Drop/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('GET /move/choose returns 403 for invalid signature', async () => {
  const request = new Request('https://example.com/move/choose?inbox_page_id=inbox-page&sig=invalid');
  const res = await handleMoveChoose(request, env);
  assert.equal(res.status, 403);
});

test('POST /move/choose forwards selected status to handleMoveCore flow for all allowed statuses', async () => {
  const originalFetch = global.fetch;
  const seenStatuses = [];

  global.fetch = async (url, options = {}) => {
    const method = options.method || 'GET';
    const urlString = String(url);
    const body = options.body ? JSON.parse(options.body) : null;

    if (urlString.endsWith('/v1/pages/inbox-page') && method === 'GET') return jsonResponse(basePage);
    if (urlString.endsWith('/v1/databases/inbox-db')) return jsonResponse(inboxSchema);
    if (urlString.endsWith('/v1/databases/tasks-db')) return jsonResponse(tasksSchema);
    if (urlString.endsWith('/v1/pages/inbox-page') && method === 'PATCH') return jsonResponse({ ok: true });
    if (urlString.endsWith('/v1/pages') && method === 'POST') {
      seenStatuses.push(body?.properties?.Status?.select?.name);
      return jsonResponse({ id: `task-${seenStatuses.length}`, properties: {} });
    }
    if (urlString.includes('/v1/blocks/inbox-page/children') && method === 'GET') {
      return jsonResponse({ results: [], has_more: false, next_cursor: null });
    }
    if (urlString.includes('/v1/pages/task-') && method === 'PATCH') return jsonResponse({ ok: true });

    throw new Error(`Unexpected fetch: ${method} ${urlString}`);
  };

  try {
    const statuses = ['Do', 'Waiting', 'Someday', 'Thinking', 'Done', 'Drop'];
    for (const status of statuses) {
      const sig = await createMoveChooseSignature(env.ACTION_SECRET, 'inbox-page');
      const body = new URLSearchParams({
        inbox_page_id: 'inbox-page',
        status,
        sig
      });
      const req = new Request('https://example.com/move/choose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body
      });
      const res = await handleMoveChoose(req, env);
      assert.equal(res.status, 200);
    }

    assert.deepEqual(seenStatuses, statuses);
  } finally {
    global.fetch = originalFetch;
  }
});
