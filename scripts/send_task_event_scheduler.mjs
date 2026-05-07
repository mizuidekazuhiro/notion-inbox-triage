import nodemailer from 'nodemailer';
import { Client } from '@notionhq/client';
import { buildIcs, buildSchedulerUid, isSchedulerTarget, resolveEventWindow } from '../src/utils/taskScheduler.js';
import { TASK_SCHEDULER_DEFAULTS, fetchAllTasks } from '../src/utils/taskSchedulerConfig.js';

const DEFAULTS = TASK_SCHEDULER_DEFAULTS;

const req = (k) => { const v = process.env[k]; if (!v) throw new Error(`${k} is required`); return v; };
const env = (k) => process.env[k] || DEFAULTS[k];
const SENT_SUSPECT_PATTERNS = [/^sending$/i, /^email_sent_but_notion_update_failed/i, /^possible_already_sent/i];

function titleFromPage(page) {
  for (const p of Object.values(page.properties || {})) {
    if (p?.type === 'title') return (p.title || []).map((x) => x.plain_text || '').join('').trim() || '(No title)';
  }
  return '(No title)';
}
function rt(content = '') { return { rich_text: content ? [{ type: 'text', text: { content: String(content).slice(0, 1900) } }] : [] }; }
function richTextValue(prop) { return (prop?.rich_text || []).map((x) => x.plain_text || '').join('').trim(); }
function increment(map, key) { map[key] = (map[key] || 0) + 1; }

export function validateRequiredProperties(db, props) {
  const schema = db.properties || {};
  const expected = [
    [props.status, ['status', 'select']],
    [props.eventDate, ['date']],
    [props.sendScheduler, ['checkbox']],
    [props.sentAt, ['date']],
    [props.uid, ['rich_text']],
    [props.error, ['rich_text']]
  ];
  const missing = [];
  const wrongType = [];
  for (const [name, types] of expected) {
    const prop = schema[name];
    if (!prop) missing.push(name);
    else if (!types.includes(prop.type)) wrongType.push(`${name}:${prop.type} (expected ${types.join('|')})`);
  }
  if (missing.length || wrongType.length) {
    throw new Error(`Required Notion properties invalid. missing=[${missing.join(', ')}] wrongType=[${wrongType.join(', ')}]`);
  }
}

async function processPage({ page, now, lookahead, durationMin, props, doneValue, notion, transporter, mail }) {
  const target = isSchedulerTarget({ page, props, doneValue, now });
  if (!target.ok) return { type: 'skip', reason: target.reason };

  const uidText = richTextValue(page.properties?.[props.uid]);
  const errText = richTextValue(page.properties?.[props.error]);
  if (uidText && SENT_SUSPECT_PATTERNS.some((re) => re.test(errText))) {
    return { type: 'skip', reason: 'possible_already_sent' };
  }

  const event = resolveEventWindow({ notionDate: page.properties[props.eventDate].date, defaultDurationMin: durationMin });
  if (!event) return { type: 'skip', reason: 'event_date_empty' };
  if (new Date(event.start) > lookahead) return { type: 'skip', reason: 'beyond_lookahead' };

  const title = titleFromPage(page);
  const uid = buildSchedulerUid(page.id, event.start);
  const notionUrl = page.url;
  const body = `タスク名: ${title}\nEvent Date: ${page.properties[props.eventDate].date.start}\n開始: ${event.start}\n終了: ${event.end}\nNotion: ${notionUrl}\n自動送信です。`;
  const ics = buildIcs({ uid, summary: title, description: `${body}\n二重送信防止のため送信後にScheduler Sent Atを更新します。`, startIso: event.start, endIso: event.end, url: notionUrl });

  await notion.pages.update({ page_id: page.id, properties: { [props.uid]: rt(uid), [props.error]: rt('sending') } });

  try {
    await transporter.sendMail({ from: mail.from, to: mail.to, cc: mail.cc, bcc: mail.bcc, subject: `[Scheduler] ${title}`, text: body, attachments: [{ filename: 'invite.ics', content: ics, contentType: 'text/calendar; method=REQUEST; charset=UTF-8' }] });
  } catch (e) {
    await notion.pages.update({ page_id: page.id, properties: { [props.uid]: rt(uid), [props.error]: rt(String(e?.message || e).slice(0, 1500)) } });
    return { type: 'failed', reason: 'smtp_send_failed' };
  }

  try {
    await notion.pages.update({ page_id: page.id, properties: { [props.sentAt]: { date: { start: new Date().toISOString() } }, [props.uid]: rt(uid), [props.error]: rt('') } });
    return { type: 'sent', pageId: page.id, title, eventStart: event.start, eventEnd: event.end, uid, notionUrl, inferredFromDateOnly: event.inferredFromDateOnly };
  } catch (e) {
    const marker = `email_sent_but_notion_update_failed: ${String(e?.message || e).slice(0, 1200)}`;
    try { await notion.pages.update({ page_id: page.id, properties: { [props.uid]: rt(uid), [props.error]: rt(marker) } }); } catch {}
    console.error(JSON.stringify({ action: 'email_sent_but_notion_update_failed', pageId: page.id, title, uid, eventStart: event.start, eventEnd: event.end, error: String(e?.message || e) }));
    return { type: 'skip', reason: 'possible_already_sent' };
  }
}

