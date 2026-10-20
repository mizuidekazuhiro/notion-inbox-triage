import test from "node:test";
import assert from "node:assert/strict";
import {calendarWindow,handleWidgetScheduleCalendar} from "../src/routes/widgetScheduleCalendar.js";

const env={NOTION_TOKEN:"test",TASKS_DB_ID:"db",SHORTCUT_TOKEN:"test"};
const req=(token="test")=>new Request("https://test/api/widget/schedule/calendar",
  {headers:{"X-Shortcut-Token":token}});
function event(id,start,end=null,status="Done") {
  return {id,url:"https://www.notion.so/"+id,properties:{
    "名前":{title:[{plain_text:id}]},"Event Date":{date:{start,end}},
    Status:{select:{name:status}}}};
}
test("Sunday-first 28-day range uses JST across UTC midnight, year and leap day",()=>{
  for(const [date,from,until] of [
    ["2026-10-20T16:36:00Z","2026-10-18","2026-11-15"],
    ["2026-10-24T14:59:59Z","2026-10-18","2026-11-15"],
    ["2026-10-24T15:00:00Z","2026-10-25","2026-11-22"],
    ["2027-01-01T00:00:00+09:00","2026-12-27","2027-01-24"],
    ["2028-02-29T12:00:00+09:00","2028-02-27","2028-03-26"]
  ]) {
    const range=calendarWindow(new Date(date));
    assert.equal(range.from,from); assert.equal(range.until_exclusive,until);
    assert.equal(range.end-range.start,28*86400000);
  }
});
test("auth fails before querying Notion",async()=>{
  assert.equal((await handleWidgetScheduleCalendar(req("wrong"),env)).status,401);
});
test("calendar paginates, retains past days and long ongoing events, never caps at 20",async()=>{
  const original=global.fetch;
  const range=calendarWindow();
  let calls=0;
  global.fetch=async (_,options)=>{
    const q=JSON.parse(options.body); calls++;
    assert.equal(q.filter.and.length,1,"no lower start cutoff for long events");
    assert.equal(q.filter.and[0].date.before,range.until_exclusive);
    if(calls===1) return Response.json({results:[
      event("long","2020-01-01",range.from),
      event("drop",range.from,null,"Drop"),
      {...event("archive",range.from),archived:true},
      {id:"task",properties:{"Due Date":{date:{start:range.from}}}}
    ],has_more:true,next_cursor:"page-2"});
    assert.equal(q.start_cursor,"page-2");
    return Response.json({results:Array.from({length:25},(_,i)=>event("e"+i,range.from)),
      has_more:false});
  };
  try {
    const response=await handleWidgetScheduleCalendar(req(),env);
    assert.equal(response.status,200);
    assert.equal(response.headers.get("Cache-Control"),"no-store");
    const body=await response.json();
    assert.equal(calls,2);assert.equal(body.count,26);assert.equal(body.items.length,26);
    assert.ok(body.items.some(x=>x.id==="long"));
    assert.equal(body.from,range.from);assert.equal(body.until_exclusive,range.until_exclusive);
  }finally{global.fetch=original;}
});
test("Notion errors and incomplete pagination are explicit failures",async()=>{
  const original=global.fetch;
  try {
    global.fetch=async()=>new Response("",{status:429});
    assert.equal((await handleWidgetScheduleCalendar(req(),env)).status,502);
    global.fetch=async()=>Response.json({results:[],has_more:true,next_cursor:"same"});
    assert.equal((await handleWidgetScheduleCalendar(req(),env)).status,502);
  }finally{global.fetch=original;}
});
