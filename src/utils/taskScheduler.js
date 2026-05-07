const DEFAULT_TIMEZONE = 'Asia/Tokyo';

export function buildSchedulerUid(pageId, eventStartIso) {
  return `notion-task-${pageId}-${eventStartIso}@notion-inbox-triage`;
}

export function resolveEventWindow({ notionDate, defaultDurationMin = 180, now = new Date() }) {
  if (!notionDate?.start) return null;
  const tz = notionDate.time_zone || DEFAULT_TIMEZONE;
  const hasTime = notionDate.start.includes('T');

  if (!hasTime) {
    const day = notionDate.start;
    return {
      start: `${day}T09:00:00+09:00`,
      end: `${day}T12:00:00+09:00`,
      timezone: tz,
      inferredFromDateOnly: true
    };
  }

  const start = notionDate.start;
  const end = notionDate.end || new Date(new Date(start).getTime() + defaultDurationMin * 60000).toISOString();
  return { start, end, timezone: tz, inferredFromDateOnly: false };
}

export function isSchedulerTarget({ page, props, doneValue, now = new Date() }) {
  const p = page.properties || {};
  const status = p[props.status];
  const eventDate = p[props.eventDate]?.date;
  const sendScheduler = p[props.sendScheduler]?.checkbox === true;
  const sentAt = p[props.sentAt]?.date?.start;

  const statusValue = status?.status?.name || status?.select?.name || '';
  if (statusValue !== doneValue) return { ok: false, reason: 'status_not_done' };
  if (!eventDate?.start) return { ok: false, reason: 'event_date_empty' };
  const event = resolveEventWindow({ notionDate: eventDate, defaultDurationMin: 180, now });
  if (!event) return { ok: false, reason: 'event_date_empty' };
  if (new Date(event.start).getTime() <= now.getTime()) return { ok: false, reason: 'event_not_future' };
  if (!sendScheduler) return { ok: false, reason: 'send_scheduler_not_true' };
  if (sentAt) return { ok: false, reason: 'already_sent' };
  return { ok: true, event };
}

export function buildIcs({ uid, summary, description, startIso, endIso, timezone = DEFAULT_TIMEZONE, url }) {
  const escape = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\n/g, '\\n');
  const dtStamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const fmtLocal = (iso) => {
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}${p(d.getUTCMonth()+1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
  };
  return [
    'BEGIN:VCALENDAR',
    'PRODID:-//notion-inbox-triage//Task Scheduler//EN',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${escape(uid)}`,
    `DTSTAMP:${dtStamp}Z`,
    `DTSTART:${fmtLocal(startIso)}`,
    `DTEND:${fmtLocal(endIso)}`,
    `SUMMARY:${escape(summary)}`,
    `DESCRIPTION:${escape(description)}`,
    url ? `URL:${escape(url)}` : null,
    'END:VEVENT',
    'END:VCALENDAR'
  ].filter(Boolean).join('\r\n');
}
