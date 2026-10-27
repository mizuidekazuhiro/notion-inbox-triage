// Planned work dates are independent of status-change and completion timestamps.
export function validPlannedDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y,m,d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y,m-1,d));
  return y>=2000 && y<=2100 && date.getUTCFullYear()===y &&
    date.getUTCMonth()===m-1 && date.getUTCDate()===d;
}
export function dateKey(value) {
  if (!value) return null;
  if (validPlannedDate(value)) return value;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms+9*3600000).toISOString().slice(0,10) : null;
}
export function readTaskSchedule(properties={}) {
  const start = properties["Start Date"]?.date || null;
  const due = properties["Due Date"]?.date || null;
  return {
    start_date: dateKey(due?.end ? due.start : start?.start),
    due_date: dateKey(due?.end || due?.start),
    schedule_revision: JSON.stringify([start,due])
  };
}
export function validSchedule(start,due) {
  const absent=value=>value===null || value===undefined || value==="";
  return (absent(start) || validPlannedDate(start)) && (absent(due) || validPlannedDate(due)) &&
    !(start && due && start>due);
}
// Preserve an existing time of day on a date edit. A no-op never writes.
export function scheduleProperties(start,due,properties={}) {
  const oldStart=properties["Start Date"]?.date;
  const oldDue=properties["Due Date"]?.date;
  const startValue=oldDue?.end ? oldDue.start : oldStart?.start;
  const dueValue=oldDue?.end || oldDue?.start;
  const timed=Boolean(startValue?.includes("T") || dueValue?.includes("T"));
  const valueFor=(old,value)=>{
    if (old?.includes("T")) {
      if (dateKey(old)===value) return old;
      const delta=Date.parse(value)-Date.parse(dateKey(old));
      return new Date(Date.parse(old)+delta).toISOString();
    }
    return timed ? value+"T00:00:00+09:00" : value;
  };
  // Full periods stay in Due Date so native Notion Gantt editing stays canonical.
  // Start Date is only necessary when there is no deadline yet.
  const startDate=start&&!due ? {start:valueFor(startValue,start),end:null} : null;
  const dueDate=!due ? null : start ?
    {start:valueFor(startValue,start),end:valueFor(dueValue,due)} :
    {start:valueFor(dueValue,due),end:null};
  return {"Start Date":{date:startDate},"Due Date":{date:dueDate}};
}
export function taskFocusState(task,today) {
  if (task.blocked_by?.length) return "blocked";
  if (task.start_date && task.start_date>today) return "upcoming";
  if (task.status==="Waiting") {
    if (task.reminder_date) return task.reminder_date<=today ? "now" : "upcoming";
    if (task.waiting_since) {
      return (Date.parse(today)-Date.parse(task.waiting_since))/86400000>=3 ? "now" : "upcoming";
    }
    return "unscheduled";
  }
  if (task.start_date) return "now";
  if (!task.due_date) return "unscheduled";
  return (Date.parse(task.due_date)-Date.parse(today))/86400000<=7 ? "now" : "upcoming";
}
