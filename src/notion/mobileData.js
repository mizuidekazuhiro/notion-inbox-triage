import { readTaskSchedule, taskFocusState, dateKey } from "../utils/taskSchedule.js";
import { notionHeaders } from "./client.js";

const PAGE_SIZE = 100;
const MAX_PAGES = 10;
const UUID = /^[a-f0-9]{8}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{12}$/i;
const STATUS_CHOICES = Object.freeze(["Do", "Waiting", "Done", "Someday"]);
const MOVE_CHOICES = Object.freeze(["Do", "Waiting", "Someday", "Thinking", "Done", "Drop"]);

export function isUuid(value) {
  return typeof value === "string" && UUID.test(value);
}

export function pageBelongsToDatabase(page, databaseId) {
  if (!page || !databaseId || !isUuid(page.id)) return false;
  const a = (page.parent?.database_id || "").replaceAll("-", "").toLowerCase();
  const b = databaseId.replaceAll("-", "").toLowerCase();
  return a === b;
}

function titleOf(page, key) {
  const parts = page.properties?.[key]?.title || [];
  return parts.map(part => part.plain_text ?? part.text?.content ?? "").join("") || "無題";
}

async function notionPages(env, databaseId, body, maxPages = MAX_PAGES) {
  if (!env.NOTION_TOKEN || !isUuid(databaseId)) throw new Error("notion_configuration_missing");
  const results = [];
  let cursor;
  for (let n = 0; n < maxPages; n++) {
    const payload = {...body, page_size: PAGE_SIZE};
    if (cursor) payload.start_cursor = cursor;
    const response = await fetch("https://api.notion.com/v1/databases/" + databaseId + "/query", {
      method: "POST",
      headers: notionHeaders(env),
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error("notion_query_http_" + response.status);
    const data = await response.json();
    if (!Array.isArray(data.results)) throw new Error("notion_response_invalid");
    results.push(...data.results);
    if (!data.has_more) return {pages:results,truncated:false};
    if (!data.next_cursor || data.next_cursor === cursor) throw new Error("notion_cursor_invalid");
    cursor = data.next_cursor;
  }
  return {pages:results,truncated:true};
}

export async function listMobileInbox(env) {
  const result = await notionPages(env,env.INBOX_DB_ID,{
    filter:{and:[
      {property:"Processed",rich_text:{is_empty:true}},
      {property:"Processed At",date:{is_empty:true}}
    ]},
    sorts:[{property:"Created",direction:"descending"}]
  });
  return {
    items:result.pages.map(page=>({
      id:page.id,title:titleOf(page,"Name"),created:page.properties?.Created?.date?.start||page.created_time||"",
      url:page.url||""
    })),
    count:result.pages.length,truncated:result.truncated
  };
}

export async function listMobileProjects(env) {
  if (!env.PROJECTS_DB_ID) return {items:[],truncated:false};
  const result = await notionPages(env,env.PROJECTS_DB_ID,{
    filter:{or:[
      {property:"Status",select:{equals:"Active"}},
      {property:"Status",select:{equals:"Hold"}}
    ]}
  },5);
  return {items:result.pages.map(page=>{
    const titleProp=Object.entries(page.properties||{}).find(([,value])=>value.type==="title");
    const name=titleProp?titleOf(page,titleProp[0]):"無題";
    return {id:page.id,name};
  }).sort((a,b)=>a.name.localeCompare(b.name,"ja")),truncated:result.truncated};
}

function taskFromPage(page) {
  const p=page.properties||{};
  const parents=(p["Parent Task"]?.relation||[]).map(item=>item.id);
  const children=(p["Child Tasks"]?.relation||[]).map(item=>item.id);
  return {
    id:page.id,name:titleOf(page,"名前"),url:page.url||"",
    status:p.Status?.select?.name||"",
    task_level:p["Task Level"]?.select?.name||null,
    parent_id:parents[0]||null,parent_name:"",
    is_parent:p["Task Level"]?.select?.name==="親タスク"||children.length>0,
    children_count:children.length,
    priority:p.Priority?.select?.name||null,
    ...readTaskSchedule(p),
    blocked_by:(p["次のタスクにより保留中："]?.relation||[]).map(item=>item.id),
    reminder_date:dateKey(p["Reminder Date"]?.date?.start),
    waiting_since:dateKey(p["Waiting Since"]?.date?.start)
  };
}

export function sortMobileTasks(items) {
  const rank={High:0,Mid:1,Low:2};
  return [...items].sort((a,b)=>{
    const aa = a.due_date || "9999", bb = b.due_date || "9999";
    return aa.localeCompare(bb) || (rank[a.priority]??3)-(rank[b.priority]??3) ||
      a.name.localeCompare(b.name,"ja");
  });
}

export async function listMobileTasks(env) {
  const result=await notionPages(env,env.TASKS_DB_ID,{
    filter:{or:[
      {property:"Status",select:{equals:"Do"}},
      {property:"Status",select:{equals:"Waiting"}}
    ]}
  });
  const items=result.pages.map(taskFromPage);
  const knownPages=new Map(result.pages.map(page=>[page.id.replaceAll("-", ""),page]));
  const dependencyIds=[...new Set(items.flatMap(item=>item.blocked_by).filter(id=>!knownPages.has(id.replaceAll("-", ""))))];
  for(let i=0;i<dependencyIds.length;i+=5){
    await Promise.all(dependencyIds.slice(i,i+5).map(async id=>{
      try{const page=await getMobilePage(env,id);
        if(pageBelongsToDatabase(page,env.TASKS_DB_ID))knownPages.set(id.replaceAll("-", ""),page);
      }catch(_){ /* Unknown prerequisites stay blocked. */ }
    }));
  }
  const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
  for(const item of items){
    item.blocked_by=item.blocked_by.filter(id=>{
      const dependency=knownPages.get(id.replaceAll("-", ""));
      return !dependency || dependency.properties?.Status?.select?.name!=="Done";
    });
    item.focus_state=taskFocusState(item,today);
  }
  const knownNames=new Map(items.map(item=>[item.id,item.name]));
  const absentParentIds=[...new Set(items.map(item=>item.parent_id).filter(id=>id && !knownNames.has(id)))];
  // Avoid a burst of Notion requests if a large batch is imported.
  for (let i=0;i<absentParentIds.length;i+=5) {
    await Promise.all(absentParentIds.slice(i,i+5).map(async id=>{
      try{
        const page=await getMobilePage(env,id);
        if (pageBelongsToDatabase(page,env.TASKS_DB_ID)) knownNames.set(id,titleOf(page,"名前"));
      }catch(error){console.warn("mobile_parent_lookup_failed", String(error?.message||"error"));}
    }));
  }
  for(const item of items) if(item.parent_id) item.parent_name=knownNames.get(item.parent_id)||"親タスク";
  const sorted=sortMobileTasks(items);
  return {items:sorted,count:sorted.length,truncated:result.truncated};
}

export async function getMobilePage(env,id) {
  if(!isUuid(id) || !env.NOTION_TOKEN) throw new Error("invalid_page_id");
  const response=await fetch("https://api.notion.com/v1/pages/"+id,{headers:notionHeaders(env)});
  if(!response.ok) throw new Error("notion_page_http_"+response.status);
  return response.json();
}

export async function transitionMobileTask(env,id,from,to,now=new Date()) {
  if(!isUuid(id)||!["Do","Waiting"].includes(from)||!STATUS_CHOICES.includes(to)){
    return {ok:false,status:400,error:"invalid_transition"};
  }
  const page=await getMobilePage(env,id);
  if(!pageBelongsToDatabase(page,env.TASKS_DB_ID)){
    return {ok:false,status:403,error:"not_task_database"};
  }
  const current=page.properties?.Status?.select?.name;
  if(current!==from || !["Do","Waiting"].includes(current)){
    return {ok:false,status:409,error:"status_changed",current_status:current||null};
  }
  if(to===from) return {ok:true,changed:false,status:200,from,to};
  const nowIso=now.toISOString();
  const jstDate=new Date(now.getTime()+9*60*60*1000).toISOString().slice(0,10);
  const properties={Status:{select:{name:to}}};
  // Keep the existing due date, project, reminder, and parent-child relations intact.
  if(to==="Waiting") properties["Waiting Since"]={date:{start:jstDate}};
  if(to==="Do") properties["Since Do"]={date:{start:nowIso}};
  if(to==="Someday") properties["Since Someday"]={date:{start:nowIso}};
  if(to==="Done") properties["Done date"]={date:{start:nowIso}};
  const response=await fetch("https://api.notion.com/v1/pages/"+id,{
    method:"PATCH",headers:notionHeaders(env),
    body:JSON.stringify({properties})
  });
  if(!response.ok) throw new Error("notion_status_update_http_"+response.status);
  return {ok:true,changed:true,status:200,from,to};
}

export { STATUS_CHOICES, MOVE_CHOICES };
