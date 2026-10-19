import test from 'node:test';
import assert from 'node:assert/strict';
import { gmailSmtpOptions, smtpFailure } from '../src/utils/gmailSmtp.js';
import { verifyGmail } from '../scripts/verify_gmail_smtp.mjs';
import { sendDigest } from '../scripts/send_digest_smtp.mjs';
import { processPage, runSchedulerBatch, assertSchedulerSucceeded } from '../scripts/send_task_event_scheduler.mjs';
import { buildIcs, resolveEventWindow } from '../src/utils/taskScheduler.js';
import { selectUpcomingEvents } from '../src/routes/widgetScheduleWeek.js';

const props = { status: 'Status', eventDate: 'Event Date', sendScheduler: 'Send Scheduler', sentAt: 'Scheduler Sent At', uid: 'Scheduler UID', error: 'Scheduler Error' };
const now = new Date('2026-10-20T01:00:00+09:00');
const lookahead = new Date('2027-10-20T01:00:00+09:00');
const authError = () => Object.assign(new Error('raw-secret-should-never-be-logged'), { code: 'EAUTH', responseCode: 535 });
const page = (id = 'event', extra = {}) => ({
  id, url: `https://notion.so/${id}`,
  properties: {
    '名前': { type: 'title', title: [{ plain_text: 'Test event' }] },
    Status: { select: { name: 'Done' } },
    'Event Date': { date: { start: '2026-10-22T18:00:00+09:00' } },
    'Send Scheduler': { checkbox: false }, 'Scheduler Sent At': { date: null },
    'Scheduler UID': { rich_text: [{ plain_text: 'previous-uid' }] },
    'Scheduler Error': { rich_text: [{ plain_text: 'Invalid login: 535-5.7.8' }] },
    ...extra
  }
});
function setup(tasks = [page()]) {
  const updates = [], messages = [], verifications = [];
  const options = { tasks, now, lookahead, durationMin: 180, props, doneValue: 'Done',
    notion: { pages: { update: async data => { updates.push(data); } } },
    transporter: { verify: async () => { verifications.push(true); }, sendMail: async data => { messages.push(data); return { accepted: ['test@example.com'] }; } },
    mail: { from: 'sender@example.com', to: 'test@example.com' }
  };
  return { options, updates, messages, verifications };
}

test('Gmail config normalizes copied spaces and requires TLS without relaxing certificate checks', () => {
  const config = gmailSmtpOptions({ GMAIL_USER: ' sender@example.com\n', GMAIL_APP_PASSWORD: 'abcd efgh ijkl mnop\n' });
  assert.deepEqual(config.auth, { user: 'sender@example.com', pass: 'abcdefghijklmnop' });
  assert.equal(config.requireTLS, true);
  assert.equal(config.secure, false);
  assert.equal(config.tls?.rejectUnauthorized, undefined);
  assert.throws(() => gmailSmtpOptions({ GMAIL_USER: ' ', GMAIL_APP_PASSWORD: 'x' }), /GMAIL_USER is required/);
  assert.throws(() => gmailSmtpOptions({ GMAIL_USER: 'sender@example.com', GMAIL_APP_PASSWORD: ' ' }), /GMAIL_APP_PASSWORD is required/);
});

test('SMTP error categories never expose raw response or credentials', () => {
  const failure = smtpFailure(authError());
  assert.equal(failure.reason, 'smtp_auth_failed');
  assert.equal(JSON.stringify(failure).includes('raw-secret'), false);
  assert.equal(smtpFailure({ responseCode: 535 }).reason, 'smtp_auth_failed');
  assert.equal(smtpFailure({ code: 'ECONNECTION', message: 'raw-secret' }).reason, 'smtp_send_failed');
});

test('verify-only checks AUTH, closes connection and sends no email', async () => {
  let verified = 0, closed = 0, sent = 0;
  const result = await verifyGmail({
    env: { GMAIL_USER: 'sender@example.com', GMAIL_APP_PASSWORD: 'test-password' },
    createTransport: () => ({ verify: async () => { verified++; }, close: () => { closed++; }, sendMail: () => { sent++; } })
  });
  assert.deepEqual(result, { action: 'smtp_verify_ok', emailSent: false, notionUpdated: false });
  assert.equal(verified, 1); assert.equal(closed, 1); assert.equal(sent, 0);
});

test('verify-only failure closes connection and exposes only actionable safe error', async () => {
  let closed = 0;
  await assert.rejects(verifyGmail({
    env: { GMAIL_USER: 'sender@example.com', GMAIL_APP_PASSWORD: 'test-password' },
    createTransport: () => ({ verify: async () => { throw authError(); }, close: () => { closed++; } })
  }), error => error.message.includes('smtp_auth_failed') && !error.message.includes('raw-secret'));
  assert.equal(closed, 1);
});

