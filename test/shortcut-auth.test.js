import test from 'node:test';
import assert from 'node:assert/strict';

import { handleWidgetInbox, handleInboxShortcut } from '../src/routes/inbox.js';
import { handleProjectsShortcut, handleProjectsChoices } from '../src/routes/projects.js';
import { handleMove } from '../src/routes/move.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

const baseEnv = { NOTION_TOKEN: 'notion-token', INBOX_DB_ID: 'inbox-db', TASKS_DB_ID: 'tasks-db', PROJECTS_DB_ID: 'projects-db', ACTION_SECRET: 'action-secret', SHORTCUT_TOKEN: 'shortcut-token' };

test('/api/widget/inbox returns 401 without token', async () => {
  const res = await handleWidgetInbox(new Request('https://example.com/api/widget/inbox?limit=5'), baseEnv);
  assert.equal(res.status, 401);
});

test('/api/widget/inbox accepts query token', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => jsonResponse({ results: [{ id: 'i1', properties: { Name: { title: [{ plain_text: 'A' }] }, Created: { date: { start: '2026-01-01' } } } }] });
  try {
    const res = await handleWidgetInbox(new Request('https://example.com/api/widget/inbox?token=shortcut-token'), baseEnv);
    assert.equal(res.status, 200);
  } finally { global.fetch = originalFetch; }
});

test('/api/widget/inbox accepts X-Shortcut-Token header', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => jsonResponse({ results: [] });
  try {
    const req = new Request('https://example.com/api/widget/inbox', { headers: { 'X-Shortcut-Token': 'shortcut-token' } });
    const res = await handleWidgetInbox(req, baseEnv);
    assert.equal(res.status, 200);
  } finally { global.fetch = originalFetch; }
});

test('/api/inbox/shortcut works without token', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => jsonResponse({ results: [] });
  try {
    const env = { ...baseEnv }; delete env.SHORTCUT_TOKEN;
    const res = await handleInboxShortcut(new Request('https://example.com/api/inbox/shortcut'), env);
    assert.equal(res.status, 200);
  } finally { global.fetch = originalFetch; }
});

test('/api/projects/shortcut works without token', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => jsonResponse({ results: [{ id: 'p1', properties: { Name: { type: 'title', title: [{ plain_text: 'Proj' }] } } }] });
  try {
    const env = { ...baseEnv }; delete env.SHORTCUT_TOKEN;
    const res = await handleProjectsShortcut(new Request('https://example.com/api/projects/shortcut'), env);
    assert.equal(res.status, 200);
  } finally { global.fetch = originalFetch; }
});

test('/api/projects/choices works without token', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => jsonResponse({ results: [{ id: 'p1', properties: { Name: { type: 'title', title: [{ plain_text: 'Proj' }] } } }] });
  try {
    const env = { ...baseEnv }; delete env.SHORTCUT_TOKEN;
    const res = await handleProjectsChoices(new Request('https://example.com/api/projects/choices'), env);
    assert.equal(res.status, 200);
  } finally { global.fetch = originalFetch; }
});

test('POST /action/move works without token even when SHORTCUT_TOKEN is set', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    const method = options.method || 'GET'; const u = String(url);
    if (u.endsWith('/v1/pages/inbox-page') && method === 'GET') return jsonResponse({ id:'inbox-page', properties:{ Name:{type:'title', title:[{plain_text:'Inbox'}]}, Processed:{type:'rich_text', rich_text:[]}, 'Processed At':{type:'date', date:null} } });
    if (u.endsWith('/v1/databases/inbox-db')) return jsonResponse({ properties:{ Name:{type:'title'}, Processed:{type:'rich_text'}, 'Processed At':{type:'date'} } });
    if (u.endsWith('/v1/databases/tasks-db')) return jsonResponse({ properties:{ Name:{type:'title'}, Status:{type:'select'}, 'Inbox Page ID':{type:'rich_text'}, 'Triage Source':{type:'select'}, 'Triage At':{type:'date'} } });
    if (u.endsWith('/v1/pages/inbox-page') && method === 'PATCH') return jsonResponse({ok:true});
    if (u.endsWith('/v1/pages') && method === 'POST') return jsonResponse({id:'task-1', properties:{}});
    if (u.includes('/v1/blocks/inbox-page/children') && method === 'GET') return jsonResponse({results:[],has_more:false,next_cursor:null});
    if (u.endsWith('/v1/pages/task-1') && method === 'PATCH') return jsonResponse({ok:true});
    throw new Error(`Unexpected fetch: ${method} ${u}`);
  };
  try {
    const req = new Request('https://example.com/action/move', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ inbox_page_id:'inbox-page', status:'Do' }) });
    const res = await handleMove(req, baseEnv);
    assert.equal(res.status, 200);
  } finally { global.fetch = originalFetch; }
});
