import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { clientJs } from "../src/mobile/client.js";
import { html, css, serviceWorker } from "../src/mobile/shell.js";

class Element {
 constructor() {
  this.children=[];this.handlers={};this.dataset={};this.hidden=false;
  this.disabled=false;this.checked=false;this.style={};this.value="";
  this.textContent="";this.attributes={};
  this.classList={add(){},toggle(){}};
 }
 append(...children){this.children.push(...children);}
 replaceChildren(...children){this.children=[...children];}
 addEventListener(type,fn){(this.handlers[type]??=[]).push(fn);}
 setAttribute(key,value){this.attributes[key]=value;}
 removeAttribute(key){delete this.attributes[key];}
 focus(){}
 querySelectorAll(){return [];}
 async trigger(type){
  for(const fn of this.handlers[type]||[])await fn({preventDefault(){}});
 }
}
const inbox=[
 {id:"11111111111111111111111111111111",title:"見積資料を整理"},
 {id:"22222222222222222222222222222222",title:"連絡を確認"},
 {id:"33333333333333333333333333333333",title:"提案を検討"}
];
const project={id:"44444444444444444444444444444444",name:"管理改善"};
const response=(payload,status=200)=>new Response(JSON.stringify(payload),{
 status,headers:{"Content-Type":"application/json"}
});
async function until(predicate){
 for(let i=0;i<200;i++){
  if(predicate())return;
  await new Promise(resolve=>setImmediate(resolve));
 }
 throw Error("UI did not settle");
}
function browser(mode="verified"){
 const elements=new Map();
 const el=id=>{
  if(!elements.has(id))elements.set(id,new Element());
  return elements.get(id);
 };
 const tabs=["inbox","tasks"].map(tab=>{
  const node=new Element();node.dataset.tab=tab;return node;
 });
 const calls=[],confirmations=[];
 el("inbox-bulk-target").value="Do";
 const document={
  getElementById:el,
  createElement:()=>new Element(),
  querySelectorAll(selector){return selector==="[data-tab]"?tabs:[];},
  querySelector:()=>new Element(),
  addEventListener(){},
  body:new Element()
 };
 const fetch=async(path,options={})=>{
  if(path==="/api/mobile/session")return response({ok:true});
  if(path==="/api/mobile/inbox")return response({ok:true,items:inbox});
  if(path==="/api/mobile/tasks?scope=all")return response({ok:true,items:[]});
  if(path==="/api/mobile/projects")return response({ok:true,items:[project]});
  if(path==="/api/mobile/inbox/move"){
   calls.push(JSON.parse(options.body));
   if(mode==="conflict")return response({ok:false,error:"already_processed"},409);
   return response({ok:true,verified:mode!=="unverified",
    created_task_id:"55555555555555555555555555555555"});
  }
  throw Error("Unexpected fetch "+path);
 };
 const window={
  location:{search:""},
  confirm(message){confirmations.push(message);return mode!=="cancel";}
 };
 new vm.Script(clientJs).runInNewContext({
  document,window,fetch,navigator:{},sessionStorage:{removeItem(){}},
  URL,URLSearchParams,console
 },{timeout:2000});
 return {el,tabs,calls,confirmations};
}
async function ready(mode){
 const app=browser(mode);
 await until(()=>app.el("inbox-list").children.length===3);
 return app;
}

test("Inbox PWA exposes bulk controls and retains the single-item action outside bulk mode",async()=>{
 assert.match(html,/id="inbox-bulk-toggle"/);
 assert.match(html,/id="inbox-bulk-select-all"/);
 assert.match(html,/id="inbox-bulk-target"/);
 assert.match(html,/value="Thinking"/);
 assert.match(html,/value="Drop"/);
 assert.match(css,/\.inbox-bulk-actions/);
 assert.match(serviceWorker,/notion-flow-shell-v4-inbox-bulk/);
 const app=await ready();
 assert.equal(app.el("inbox-bulk-actions").hidden,true);
 assert.equal(app.el("inbox-list").children[0].children.length,3);
 await app.el("inbox-bulk-toggle").trigger("click");
 assert.equal(app.el("inbox-bulk-actions").hidden,false);
 assert.equal(app.el("inbox-list").children[0].children.length,2);
 assert.equal(app.el("inbox-bulk-apply").disabled,true);
});

