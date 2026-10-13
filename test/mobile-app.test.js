import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { clientJs } from "../src/mobile/client.js";
import { html,css,manifest,serviceWorker } from "../src/mobile/shell.js";
import { mobilePngIcon } from "../src/mobile/icon.js";
import {
  isUuid,pageBelongsToDatabase,listMobileInbox,listMobileTasks,transitionMobileTask
} from "../src/notion/mobileData.js";
import {
  handleMobileApi,handleMobileAsset,validDate,validMoveRequest,writeOriginAllowed
} from "../src/routes/mobileApp.js";

const INBOX="2e2dec27c9aa809d82f0db2ca819140c";
const TASKS="2e1dec27c9aa808a8e8dd8c09955e4a1";
const PAGE="8e8dec27c9aa809d82f0db2ca819140c";
const PARENT="9e9dec27c9aa809d82f0db2ca819140c";
const env={NOTION_TOKEN:"test-notion",INBOX_DB_ID:INBOX,TASKS_DB_ID:TASKS,SHORTCUT_TOKEN:"test-secret"};
const req=(url,headers={})=>new Request("https://example.test"+url,{headers});
function mockPage(id,databaseId,properties){
 return {id,parent:{type:"database_id",database_id:databaseId},url:"https://www.notion.so/"+id,properties};
}
function response(o,status=200){return new Response(JSON.stringify(o),{status,headers:{"Content-Type":"application/json"}});}
function withFetch(mock,fn){
 const original=global.fetch;global.fetch=mock;
 return Promise.resolve().then(fn).finally(()=>{global.fetch=original;});
}

test("PWA shell and client JavaScript parse and serve with restrictive CSP",async()=>{
 assert.doesNotThrow(()=>new vm.Script(clientJs));
 assert.ok(clientJs.includes(String.raw`const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(s);`), "generated client must match numeric dates");
 assert.ok(html.includes("apple-touch-icon"));
 assert.ok(html.includes('id="dashboard"'));
 assert.ok(css.includes("backdrop-filter"));
 assert.equal(JSON.parse(manifest).display,"standalone");
 assert.ok(serviceWorker.includes('"/mobile/client.js"'));
 assert.ok(!serviceWorker.includes('"/api/mobile/inbox"'));
 const result=await handleMobileAsset(req("/mobile"));
 assert.equal(result.status,200);
 assert.match(result.headers.get("Content-Security-Policy"),/connect-src 'self'/);
 assert.match(await result.text(),/Notion Flow/);
});

test("Notion Flow deep link opens Tasks tab and invalid values default to Inbox",()=>{
 function simulate(query) {
   const elements=new Map();
   const getElement=id=>{
     if(!elements.has(id)) elements.set(id,{
       hidden:false,
       focus(){},
       addEventListener(){},
       classList:{toggle(){}},
       setAttribute(){},
       removeAttribute(){}
     });
     return elements.get(id);
   };
   const tabs=["inbox","tasks"].map(tab=>({
     dataset:{tab},
     selected:false,
     classList:{toggle(_,selected){this.owner.selected=selected;}},
     setAttribute(){},
     removeAttribute(){}
   }));
   tabs.forEach(tab=>{tab.classList.owner=tab;});
   const document={
     getElementById:getElement,
     querySelectorAll(selector){return selector==="[data-tab]"?tabs:[];},
     querySelector(){return {addEventListener(){}};},
     addEventListener(){}
   };
   const runtime={
     document,
     window:{location:{search:query}},
     navigator:{},
     sessionStorage:{getItem(){return "";}},
     URLSearchParams,
     console
   };
   new vm.Script(clientJs).runInNewContext(runtime,{timeout:2000});
   return {tabs,sections:{inbox:getElement("inbox-panel").hidden,tasks:getElement("tasks-panel").hidden}};
 }
 const tasks=simulate("?tab=tasks");
 assert.equal(tasks.sections.inbox,true);
 assert.equal(tasks.sections.tasks,false);
 assert.equal(tasks.tabs[1].selected,true);
 const normal=simulate("");
 assert.equal(normal.sections.inbox,false);
 assert.equal(normal.sections.tasks,true);
 const invalid=simulate("?tab=unexpected");
 assert.equal(invalid.sections.inbox,false);
 assert.equal(invalid.sections.tasks,true);
});

test("iOS touch icon returns actual PNG, not an SVG masquerading as PNG",async()=>{
 const result=await mobilePngIcon(180);
 assert.equal(result.status,200);
 assert.equal(result.headers.get("Content-Type"),"image/png");
 const sig=new Uint8Array(await result.arrayBuffer()).slice(0,8);
 assert.deepEqual([...sig],[137,80,78,71,13,10,26,10]);
});

test("UUID, date and mobile move inputs reject invalid values",()=>{
 assert.equal(isUuid(PAGE),true);
 assert.equal(isUuid("x/../../anything"),false);
 assert.equal(validDate("2026-02-28"),true);
 assert.equal(validDate("2026-02-31"),false);
 assert.equal(validDate("2026-13-01"),false);
 assert.equal(validMoveRequest({inbox_page_id:PAGE,status:"Do",due_date:"2026-10-20",priority:"High"}),true);
 assert.equal(validMoveRequest({inbox_page_id:PAGE,status:"Do",priority:"Admin"}),false);
 assert.equal(validMoveRequest({inbox_page_id:PAGE,status:"Nope"}),false);
 assert.equal(pageBelongsToDatabase(mockPage(PAGE,TASKS,{}),INBOX),false);
 assert.equal(pageBelongsToDatabase(mockPage(PAGE,TASKS,{}),TASKS),true);
});