test('batch preflight authentication failure performs zero Notion writes and zero sends', async () => {
  const { options, updates, messages } = setup([page('a'), page('b')]);
  const before = structuredClone(options.tasks);
  options.transporter.verify = async () => { throw authError(); };
  await assert.rejects(runSchedulerBatch(options), /smtp_auth_failed/);
  assert.deepEqual(updates, []); assert.deepEqual(messages, []);
  assert.deepEqual(options.tasks, before);
});

test('a non-auth preflight failure is safe and cannot trigger sends', async () => {
  const { options, updates, messages } = setup();
  options.transporter.verify = async () => { throw new Error('raw-secret'); };
  await assert.rejects(runSchedulerBatch(options), /smtp_send_failed/);
  assert.equal(updates.length + messages.length, 0);
});

test('stale auth errors remain retryable after credentials recover and clear only on success', async () => {
  const { options, updates, messages, verifications } = setup();
  const summary = await runSchedulerBatch(options);
  assert.equal(verifications.length, 1); assert.equal(messages.length, 1);
  assert.equal(summary.sent, 1); assert.equal(summary.failed, 0);
  assert.equal(updates[0].properties[props.error].rich_text[0].text.content, 'sending');
  const final = updates.at(-1).properties;
  assert.equal(final[props.sendScheduler].checkbox, true);
  assert.ok(final[props.sentAt].date.start);
  assert.deepEqual(final[props.error], { rich_text: [] });
  assert.equal(Object.hasOwn(final, 'Event Date'), false);
  assert.equal(Object.hasOwn(final, 'Status'), false);
  assert.doesNotThrow(() => assertSchedulerSucceeded(summary));
});

test('auth failure during sending stops batch, never marks sent and reports failure', async () => {
  const { options, updates } = setup([page('a'), page('b')]);
  let calls = 0;
  options.transporter.sendMail = async () => { calls++; throw authError(); };
  const summary = await runSchedulerBatch(options);
  assert.equal(calls, 1); assert.equal(summary.checkedTotal, 1);
  assert.equal(summary.failed, 1); assert.equal(summary.sent, 0);
  assert.equal(summary.skippedByReason.smtp_auth_failed, 1);
  assert.throws(() => assertSchedulerSucceeded(summary), /scheduler_failed/);
  for (const update of updates) {
    assert.equal(Object.hasOwn(update.properties, props.sendScheduler), false);
    assert.equal(Object.hasOwn(update.properties, props.sentAt), false);
    assert.equal(JSON.stringify(update).includes('raw-secret'), false);
  }
});

test('ordinary SMTP failure leaves sent fields untouched and fails the job summary', async () => {
  const { options, updates } = setup();
  options.transporter.sendMail = async () => { throw new Error('raw-secret'); };
  const summary = await runSchedulerBatch(options);
  assert.equal(summary.failed, 1);
  assert.equal(summary.skippedByReason.smtp_send_failed, 1);
  assert.throws(() => assertSchedulerSucceeded(summary));
  assert.ok(updates.every(u => !u.properties[props.sendScheduler] && !u.properties[props.sentAt]));
});

test('sent, uncertain, past, task-only and non-Done records remain untouched', async () => {
  const tasks = [
    page('sent-checkbox', { [props.sendScheduler]: { checkbox: true } }),
    page('sent-date', { [props.sentAt]: { date: { start: '2026-10-19T01:00:00Z' } } }),
    ...['sending', 'email_sent_but_notion_update_failed: review', 'possible_already_sent'].map(marker => page(marker, { [props.error]: { rich_text: [{ plain_text: marker }] } })),
    page('past', { [props.eventDate]: { date: { start: '2026-10-01' } } }),
    page('task', { [props.eventDate]: { date: null } }),
    page('do', { Status: { select: { name: 'Do' } } }),
    page('beyond', { [props.eventDate]: { date: { start: '2028-01-01' } } })
  ];
  const { options, updates, messages, verifications } = setup(tasks);
  const before = structuredClone(tasks);
  const summary = await runSchedulerBatch(options);
  assert.equal(summary.sent + summary.failed, 0);
  assert.equal(verifications.length + updates.length + messages.length, 0);
  assert.deepEqual(tasks, before);
});