test("Inbox bulk selection writes only selected IDs with common Do options",async()=>{
 const app=await ready();
 await app.el("inbox-bulk-toggle").trigger("click");
 const first=app.el("inbox-list").children[0].children[0];
 first.checked=true;
 await first.trigger("change");
 assert.equal(app.el("inbox-bulk-count").textContent,"1件選択");
 await app.el("inbox-bulk-select-all").trigger("click");
 assert.equal(app.el("inbox-bulk-count").textContent,"3件選択");
 // Unselect the third row to verify there is no implicit all-items write.
 await app.el("inbox-list").children[2].children[1].trigger("click");
 assert.equal(app.el("inbox-bulk-count").textContent,"2件選択");
 app.el("inbox-bulk-priority").value="High";
 app.el("inbox-bulk-due").value="2026-11-15";
 app.el("inbox-bulk-project").value=project.id;
 await app.el("inbox-bulk-apply").trigger("click");
 await until(()=>app.el("status-line").textContent.includes("2/2 件の完了を確認"));
 assert.equal(app.calls.length,2);
 assert.deepEqual(app.calls.map(x=>x.inbox_page_id),inbox.slice(0,2).map(x=>x.id));
 assert.deepEqual(app.calls.map(x=>x.status),["Do","Do"]);
 assert.ok(app.calls.every(x=>x.priority==="High"&&x.due_date==="2026-11-15"&&x.project_id===project.id));
 assert.ok(app.confirmations[0].includes("2 件を Do"));
 assert.equal(app.el("inbox-bulk-actions").hidden,true);
 assert.equal(app.el("inbox-bulk-count").textContent,"0件選択");
});

test("Waiting bulk move shows reminder field without leaking stale Do properties",async()=>{
 const app=await ready();
 await app.el("inbox-bulk-toggle").trigger("click");
 await app.el("inbox-bulk-select-all").trigger("click");
 app.el("inbox-bulk-target").value="Waiting";
 await app.el("inbox-bulk-target").trigger("change");
 assert.equal(app.el("inbox-bulk-do-fields").hidden,true);
 assert.equal(app.el("inbox-bulk-waiting-fields").hidden,false);
 app.el("inbox-bulk-priority").value="High";
 app.el("inbox-bulk-reminder").value="2026-11-20";
 await app.el("inbox-bulk-apply").trigger("click");
 await until(()=>app.el("status-line").textContent.includes("3/3 件の完了を確認"));
 assert.equal(app.calls.length,3);
 assert.ok(app.calls.every(x=>x.status==="Waiting"&&x.reminder_date==="2026-11-20"));
 assert.ok(app.calls.every(x=>!Object.hasOwn(x,"priority")&&!Object.hasOwn(x,"project_id")&&!Object.hasOwn(x,"due_date")));
});

test("unverified Inbox move stops all subsequent writes and clears selection",async()=>{
 const app=await ready("unverified");
 await app.el("inbox-bulk-toggle").trigger("click");
 await app.el("inbox-bulk-select-all").trigger("click");
 await app.el("inbox-bulk-apply").trigger("click");
 await until(()=>app.el("status-line").textContent.includes("移動後の結果を確認できません"));
 assert.equal(app.calls.length,1);
 assert.ok(app.el("status-line").textContent.includes("0/3 件の完了を確認"));
 assert.equal(app.el("inbox-bulk-actions").hidden,true);
});

test("409 conflict stops without retrying any Inbox move",async()=>{
 const app=await ready("conflict");
 await app.el("inbox-bulk-toggle").trigger("click");
 await app.el("inbox-bulk-select-all").trigger("click");
 await app.el("inbox-bulk-apply").trigger("click");
 await until(()=>app.el("status-line").textContent.includes("途中停止"));
 assert.equal(app.calls.length,1);
 assert.ok(app.el("status-line").textContent.includes("Notionを確認"));
});

test("cancelled confirmation performs no mutation",async()=>{
 const app=await ready("cancel");
 await app.el("inbox-bulk-toggle").trigger("click");
 await app.el("inbox-bulk-select-all").trigger("click");
 await app.el("inbox-bulk-apply").trigger("click");
 assert.equal(app.calls.length,0);
 assert.equal(app.el("inbox-bulk-count").textContent,"3件選択");
});

test("switching away from Inbox restores normal item buttons as well as clearing selection",async()=>{
 const app=await ready();
 await app.el("inbox-bulk-toggle").trigger("click");
 await app.el("inbox-bulk-select-all").trigger("click");
 assert.equal(app.el("inbox-list").children[0].children.length,2,"bulk row has checkbox and button");
 await app.tabs[1].trigger("click");
 assert.equal(app.el("inbox-bulk-count").textContent,"0件選択");
 assert.equal(app.el("inbox-bulk-actions").hidden,true);
 assert.equal(app.el("inbox-list").children[0].children.length,3,"normal single-item button restored");
 await app.tabs[0].trigger("click");
 await app.el("inbox-list").children[0].trigger("click");
 assert.equal(app.el("modal").hidden,false,"individual Inbox action must still open");
});
