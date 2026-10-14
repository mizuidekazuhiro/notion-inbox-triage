import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {
  createMobileTask, listMobileParentTasks, validMobileTaskCreate, MobileTaskCreateError
} from "../src/notion/mobileCreate.js";
import { handleMobileApi } from "../src/routes/mobileApp.js";
import { mintSessionCookie } from "../src/mobile/session.js";
import { clientJs } from "../src/mobile/client.js";
import { html } from "../src/mobile/shell.js";

const TASKS="2e1dec27c9aa808a8e8dd8c09955e4a1";
const PROJECTS="2e1dec27c9aa80079754e83509883e4e";
const PARENT="388dec27c9aa800bbb6fc5580a564d69";
const PROJECT="2e1dec27c9aa816bbec9df24a51107e6";
const PROJECT2="2e1dec27c9aa807683d5f5d4a80cab51";
const NEW_TASK="3e6dec27c9aa80b8a873ef855a180bd2";
const ENV={
  NOTION_TOKEN:"notion-token",SHORTCUT_TOKEN:"shortcut-token",
  ACTION_SECRET:"test-signature-secret",TASKS_DB_ID:TASKS,PROJECTS_DB_ID:PROJECTS
};
const BASE="https://example.test";
const page=(id,db,props={})=>({
  id,parent:{type:"database_id",database_id:db},archived:false,
  url:"https://www.notion.so/"+id.replaceAll("-",""),properties:props
});
const parent=()=>page(PARENT,TASKS,{
  "名前":{title:[{plain_text:"共英製鋼 マネジメント会議"}]},
  "Task Level":{select:{name:"親タスク"}},
  Status:{select:{name:"Do"}},
  Project:{relation:[{id:PROJECT}]}
});
const json=(object,code=200)=>new Response(JSON.stringify(object),{
  status:code,headers:{"Content-Type":"application/json"}
});
async function withFetch(mock,fn){
  const original=global.fetch;
  global.fetch=mock;
  try{return await fn();}finally{global.fetch=original;}
}
const cookie=async()=>("__Host-nf_session="+
  (await mintSessionCookie(ENV)).split(";")[0].split("=")[1]);
function request(path,body,headers={},method="POST"){
  return new Request(BASE+path,{
    method,headers:{
      "Content-Type":"application/json",
      Origin:BASE,"X-Notion-Flow":"1",...headers
    },
    body:method==="POST"?JSON.stringify(body):undefined
  });
}

test("validates strict task creation payloads and permitted status/parent combinations",()=>{
  assert.equal(validMobileTaskCreate({name:" 企業との打合せ ",status:"Do"}),true);
  assert.equal(validMobileTaskCreate({name:"   ",status:"Do"}),false);
  assert.equal(validMobileTaskCreate({name:"a".repeat(241),status:"Do"}),false);
  assert.equal(validMobileTaskCreate({name:"A",status:"Drop"}),false);
  assert.equal(validMobileTaskCreate({name:"A",status:"Done"}),false);
  assert.equal(validMobileTaskCreate({name:"A",status:"Thinking",task_level:"親タスク"}),true);
  assert.equal(validMobileTaskCreate({name:"A",status:"Do",task_level:"親タスク",parent_task_id:PARENT}),false);
  assert.equal(validMobileTaskCreate({name:"A",status:"Do",parent_task_id:"foreign-id"}),false);
  assert.equal(validMobileTaskCreate({name:"A",status:"Do",priority:"Admin"}),false);
  assert.equal(validMobileTaskCreate({name:"A",status:"Do",due_date:"2026-02-30"}),false);
  assert.equal(validMobileTaskCreate({name:"A",status:"Waiting",reminder_date:"2026-10-19"}),true);
  assert.equal(validMobileTaskCreate({name:"A",status:"Do",reminder_date:"2026-10-19"}),false);
  assert.equal(validMobileTaskCreate({name:"A",status:"Do",context:"z".repeat(1001)}),false);
  assert.equal(validMobileTaskCreate({name:"A",status:"Do",weird:"DROP TABLE"}),false);
});

