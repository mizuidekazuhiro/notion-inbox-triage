function notionHeaders(env) {
  return {
    Authorization: `Bearer ${env.NOTION_TOKEN}`,
    "Notion-Version": "2022-06-28",
    "Content-Type": "application/json"
  };
}

async function notionFetch(url, env, options = {}) {
  const headers = {
    ...notionHeaders(env),
    ...(options.headers || {})
  };
  return fetch(url, { ...options, headers });
}

export { notionHeaders, notionFetch };