test('if the sending marker cannot be written, no SMTP delivery is attempted', async () => {
  const { options, messages } = setup();
  options.notion.pages.update = async () => { throw new Error('notion unavailable'); };
  await assert.rejects(processPage({ page: page(), ...options }), /notion unavailable/);
  assert.equal(messages.length, 0);
});

test('email delivered but final Notion update failed is blocked against automatic duplicate send', async () => {
  const { options, updates, messages } = setup();
  options.notion.pages.update = async data => {
    updates.push(data);
    if (data.properties[props.sendScheduler]) throw new Error('raw-secret');
  };
  const summary = await runSchedulerBatch(options);
  assert.equal(messages.length, 1);
  assert.equal(summary.failed, 1);
  assert.equal(summary.skippedByReason.possible_already_sent, 1);
  assert.throws(() => assertSchedulerSucceeded(summary));
  const marker = updates.at(-1).properties;
  assert.match(marker[props.error].rich_text[0].text.content, /^email_sent_but_notion_update_failed/);
  const uncertain = page('event', marker);
  // Simulate Notion readback, which supplies plain_text for rich text.
  for (const name of [props.uid, props.error]) {
    for (const text of uncertain.properties[name].rich_text) text.plain_text = text.text.content;
  }
  const retry = setup([uncertain]);
  await runSchedulerBatch(retry.options);
  assert.equal(retry.messages.length, 0);
});

test('multi-day Notion range becomes an inclusive all-day calendar range', () => {
  const event = resolveEventWindow({ notionDate: { start: '2026-10-27', end: '2026-10-31' } });
  assert.equal(event.start, '2026-10-27T00:00:00+09:00');
  assert.equal(event.end, '2026-11-01T00:00:00+09:00');
  const ics = buildIcs({ uid: 'test', summary: 'Trip', startIso: event.start, endIso: event.end, allDay: event.allDay });
  assert.match(ics, /DTSTART;VALUE=DATE:20261027\r\nDTEND;VALUE=DATE:20261101/);
});

test('single-date fallback and explicit timed events retain existing behavior', () => {
  assert.equal(resolveEventWindow({ notionDate: { start: '2026-10-22' } }).start, '2026-10-22T09:00:00+09:00');
  const event = resolveEventWindow({ notionDate: { start: '2026-10-22T18:00:00+09:00' } });
  const ics = buildIcs({ uid: 'test', startIso: event.start, endIso: event.end, allDay: event.allDay });
  assert.match(ics, /DTSTART:20261022T090000Z/);
  assert.match(ics, /DTEND:20261022T120000Z/);
});

test('sending a multi-day event passes all-day range into attached ICS', async () => {
  const { options, messages } = setup([page('trip', { [props.eventDate]: { date: { start: '2026-10-27', end: '2026-10-31' } } })]);
  await runSchedulerBatch(options);
  assert.match(messages[0].attachments[0].content, /DTEND;VALUE=DATE:20261101/);
});

test('SMTP error flags have no effect on schedule widget; the seven-day boundary still applies', () => {
  const tasks = [page('near'), page('later', { [props.eventDate]: { date: { start: '2026-10-27', end: '2026-10-31' } } })];
  const until = Date.parse('2026-10-27T00:00:00+09:00');
  assert.deepEqual(selectUpcomingEvents(tasks, now.getTime(), until).map(x => x.id), ['near']);
  assert.deepEqual(selectUpcomingEvents(tasks, Date.parse('2026-10-21T00:00:00+09:00'), Date.parse('2026-10-28T00:00:00+09:00')).map(x => x.id), ['near', 'later']);
});

test('digest uses shared Gmail config and closes transport after delivery', async () => {
  let closed = 0;
  const result = await sendDigest({ subject: 'Test', body: '<p>Body</p>', mailTo: 'recipient@example.com', gmailUser: ' sender@example.com ', gmailPassword: 'abcd efgh',
    createTransport: config => {
      assert.equal(config.requireTLS, true); assert.equal(config.auth.pass, 'abcdefgh');
      return { sendMail: async message => { assert.equal(message.from, 'sender@example.com'); return { messageId: 'test' }; }, close: () => { closed++; } };
    }
  });
  assert.equal(result.messageId, 'test'); assert.equal(closed, 1);
});

test('digest closes transport on authentication failure', async () => {
  let closed = 0;
  await assert.rejects(sendDigest({ subject: 'Test', body: 'Body', mailTo: 'recipient@example.com', gmailUser: 'sender@example.com', gmailPassword: 'test-password',
    createTransport: () => ({ sendMail: async () => { throw authError(); }, close: () => { closed++; } })
  }), { code: 'EAUTH' });
  assert.equal(closed, 1);
});