test("gets only active parent tasks and supports Notion pagination",async()=>{
 let calls=0;
 await withFetch(async(url,options)=>{
   assert.ok(url.endsWith("/databases/"+TASKS+"/query"));
   assert.equal(options.method,"POST");
   const query=JSON.parse(options.body);
   assert.equal(query.filter.property,"Task Level");
   assert.equal(query.filter.select.equals,"親タスク");
   calls++;
   if(calls===1){
     assert.equal(query.start_cursor,undefined);
     return json({results:[parent(),page(PROJECT2,TASKS,{
       "名前":{title:[{plain_text:"完了した親タスク"}]},
       Status:{select:{name:"Done"}}})],has_more:true,next_cursor:"next"});
   }
   assert.equal(query.start_cursor,"next");
   return json({results:[page(NEW_TASK,TASKS,{
     "名前":{title:[{plain_text:"次の親タスク"}]},
     Status:{select:{name:"Waiting"}}})],has_more:false});
 },async()=>{
   const result=await listMobileParentTasks(ENV);
   assert.equal(result.count,2);
   assert.equal(result.truncated,false);
   assert.equal(result.items[0].name,"共英製鋼 マネジメント会議");
   assert.equal(result.items[0].project_id,PROJECT);
   assert.equal(result.items[1].name,"次の親タスク");
 });
 assert.equal(calls,2);
});

test("creates a child task in Tasks DB with inherited project and stage timestamps",async()=>{
 const calls=[];
 await withFetch(async(url,options)=>{
   calls.push({url,method:options?.method||"GET",body:options?.body});
   if(url.endsWith("/pages/"+PARENT))return json(parent());
   if(url.endsWith("/pages/"+PROJECT))return json(page(PROJECT,PROJECTS));
   if(url.endsWith("/v1/pages") && options.method==="POST")
     return json({id:NEW_TASK,url:"https://www.notion.so/"+NEW_TASK},200);
   throw new Error("unexpected Notion request "+url);
 },async()=>{
   const result=await createMobileTask(ENV,{
     name:"  資料最終化  ",status:"Do",task_level:"子タスク",
     parent_task_id:PARENT,priority:"High",due_date:"2026-10-20",
     context:"会議用の最新版を準備"
   },new Date("2026-10-14T00:10:00Z"));
   assert.equal(result.name,"資料最終化");
   assert.equal(result.project_id,PROJECT);
   assert.equal(result.parent_id,PARENT);
   assert.equal(result.id,NEW_TASK);
 });
 const post=calls.find(x=>x.method==="POST");
 assert.ok(post);
 const payload=JSON.parse(post.body);
 assert.equal(payload.parent.database_id,TASKS);
 const p=payload.properties;
 assert.equal(p["名前"].title[0].text.content,"資料最終化");
 assert.equal(p.Status.select.name,"Do");
 assert.equal(p["Task Level"].select.name,"子タスク");
 assert.equal(p["Parent Task"].relation[0].id,PARENT);
 assert.equal(p.Project.relation[0].id,PROJECT);
 assert.equal(p["Due Date"].date.start,"2026-10-20");
 assert.equal(p.Priority.select.name,"High");
 assert.equal(p["Since Do"].date.start,"2026-10-14T00:10:00.000Z");
 assert.equal(p["Triage Source"].select.name,"Manual (URL click)");
 assert.equal(p.Context.rich_text[0].text.content,"会議用の最新版を準備");
 assert.ok(!p["Inbox Page ID"],"direct creation must not pretend to be an Inbox move");
});

