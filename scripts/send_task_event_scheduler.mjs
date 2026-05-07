import nodemailer from 'nodemailer';
import { Client } from '@notionhq/client';
import { buildIcs, buildSchedulerUid, isSchedulerTarget, resolveEventWindow } from '../src/utils/taskScheduler.js';

const DEFAULTS = {
  TASK_EVENT_DATE_PROP_NAME: 'Event date',
  TASK_SEND_SCHEDULER_PROP_NAME: 'Send Scheduler',
  TASK_SCHEDULER_SENT_AT_PROP_NAME: 'Scheduler Sent At',
  TASK_SCHEDULER_UID_PROP_NAME: 'Scheduler UID',
  TASK_SCHEDULER_ERROR_PROP_NAME: 'Scheduler Error',
  TASK_STATUS_PROP_NAME: 'Status',
  TASK_STATUS_DONE_VALUE: 'Done',
  TASK_SCHEDULER_LOOKAHEAD_DAYS: '365',
  TASK_SCHEDULER_DEFAULT_DURATION_MIN: '180'
};
const req = (k) => { const v = process.env[k]; if (!v) throw new Error(`${k} is required`); return v; };
const env = (k) => process.env[k] || DEFAULTS[k];

function titleFromPage(page) { for (const [_,p] of Object.entries(page.properties||{})) if (p?.type==='title') return p.title?.[0]?.plain_text||'(No title)'; return '(No title)'; }
function rt(content=''){ return { rich_text: content ? [{type:'text', text:{content: String(content).slice(0,1900)}}] : []}; }

async function main(){
  if (String(process.env.TASK_SCHEDULER_ENABLED || '').toLowerCase() !== 'true') { console.log('skip: TASK_SCHEDULER_ENABLED is not true'); return; }
  const notion = new Client({ auth: req('NOTION_TOKEN'), notionVersion: process.env.NOTION_VERSION });
  const tasksDbId = req('TASKS_DB_ID');
  const props = { status: env('TASK_STATUS_PROP_NAME'), eventDate: env('TASK_EVENT_DATE_PROP_NAME'), sendScheduler: env('TASK_SEND_SCHEDULER_PROP_NAME'), sentAt: env('TASK_SCHEDULER_SENT_AT_PROP_NAME'), uid: env('TASK_SCHEDULER_UID_PROP_NAME'), error: env('TASK_SCHEDULER_ERROR_PROP_NAME') };
  const doneValue = env('TASK_STATUS_DONE_VALUE');
  const lookaheadDays = Number(env('TASK_SCHEDULER_LOOKAHEAD_DAYS'));
  const durationMin = Number(env('TASK_SCHEDULER_DEFAULT_DURATION_MIN'));
  const mailTo = req('COMPANY_SCHEDULER_MAIL_TO');

  const db = await notion.databases.retrieve({ database_id: tasksDbId });
  if (!db.properties?.[props.sendScheduler]) throw new Error(`Required Notion property missing: ${props.sendScheduler}`);

  const now = new Date();
  const lookahead = new Date(now.getTime()+lookaheadDays*86400000);
  const res = await notion.databases.query({ database_id: tasksDbId, page_size: 100 });
  const transporter = nodemailer.createTransport({ host:'smtp.gmail.com', port:587, secure:false, auth:{ user:req('GMAIL_USER'), pass:req('GMAIL_APP_PASSWORD') }});

  let sent=0, failed=0, skipped=0;
  for (const page of res.results) {
    const target = isSchedulerTarget({ page, props, doneValue, now });
    if (!target.ok) { skipped++; continue; }
    const event = resolveEventWindow({ notionDate: page.properties[props.eventDate].date, defaultDurationMin: durationMin, now });
    if (!event || new Date(event.start) > lookahead) { skipped++; continue; }
    const title = titleFromPage(page);
    const uid = buildSchedulerUid(page.id, event.start);
    const notionUrl = page.url;
    const body = `タスク名: ${title}\nEvent date: ${page.properties[props.eventDate].date.start}\n開始: ${event.start}\n終了: ${event.end}\nNotion: ${notionUrl}\n自動送信です。`;
    const ics = buildIcs({ uid, summary:title, description: `${body}\n二重送信防止のため送信後にScheduler Sent Atを更新します。`, startIso:event.start, endIso:event.end, url:notionUrl });
    try {
      await transporter.sendMail({ from:req('GMAIL_USER'), to:mailTo, cc:process.env.COMPANY_SCHEDULER_MAIL_CC, bcc:process.env.COMPANY_SCHEDULER_MAIL_BCC, subject:`[Scheduler] ${title}`, text:body, attachments:[{ filename:'invite.ics', content:ics, contentType:'text/calendar; method=REQUEST; charset=UTF-8' }] });
      await notion.pages.update({ page_id: page.id, properties: { [props.sentAt]: { date: { start: new Date().toISOString() } }, [props.uid]: rt(uid), [props.error]: rt('') } });
      sent++;
      console.log(JSON.stringify({ level:'info', action:'sent', pageId:page.id, title, eventStart:event.start, eventEnd:event.end, uid, notionUrl, inferredFromDateOnly:event.inferredFromDateOnly }));
    } catch (e) {
      failed++;
      await notion.pages.update({ page_id: page.id, properties: { [props.error]: rt(String(e?.message||e).slice(0,1500)), [props.uid]: rt(uid) } });
      console.error(JSON.stringify({ level:'error', action:'failed', pageId:page.id, title, uid, error:String(e?.message||e) }));
    }
  }
  console.log(JSON.stringify({targetTotal:res.results.length,sent,failed,skipped}));
}

main().catch((e)=>{ console.error(e); process.exit(1); });
