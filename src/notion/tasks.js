const TASK_PROPERTIES = Object.freeze({
  title: "名前",
  status: "Status",
  priority: "Priority",
  dueDate: "Due Date",
  reminderDate: "Reminder Date",
  waitingSince: "Waiting Since",
  sinceDo: "Since Do",
  sinceSomeday: "Since Someday",
  taskLevel: "Task Level",
  parentTask: "Parent Task",
  childTasks: "Child Tasks",
  summary: "Summary",
  myTasks: "My Tasks",
  otherTasks: "Other Tasks"
});

function notionHeaders(env) {
  return {
    Authorization: `Bearer ${env.NOTION_TOKEN}`,
    "Notion-Version": "2022-06-28",
    "Content-Type": "application/json"
  };
}

function pickPageTitle(page) {
  return page.properties[TASK_PROPERTIES.title]?.title?.[0]?.plain_text ?? "Untitled";
}

function mapTaskPage(page) {
  return {
    id: page.id,
    name: pickPageTitle(page),
    status: page.properties[TASK_PROPERTIES.status]?.select?.name ?? "",
    priority: page.properties[TASK_PROPERTIES.priority]?.select?.name ?? "-",
    dueDateISO: page.properties[TASK_PROPERTIES.dueDate]?.date?.start ?? null,
    sinceDoISO: page.properties[TASK_PROPERTIES.sinceDo]?.date?.start ?? "",
    sinceSomedayISO: page.properties[TASK_PROPERTIES.sinceSomeday]?.date?.start ?? "",
    reminderDateISO: page.properties[TASK_PROPERTIES.reminderDate]?.date?.start ?? null,
    waitingSinceISO: page.properties[TASK_PROPERTIES.waitingSince]?.date?.start ?? null,
    taskLevel: page.properties[TASK_PROPERTIES.taskLevel]?.select?.name ?? "",
    parentTaskIds:
      page.properties[TASK_PROPERTIES.parentTask]?.relation?.map((relation) => relation.id) ?? [],
    childTaskIds:
      page.properties[TASK_PROPERTIES.childTasks]?.relation?.map((relation) => relation.id) ?? [],
    summary: page.properties[TASK_PROPERTIES.summary]?.rich_text?.[0]?.plain_text ?? "",
    myTasks: page.properties[TASK_PROPERTIES.myTasks]?.rich_text?.[0]?.plain_text ?? "",
    otherTasks: page.properties[TASK_PROPERTIES.otherTasks]?.rich_text?.[0]?.plain_text ?? "",
    parentTaskName: "",
    url: page.url || ""
  };
}

async function attachParentTaskNames(env, items) {
  const parentIds = [
    ...new Set(items.flatMap((item) => item.parentTaskIds || []).filter(Boolean))
  ];

  if (parentIds.length === 0) return items;

  const entries = await Promise.all(
    parentIds.map(async (parentId) => {
      try {
        const page = await getTask(env, parentId);
        return [parentId, pickPageTitle(page)];
      } catch (error) {
        console.error("Failed to fetch parent task", parentId, error);
        return [parentId, ""];
      }
    })
  );

  const parentNames = new Map(entries);

  return items.map((item) => ({
    ...item,
    parentTaskName: item.parentTaskIds?.[0]
      ? parentNames.get(item.parentTaskIds[0]) || ""
      : ""
  }));
}

export async function queryTasksByStatus(env, status, pageSize = 100) {
  const res = await fetch(
    `https://api.notion.com/v1/databases/${env.TASKS_DB_ID}/query`,
    {
      method: "POST",
      headers: notionHeaders(env),
      body: JSON.stringify({
        page_size: pageSize,
        filter: {
          property: TASK_PROPERTIES.status,
          select: { equals: status }
        }
      })
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to query tasks: ${text}`);
  }

  const data = await res.json();
  return (data.results || []).map(mapTaskPage);
}

export async function queryDoWaitingTasks(env, pageSize = 100) {
  try {
    const res = await fetch(
      `https://api.notion.com/v1/databases/${env.TASKS_DB_ID}/query`,
      {
        method: "POST",
        headers: notionHeaders(env),
        body: JSON.stringify({
          page_size: pageSize,
          filter: {
            or: [
              {
                property: TASK_PROPERTIES.status,
                select: { equals: "Do" }
              },
              {
                property: TASK_PROPERTIES.status,
                select: { equals: "Waiting" }
              }
            ]
          }
        })
      }
    );

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Failed to query tasks: ${text}`);
    }

    const data = await res.json();
    const items = (data.results || []).map(mapTaskPage);
    return attachParentTaskNames(env, items);
  } catch (error) {
    console.error("Failed to query Do/Waiting tasks", error);
    return [];
  }
}

export async function queryWidgetTasksToday(env, pageSize = 100) {
  const res = await fetch(
    `https://api.notion.com/v1/databases/${env.TASKS_DB_ID}/query`,
    {
      method: "POST",
      headers: notionHeaders(env),
      body: JSON.stringify({
        page_size: pageSize,
        filter: {
          or: [
            {
              property: TASK_PROPERTIES.status,
              select: { equals: "Do" }
            },
            {
              property: TASK_PROPERTIES.status,
              select: { equals: "Waiting" }
            }
          ]
        }
      })
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to query widget tasks today: ${text}`);
  }

  const data = await res.json();
  return (data.results || []).map(mapTaskPage);
}

export async function getTask(env, taskId) {
  const res = await fetch(`https://api.notion.com/v1/pages/${taskId}`, {
    headers: notionHeaders(env)
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to fetch task: ${text}`);
  }

  return res.json();
}

export async function updateTaskStatus(env, taskId, nextStatus) {
  const res = await fetch(`https://api.notion.com/v1/pages/${taskId}`, {
    method: "PATCH",
    headers: notionHeaders(env),
    body: JSON.stringify({
      properties: {
        [TASK_PROPERTIES.status]: { select: { name: nextStatus } }
      }
    })
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to update task status: ${text}`);
  }

  return res.json();
}

export async function updateTaskReminderDate(env, taskId, reminderDateISO) {
  const res = await fetch(`https://api.notion.com/v1/pages/${taskId}`, {
    method: "PATCH",
    headers: notionHeaders(env),
    body: JSON.stringify({
      properties: {
        [TASK_PROPERTIES.reminderDate]: {
          date: { start: reminderDateISO }
        }
      }
    })
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to update Reminder Date: ${text}`);
  }

  return res.json();
}

export { TASK_PROPERTIES, mapTaskPage };
