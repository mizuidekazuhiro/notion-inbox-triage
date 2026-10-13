import test from "node:test";
import assert from "node:assert/strict";
import {
  handleWidgetScheduleWeek, eventTimeMs, eventEndMs, selectUpcomingEvents,
  parseScheduleLimit
} from "../src/routes/widgetScheduleWeek.js";

const env = { NOTION_TOKEN: "notion-secret", TASKS_DB_ID: "db", SHORTCUT_TOKEN: "secret" };
const req = token => new Request("https://example.test/api/widget/schedule/week?limit=12", {
  headers: token ? {"X-Shortcut-Token":token} : {}
});
const event = (id, title, start, end, status="Done") => ({
  id, url:`https://notion.so/${id}`,
  properties: {
    "名前": {title: [{plain_text:title}]},
    Status: {select: {name:status}},
    "Event Date": {date: {start,end:end || null}}
  }
});

test("protects schedule endpoint with shared Shortcut Token", async () => {
  assert.equal((await handleWidgetScheduleWeek(req("secret"),{})).status,500);
  assert.equal((await handleWidgetScheduleWeek(req("invalid"),env)).status,401);
});

test("limit is bounded", () => {
  assert.equal(parseScheduleLimit(new Request("https://x/")),10);
  assert.equal(parseScheduleLimit(new Request("https://x/?limit=500")),20);
});

test("all-day end includes the final calendar date in JST", () => {
  assert.equal(eventTimeMs("2026-10-13"),Date.parse("2026-10-13T00:00:00+09:00"));
  assert.equal(eventEndMs({start:"2026-10-13",end:"2026-10-14"}),Date.parse("2026-10-15T00:00:00+09:00"));
});

test("shows upcoming Done appointments, not dropped or task-only rows", () => {
  const now=Date.parse("2026-10-13T12:00:00+09:00");
  const until=Date.parse("2026-10-20T00:00:00+09:00");
  const items=[
    event("future","出張","2026-10-14T09:00:00+09:00",null,"Done"),
    event("active","継続中","2026-10-12T09:00:00+09:00","2026-10-14T09:00:00+09:00"),
    event("dropped","中止","2026-10-15",null,"Drop"),
    event("outside","来週","2026-10-20",null)
  ];
  items.push({id:"task",properties:{"Due Date":{date:{start:"2026-10-14"}}}});
  assert.deepEqual(selectUpcomingEvents(items,now,until).map(x=>x.id),["active","future"]);
});

test("queries Event Date, includes Done and reports exact window", async () => {
  const realFetch=global.fetch,realDate=global.Date;
  global.Date=class extends Date {
    constructor(x){super(x ?? "2026-10-13T03:34:00.000Z");}
    static now(){return Date.parse("2026-10-13T03:34:00.000Z");}
  };
  let requested;
  global.fetch=async (_,options)=>{
    requested=JSON.parse(options.body);
    return new Response(JSON.stringify({
      results:[event("a","大阪出張","2026-10-14T09:00:00+09:00",null)],
      has_more:false
    }),{status:200});
  };
  try {
    const response=await handleWidgetScheduleWeek(req("secret"),env);
    assert.equal(response.status,200);
    const body=await response.json();
    assert.equal(body.count,1);
    assert.equal(body.from,"2026-10-13");
    assert.equal(body.until_exclusive,"2026-10-20");
    assert.equal(body.items[0].title,"大阪出張");
    assert.equal(requested.filter.and[0].property,"Event Date");
  } finally {global.fetch=realFetch;global.Date=realDate;}
});
