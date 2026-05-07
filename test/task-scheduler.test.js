import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIcs, buildSchedulerUid, isSchedulerTarget, resolveEventWindow } from '../src/utils/taskScheduler.js';

test('UID generation is deterministic', () => {
  const a = buildSchedulerUid('page1', '2026-05-08T01:00:00.000Z');
  const b = buildSchedulerUid('page1', '2026-05-08T01:00:00.000Z');
  const c = buildSchedulerUid('page1', '2026-05-08T02:00:00.000Z');
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test('resolveEventWindow uses end when present, otherwise default duration', () => {
  const withEnd = resolveEventWindow({ notionDate: { start: '2026-05-08T00:00:00.000Z', end: '2026-05-08T03:00:00.000Z' }, defaultDurationMin: 180 });
  assert.equal(withEnd.end, '2026-05-08T03:00:00.000Z');

  const noEnd = resolveEventWindow({ notionDate: { start: '2026-05-08T00:00:00.000Z' }, defaultDurationMin: 180 });
  assert.equal(noEnd.end, '2026-05-08T03:00:00.000Z');

  const noEnd90 = resolveEventWindow({ notionDate: { start: '2026-05-08T00:00:00.000Z' }, defaultDurationMin: 90 });
  assert.equal(noEnd90.end, '2026-05-08T01:30:00.000Z');
});

test('isSchedulerTarget filters correctly', () => {
  const now = new Date('2026-05-07T00:00:00.000Z');
  const props = { status: 'Status', eventDate: 'Event date', sendScheduler: 'Send Scheduler', sentAt: 'Scheduler Sent At' };
  const base = { properties: { Status: { status: { name: 'Done' } }, 'Event date': { date: { start: '2026-05-08T00:00:00.000Z' } }, 'Send Scheduler': { checkbox: true }, 'Scheduler Sent At': { date: null } } };
  assert.equal(isSchedulerTarget({ page: base, props, doneValue: 'Done', now }).ok, true);
  assert.equal(isSchedulerTarget({ page: { properties: { ...base.properties, 'Scheduler Sent At': { date: { start: '2026-05-07T01:00:00.000Z' } } } }, props, doneValue: 'Done', now }).ok, false);
  assert.equal(isSchedulerTarget({ page: { properties: { ...base.properties, 'Send Scheduler': { checkbox: false } } }, props, doneValue: 'Done', now }).ok, false);
  assert.equal(isSchedulerTarget({ page: { properties: { ...base.properties, 'Event date': { date: { start: '2026-05-06T00:00:00.000Z' } } } }, props, doneValue: 'Done', now }).ok, false);
  assert.equal(isSchedulerTarget({ page: { properties: { ...base.properties, Status: { status: { name: 'Do' } } } }, props, doneValue: 'Done', now }).ok, false);
});

test('.ics generation has required sections', () => {
  const ics = buildIcs({ uid: 'uid', summary: 'title', description: 'desc', startIso: '2026-05-08T00:00:00.000Z', endIso: '2026-05-08T03:00:00.000Z' });
  for (const token of ['BEGIN:VCALENDAR','METHOD:REQUEST','BEGIN:VEVENT','UID:uid','DTSTART:','DTEND:','SUMMARY:title']) {
    assert.match(ics, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});