test("mobile endpoints enforce Shortcut Token, POST origin and method",async()=>{
 const noAuth=await handleMobileApi(req("/api/mobile/inbox"),env);
 assert.equal(noAuth.status,401);
 const noConfig=await handleMobileApi(req("/api/mobile/inbox"),{});
 assert.equal(noConfig.status,503);
 const wrongMethod=await handleMobileApi(new Request("https://example.test/api/mobile/task/status",{method:"GET",headers:{"X-Shortcut-Token":"test-secret"}}),env);
 assert.equal(wrongMethod.status,405);
 const denied=new Request("https://example.test/api/mobile/task/status",{
  method:"POST",headers:{"X-Shortcut-Token":"test-secret","Origin":"https://example.org","Content-Type":"application/json"},
  body:JSON.stringify({task_id:PAGE,expected_status:"Do",to:"Done"})
 });
 assert.equal(writeOriginAllowed(denied),false);
 assert.equal((await handleMobileApi(denied,env)).status,403);
});

test("mobile Inbox query loads only unprocessed source pages",async()=>{
 const page=mockPage(PAGE,INBOX,{
  Name:{title:[{plain_text:"新規案件の対応"}]},
  Created:{date:{start:"2026-10-13T12:00:00+09:00"}}
 });
 await withFetch(async(url,init)=>{
  assert.match(url,/\/databases\//);
  const payload=JSON.parse(init.body);
  assert.equal(payload.filter.and.length,2);
  return response({results:[page],has_more:false});
 },async()=>{
  const result=await listMobileInbox(env);
  assert.equal(result.count,1);
  assert.equal(result.items[0].title,"新規案件の対応");
 });
});

test("Do/Waiting list preserves hierarchy and includes waiting without due date",async()=>{
 const parents=mockPage(PARENT,TASKS,{
  "名前":{title:[{plain_text:"マネジメント会議"}]},
  Status:{select:{name:"Do"}},
  "Task Level":{select:{name:"親タスク"}},
  "Child Tasks":{relation:[{id:PAGE}]}
 });
 const child=mockPage(PAGE,TASKS,{
  "名前":{title:[{plain_text:"会議資料の作成"}]},
  Status:{select:{name:"Waiting"}},
  "Task Level":{select:{name:"子タスク"}},
  "Parent Task":{relation:[{id:PARENT}]}
 });
 await withFetch(async(_url,init)=>{
  const q=JSON.parse(init.body);
  assert.equal(q.filter.or.length,2);
  return response({results:[child,parents],has_more:false});
 },async()=>{
  const result=await listMobileTasks(env);
  assert.equal(result.count,2);
  const t=result.items.find(x=>x.id===PAGE);
  assert.equal(t.parent_name,"マネジメント会議");
  assert.equal(t.status,"Waiting");
  assert.equal(t.due_date,null);
  assert.equal(result.items.find(x=>x.id===PARENT).is_parent,true);
 });
});

test("only Do/Waiting pages of the Tasks DB can transition",async()=>{
 let writes=0;
 await withFetch(async(_url,init)=>{
  if(init?.method==="PATCH")writes++;
  return response(mockPage(PAGE,INBOX,{Status:{select:{name:"Do"}}}));
 },async()=>{
  const result=await transitionMobileTask(env,PAGE,"Do","Done");
  assert.equal(result.status,403);
  assert.equal(writes,0);
 });
 await withFetch(async(_url,init)=>{
  if(init?.method==="PATCH")writes++;
  return response(mockPage(PAGE,TASKS,{Status:{select:{name:"Someday"}}}));
 },async()=>{
  const result=await transitionMobileTask(env,PAGE,"Do","Done");
  assert.equal(result.status,409);
  assert.equal(writes,0);
 });
});

test("status change patches only status and matching stage timestamp",async()=>{
 let payload=null;
 await withFetch(async(_url,init)=>{
  if(init?.method==="PATCH"){
   payload=JSON.parse(init.body);return response({id:PAGE});
  }
  return response(mockPage(PAGE,TASKS,{Status:{select:{name:"Do"}}}));
 },async()=>{
  const result=await transitionMobileTask(env,PAGE,"Do","Waiting",new Date("2026-10-13T05:00:00Z"));
  assert.equal(result.ok,true);
  assert.equal(payload.properties.Status.select.name,"Waiting");
  assert.equal(payload.properties["Waiting Since"].date.start,"2026-10-13");
  assert.deepEqual(Object.keys(payload.properties).sort(),["Status","Waiting Since"].sort());
 });
});

test("Inbox move never writes a page belonging to a different DB",async()=>{
 let calls=0;
 await withFetch(async(_url,_init)=>{
  calls++;
  return response(mockPage(PAGE,TASKS,{Processed:{rich_text:[]}}));
 },async()=>{
  const request=new Request("https://example.test/api/mobile/inbox/move",{
   method:"POST",headers:{"X-Shortcut-Token":"test-secret","Origin":"https://example.test","Content-Type":"application/json"},
   body:JSON.stringify({inbox_page_id:PAGE,status:"Do"})
  });
  const result=await handleMobileApi(request,env);
  assert.equal(result.status,403);
  assert.equal(calls,1);
 });
});
