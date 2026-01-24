function notionHeaders(env) {
  return {
    Authorization: `Bearer ${env.NOTION_TOKEN}`,
    "Notion-Version": "2022-06-28",
    "Content-Type": "application/json"
  };
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
          property: "Status",
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

  return data.results.map((page) => ({
    id: page.id,
    name: page.properties["名前"]?.title?.[0]?.plain_text ?? "Untitled",
    status: page.properties.Status?.select?.name ?? "",
    priority: page.properties.Priority?.select?.name ?? "-",
    sinceDoISO: page.properties["Since Do"]?.date?.start ?? "",
    sinceSomedayISO: page.properties["Since Someday"]?.date?.start ?? ""
  }));
}

export async function queryDoWaitingTasks(env, todayJstStr, pageSize = 100) {
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
              property: "Status",
              select: { equals: "Do" }
            },
            {
              and: [
                {
                  property: "Status",
                  select: { equals: "Waiting" }
                },
                {
                  or: [
                    {
                      property: "Reminder Date",
                      date: { on_or_before: todayJstStr }
                    },
                    {
                      property: "Reminder Date",
                      date: { is_empty: true }
                    }
                  ]
                }
              ]
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

  return data.results.map((page) => ({
    id: page.id,
    name: page.properties["名前"]?.title?.[0]?.plain_text ?? "Untitled",
    status: page.properties.Status?.select?.name ?? "",
    priority: page.properties.Priority?.select?.name ?? "-",
    sinceDoISO: page.properties["Since Do"]?.date?.start ?? "",
    sinceSomedayISO: page.properties["Since Someday"]?.date?.start ?? "",
    reminderDateISO: page.properties["Reminder Date"]?.date?.start ?? "",
    waitingSinceISO: page.properties["Waiting since"]?.date?.start ?? ""
  }));
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
        Status: { select: { name: nextStatus } }
      }
    })
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to update task status: ${text}`);
  }

  return res.json();
}
