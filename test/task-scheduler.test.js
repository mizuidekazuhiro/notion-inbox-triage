import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIcs, buildSchedulerUid, isSchedulerTarget, resolveEventWindow } from '../src/utils/taskScheduler.js';
import { TASK_SCHEDULER_DEFAULTS, buildStatusDoneFilter, fetchAllTasks } from '../src/utils/taskSchedulerConfig.js';
import fs from 'node:fs';

test('default TASK_EVENT_DATE_PROP_NAME is Event Date', () => {
  assert.equal(TASK_SCHEDULER_DEFAULTS.TASK_EVENT_DATE_PROP_NAME, 'Event Date');
  assert.notEqual(TASK_SCHEDULER_DEFAULTS.TASK_EVENT_DATE_PROP_NAME, 'Event date');
});

test('UID generation is deterministic', () => {
  assert.equal(buildSchedulerUid('p', '2026-05-08T01:00:00.000Z'), buildSchedulerUid('p', '2026-05-08T01:00:00.000Z'));
  assert.notEqual(buildSchedulerUid('p', '2026-05-08T01:00:00.000Z'), buildSchedulerUid('p', '2026-05-08T02:00:00.000Z'));
});

test('resolveEventWindow uses end when present, otherwise default duration', () => {
  assert.equal(resolveEventWindow({ notionDate: { start: '2026-05-08T00:00:00.000Z', end: '2026-05-08T03:00:00.000Z' }, defaultDurationMin: 180 }).end, '2026-05-08T03:00:00.000Z');
  assert.equal(resolveEventWindow({ notionDate: { start: '2026-05-08T00:00:00.000Z' }, defaultDurationMin: 180 }).end, '2026-05-08T03:00:00.000Z');
});

test('isSchedulerTarget uses Event Date and passes on valid future done task', () => {
  const page = { properties: { Status: { status: { name: 'Done' } }, 'Event Date': { date: { start: '2026-05-08T00:00:00.000Z' } }, 'Send Scheduler': { checkbox: true }, 'Scheduler Sent At': { date: null } } };
  const props = { status: 'Status', eventDate: 'Event Date', sendScheduler: 'Send Scheduler', sentAt: 'Scheduler Sent At' };
  assert.equal(isSchedulerTarget({ page, props, doneValue: 'Done', now: new Date('2026-05-07T00:00:00.000Z') }).ok, true);
});

test('.ics generation has required sections and DTSTAMP format', () => {
  const ics = buildIcs({ uid: 'uid', summary: 'title', description: 'desc', startIso: '2026-05-08T00:00:00.000Z', endIso: '2026-05-08T03:00:00.000Z' });
  for (const token of ['BEGIN:VCALENDAR', 'METHOD:REQUEST', 'BEGIN:VEVENT', 'UID:uid', 'DTSTART:', 'DTEND:', 'SUMMARY:title']) assert.match(ics, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const dtstamp = ics.split('\r\n').find((line) => line.startsWith('DTSTAMP:'));
  assert.ok(dtstamp?.endsWith('Z'));
  assert.equal(dtstamp?.endsWith('ZZ'), false);
});

test('buildStatusDoneFilter uses select filter', () => {
  assert.deepEqual(buildStatusDoneFilter({ statusPropName: 'Status', statusPropType: 'select', doneValue: 'Done' }), { property: 'Status', select: { equals: 'Done' } });
});

test('buildStatusDoneFilter uses status filter', () => {
  assert.deepEqual(buildStatusDoneFilter({ statusPropName: 'Status', statusPropType: 'status', doneValue: 'Done' }), { property: 'Status', status: { equals: 'Done' } });
});

test('buildStatusDoneFilter rejects unsupported type', () => {
  assert.throws(() => buildStatusDoneFilter({ statusPropName: 'Status', statusPropType: 'rich_text', doneValue: 'Done' }), /Unsupported Status property type/);
});

test('pagination fetches all pages', async () => {
  const calls = [];
  const queryFn = async (q) => { calls.push(q); return calls.length === 1 ? { results: [{ id: '1' }], has_more: true, next_cursor: 'c1' } : { results: [{ id: '2' }], has_more: false, next_cursor: null }; };
  const all = await fetchAllTasks({ queryFn, databaseId: 'db', statusPropName: 'Status', statusPropType: 'select', doneValue: 'Done' });
  assert.equal(all.length, 2);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].filter, { property: 'Status', select: { equals: 'Done' } });
});

test('README does not contain Event date string', () => {
  const readme = fs.readFileSync('README.md', 'utf-8');
  assert.equal(readme.includes('Event date'), false);
});
