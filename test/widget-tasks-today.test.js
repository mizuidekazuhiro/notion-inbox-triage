import test from 'node:test';
import assert from 'node:assert/strict';

import { handleWidgetTasksToday, parseWidgetLimit, sortByDueDateAsc, isWaitingDue } from '../src/routes/widgetTasks.js';

function req(url, token) {
  return new Request(url, { headers: token ? { 'X-Shortcut-Token': token } : {} });
}

test('limit default is 10', () => {
  assert.equal(parseWidgetLimit(req('https://x/api/widget/tasks/today')), 10);
});

test('limit cap is 50', () => {
  assert.equal(parseWidgetLimit(req('https://x/api/widget/tasks/today?limit=999')), 50);
});

test('shortcut token missing returns 500', async () => {
  const res = await handleWidgetTasksToday(req('https://x/api/widget/tasks/today', 'a'), {});
  assert.equal(res.status, 500);
});

test('token mismatch returns 401', async () => {
  const res = await handleWidgetTasksToday(req('https://x/api/widget/tasks/today', 'bad'), { SHORTCUT_TOKEN: 'ok' });
  assert.equal(res.status, 401);
});

test('isWaitingDue matches reminder <= today OR waiting since >=3days only', () => {
  const today = new Date('2026-05-10T00:00:00.000Z');
  assert.equal(isWaitingDue({ reminderDateISO: '2026-05-10', waitingSinceISO: null }, today), true);
  assert.equal(isWaitingDue({ reminderDateISO: '2026-05-11', waitingSinceISO: '2026-05-01' }, today), false);
  assert.equal(isWaitingDue({ reminderDateISO: null, waitingSinceISO: '2026-05-07' }, today), true);
  assert.equal(isWaitingDue({ reminderDateISO: null, waitingSinceISO: '2026-05-08' }, today), false);
});

test('sortByDueDateAsc pushes null due_date to end', () => {
  const sorted = sortByDueDateAsc([
    { id: '3', dueDateISO: null },
    { id: '2', dueDateISO: '2026-05-12' },
    { id: '1', dueDateISO: '2026-05-11' }
  ]);
  assert.deepEqual(sorted.map((x) => x.id), ['1', '2', '3']);
});

test('success returns ok,count,items and includes Do + eligible Waiting', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({
    results: [
      { id: 'do', url: 'https://notion.so/do', properties: { '名前': { title: [{ plain_text: 'Do task' }] }, Status: { select: { name: 'Do' } }, Priority: { select: { name: 'High' } }, 'Due Date': { date: { start: '2026-05-10' } }, Summary: { rich_text: [{ plain_text: 's1' }] }, 'My Tasks': { rich_text: [{ plain_text: 'm1' }] }, 'Other Tasks': { rich_text: [{ plain_text: 'o1' }] } } },
      { id: 'w-ok', url: 'https://notion.so/w-ok', properties: { '名前': { title: [{ plain_text: 'Wait due' }] }, Status: { select: { name: 'Waiting' } }, Priority: { select: { name: 'Low' } }, 'Due Date': { date: { start: '2026-05-09' } }, 'Reminder Date': { date: { start: '2026-05-01' } } } },
      { id: 'w-ng', url: 'https://notion.so/w-ng', properties: { '名前': { title: [{ plain_text: 'Wait future' }] }, Status: { select: { name: 'Waiting' } }, 'Reminder Date': { date: { start: '2999-01-01' } } } }
    ]
  }), { status: 200 });

  const realDate = Date;
  global.Date = class extends Date {
    constructor(v) { super(v ?? '2026-05-10T00:00:00.000Z'); }
    static now() { return new realDate('2026-05-10T00:00:00.000Z').getTime(); }
  };

  try {
    const res = await handleWidgetTasksToday(req('https://x/api/widget/tasks/today?limit=10', 'token'), { SHORTCUT_TOKEN: 'token', TASKS_DB_ID: 'db', NOTION_TOKEN: 'n' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.count, 2);
    assert.deepEqual(body.items.map((x) => x.id), ['w-ok', 'do']);
  } finally {
    global.fetch = originalFetch;
    global.Date = realDate;
  }
});