export async function main() {
  if (String(process.env.TASK_SCHEDULER_ENABLED || '').toLowerCase() !== 'true') { console.log('skip: TASK_SCHEDULER_ENABLED is not true'); return; }
  const notion = new Client({ auth: req('NOTION_TOKEN'), notionVersion: process.env.NOTION_VERSION });
  const props = { status: env('TASK_STATUS_PROP_NAME'), eventDate: env('TASK_EVENT_DATE_PROP_NAME'), sendScheduler: env('TASK_SEND_SCHEDULER_PROP_NAME'), sentAt: env('TASK_SCHEDULER_SENT_AT_PROP_NAME'), uid: env('TASK_SCHEDULER_UID_PROP_NAME'), error: env('TASK_SCHEDULER_ERROR_PROP_NAME') };
  const doneValue = env('TASK_STATUS_DONE_VALUE');
  const lookaheadDays = Number(env('TASK_SCHEDULER_LOOKAHEAD_DAYS'));
  const durationMin = Number(env('TASK_SCHEDULER_DEFAULT_DURATION_MIN'));

  const db = await notion.databases.retrieve({ database_id: req('TASKS_DB_ID') });
  validateRequiredProperties(db, props);

  const statusPropType = db.properties?.[props.status]?.type;
  const tasks = await fetchAllTasks({ queryFn: notion.databases.query.bind(notion.databases), databaseId: req('TASKS_DB_ID'), statusPropName: props.status, statusPropType, doneValue });
  const transporter = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 587, secure: false, auth: { user: req('GMAIL_USER'), pass: req('GMAIL_APP_PASSWORD') } });
  const now = new Date();
  const lookahead = new Date(now.getTime() + lookaheadDays * 86400000);

  let checkedTotal = 0; let targetTotal = 0; let sent = 0; let failed = 0;
  const skippedByReason = {};
  for (const page of tasks) {
    checkedTotal++;
    const result = await processPage({ page, now, lookahead, durationMin, props, doneValue, notion, transporter, mail: { from: req('GMAIL_USER'), to: req('COMPANY_SCHEDULER_MAIL_TO'), cc: process.env.COMPANY_SCHEDULER_MAIL_CC, bcc: process.env.COMPANY_SCHEDULER_MAIL_BCC } });
    if (result.type === 'sent') { targetTotal++; sent++; console.log(JSON.stringify({ level: 'info', action: 'sent', ...result })); }
    else if (result.type === 'failed') { targetTotal++; failed++; increment(skippedByReason, result.reason); }
    else { increment(skippedByReason, result.reason); }
  }
  console.log(JSON.stringify({ fetchedTotal: tasks.length, checkedTotal, targetTotal, sent, failed, skippedByReason }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
