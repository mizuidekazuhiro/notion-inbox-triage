export const TASK_SCHEDULER_DEFAULTS = {
  TASK_EVENT_DATE_PROP_NAME: 'Event Date',
  TASK_SEND_SCHEDULER_PROP_NAME: 'Send Scheduler',
  TASK_SCHEDULER_SENT_AT_PROP_NAME: 'Scheduler Sent At',
  TASK_SCHEDULER_UID_PROP_NAME: 'Scheduler UID',
  TASK_SCHEDULER_ERROR_PROP_NAME: 'Scheduler Error',
  TASK_STATUS_PROP_NAME: 'Status',
  TASK_STATUS_DONE_VALUE: 'Done',
  TASK_SCHEDULER_LOOKAHEAD_DAYS: '365',
  TASK_SCHEDULER_DEFAULT_DURATION_MIN: '180'
};

export function buildStatusDoneFilter({ statusPropName, statusPropType, doneValue }) {
  if (statusPropType === 'select') return { property: statusPropName, select: { equals: doneValue } };
  if (statusPropType === 'status') return { property: statusPropName, status: { equals: doneValue } };
  throw new Error(`Unsupported Status property type: ${statusPropType}`);
}

export async function fetchAllTasks({ queryFn, databaseId, statusPropName, statusPropType, doneValue }) {
  const filter = buildStatusDoneFilter({ statusPropName, statusPropType, doneValue });
  const results = [];
  let start_cursor = undefined;
  do {
    const res = await queryFn({
      database_id: databaseId,
      page_size: 100,
      start_cursor,
      filter
    });
    results.push(...res.results);
    start_cursor = res.has_more ? res.next_cursor : undefined;
  } while (start_cursor);
  return results;
}