test("Waiting task receives JST waiting_since, optional Reminder Date, no Do timestamp",async()=>{
 let props;
 await withFetch(async(url,options)=>{
   assert.equal(url,"https://api.notion.com/v1/pages");
   props=JSON.parse(options.body).properties;
   return json({id:NEW_TASK});
 },async()=>{
   await createMobileTask(ENV,{
     name:"返事待ち",status:"Waiting",reminder_date:"2026-10-19",
     task_level:"子タスク"
   },new Date("2026-10-14T00:10:00.000Z"));
 });
 assert.equal(props["Waiting Since"].date.start,"2026-10-14");
 assert.equal(props["Reminder Date"].date.start,"2026-10-19");
 assert.ok(!props["Since Do"]);
 assert.ok(!props["Due Date"]);
 assert.ok(!props["Parent Task"]);
});
test("parent task and Someday task use appropriate level and stage dates",async()=>{
 const collected=[];
 await withFetch(async(url,options)=>{
   const p=JSON.parse(options.body).properties;
   collected.push(p);
   return json({id:NEW_TASK});
 },async()=>{
   await createMobileTask(ENV,{name:"案件の全体管理",status:"Do",task_level:"親タスク"});
   await createMobileTask(ENV,{name:"将来対応",status:"Someday"});
   await createMobileTask(ENV,{name:"考え中",status:"Thinking"});
 });
 assert.equal(collected[0]["Task Level"].select.name,"親タスク");
 assert.equal(collected[1]["Since Someday"].date.start.length,24);
 assert.ok(collected[2]["Since Thinking"]);
});
test("rejects invalid parent and project relationships before any creation",async()=>{
 let postCount=0;
 await withFetch(async(url,options)=>{
   if(options?.method==="POST"){postCount++;throw new Error("unexpected create");}
   if(url.endsWith("/pages/"+PARENT))return json(page(PARENT,TASKS,{
     "Task Level":{select:{name:"子タスク"}},
     Status:{select:{name:"Do"}}
   }));
   throw new Error("Unexpected "+url);
 },async()=>{
   await assert.rejects(
     createMobileTask(ENV,{name:"A",status:"Do",parent_task_id:PARENT}),
     e=>e instanceof MobileTaskCreateError && e.code==="invalid_parent_task");
 });
 await withFetch(async(url,options)=>{
   if(options?.method==="POST"){postCount++;throw new Error("unexpected create");}
   if(url.endsWith("/pages/"+PARENT))return json(parent());
   throw new Error("Unexpected "+url);
 },async()=>{
   await assert.rejects(
     createMobileTask(ENV,{name:"A",status:"Do",parent_task_id:PARENT,project_id:PROJECT2}),
     e=>e instanceof MobileTaskCreateError && e.code==="project_parent_mismatch");
 });
 assert.equal(postCount,0);
});
test("authenticated creation endpoint rejects wrong method, CSRF and invalid input",async()=>{
 const wrongMethod=await handleMobileApi(new Request(BASE+"/api/mobile/task/create",{
   method:"GET",headers:{"X-Shortcut-Token":ENV.SHORTCUT_TOKEN}
 }),ENV);
 assert.equal(wrongMethod.status,405);
 assert.equal((await handleMobileApi(request("/api/mobile/task/create",{name:"A",status:"Do"}),ENV)).status,401);
 const auth=await cookie();
 assert.equal((await handleMobileApi(request("/api/mobile/task/create",{name:"A",status:"Do"},
   {Cookie:auth,Origin:"https://evil.test"}),ENV)).status,403);
 assert.equal((await handleMobileApi(request("/api/mobile/task/create",{name:"",status:"Do"},
   {Cookie:auth}),ENV)).status,400);
 const raw=request("/api/mobile/task/create",{name:"A",status:"Do"},{Cookie:auth});
 assert.equal((await handleMobileApi(raw,ENV)).status,201===200?500:201); // overwritten by mock below
});
test("verified creation returns 201 and ID without silently writing again",async()=>{
 const auth=await cookie();
 const calls=[];
 await withFetch(async(url,options)=>{
   calls.push([url,options?.method||"GET"]);
   if(url==="https://api.notion.com/v1/pages" && options.method==="POST")
     return json({id:NEW_TASK,url:"https://www.notion.so/"+NEW_TASK},200);
   if(url.endsWith("/pages/"+NEW_TASK))
     return json(page(NEW_TASK,TASKS,{
       "名前":{title:[{plain_text:"タスクを追加"}]},
       Status:{select:{name:"Do"}}
     }));
   throw new Error("Unexpected "+url);
 },async()=>{
   const response=await handleMobileApi(request("/api/mobile/task/create",{
     name:"タスクを追加",status:"Do"
   },{Cookie:auth}),ENV);
   assert.equal(response.status,201);
   const data=await response.json();
   assert.equal(data.ok,true);
   assert.equal(data.id,NEW_TASK);
   assert.equal(data.verified,true);
 });
 assert.equal(calls.filter(x=>x[1]==="POST").length,1);
});
test("UI exposes a Task creation button and compiles with secure cookie auth",()=>{
 assert.doesNotThrow(()=>new vm.Script(clientJs));
 assert.ok(html.includes('id="new-task"'));
 assert.ok(clientJs.includes('id="create-task-form"'));
 assert.ok(clientJs.includes('/api/mobile/task/create'));
 assert.ok(clientJs.includes('/api/mobile/task/parents'));
 assert.ok(clientJs.includes('parent_task_id'));
 assert.ok(clientJs.includes('window.confirm('));
 assert.ok(clientJs.includes('credentials:"same-origin"'));
});
