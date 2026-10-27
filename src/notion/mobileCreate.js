import { validSchedule, scheduleProperties } from "../utils/taskSchedule.js";
import { notionHeaders } from "./client.js";
import { getMobilePage, isUuid, pageBelongsToDatabase } from "./mobileData.js";

const CREATE_STATUSES = Object.freeze(["Do","Waiting","Someday","Thinking"]);
const TASK_LEVELS = Object.freeze(["子タスク","親タスク"]);
const PRIORITIES = Object.freeze(["High","Mid","Low"]);
const ALLOWED_FIELDS = new Set([
  "name","status","task_level","priority","start_date","due_date","reminder_date",
  "project_id","parent_task_id","context"
]);
const TITLE_LIMIT=240;
const CONTEXT_LIMIT=1000;

export class MobileTaskCreateError extends Error {
  constructor(code,status=400){
    super(code);
    this.code=code;
    this.status=status;
  }
}
function filled(value) {return value!==null && value!==undefined && value!=="";}
function validDate(value){
  if(typeof value!=="string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const [y,m,d]=value.split("-").map(Number);
  if(y<2000||y>2100)return false;
  const dt=new Date(Date.UTC(y,m-1,d));
  return dt.getUTCFullYear()===y && dt.getUTCMonth()===m-1 && dt.getUTCDate()===d;
}
function titleOf(page) {
  return (page?.properties?.["名前"]?.title||[])
    .map(piece=>piece?.plain_text??piece?.text?.content??"").join("")||"無題";
}
function getProjectIds(page){
  return (page?.properties?.Project?.relation||[]).map(p=>p.id).filter(isUuid);
}

export function validMobileTaskCreate(input) {
  if(!input||typeof input!=="object"||Array.isArray(input))return false;
  if(Object.keys(input).some(key=>!ALLOWED_FIELDS.has(key)))return false;
  if(typeof input.name!=="string"||!input.name.trim()||
    input.name.trim().length>TITLE_LIMIT)return false;
  if(!CREATE_STATUSES.includes(input.status||"Do"))return false;
  const level=input.task_level||"子タスク";
  if(!TASK_LEVELS.includes(level))return false;
  if(filled(input.priority)&&!PRIORITIES.includes(input.priority))return false;
  if(!validSchedule(input.start_date,input.due_date))return false;
  if(filled(input.reminder_date)&&
    ((input.status||"Do")!=="Waiting"||!validDate(input.reminder_date)))return false;
  if(filled(input.project_id)&&!isUuid(input.project_id))return false;
  if(filled(input.parent_task_id)&&
    (level==="親タスク"||!isUuid(input.parent_task_id)))return false;
  if(filled(input.context)&&
    (typeof input.context!=="string"||input.context.length>CONTEXT_LIMIT))return false;
  return true;
}

export async function listMobileParentTasks(env) {
  if(!env.NOTION_TOKEN||!isUuid(env.TASKS_DB_ID)){
    throw new MobileTaskCreateError("notion_configuration_missing",503);
  }
  const items=[];
  let cursor=null;
  for(let i=0;i<10;i++){
    const query={
      page_size:100,
      filter:{property:"Task Level",select:{equals:"親タスク"}},
      sorts:[{property:"名前",direction:"ascending"}]
    };
    if(cursor)query.start_cursor=cursor;
    const response=await fetch(
      "https://api.notion.com/v1/databases/"+env.TASKS_DB_ID+"/query",
      {method:"POST",headers:notionHeaders(env),body:JSON.stringify(query)}
    );
    if(!response.ok)throw new MobileTaskCreateError("notion_parent_query_failed",502);
    const body=await response.json();
    if(!Array.isArray(body.results))throw new MobileTaskCreateError("notion_parent_query_failed",502);
    for(const page of body.results){
      const status=page.properties?.Status?.select?.name;
      if(page.archived||["Done","Drop"].includes(status))continue;
      if(!isUuid(page.id))continue;
      items.push({
        id:page.id,
        name:titleOf(page),
        project_id:getProjectIds(page)[0]||null
      });
    }
    if(!body.has_more)return {items,count:items.length,truncated:false};
    if(!body.next_cursor || body.next_cursor===cursor)
      throw new MobileTaskCreateError("notion_parent_query_failed",502);
    cursor=body.next_cursor;
  }
  return {items,count:items.length,truncated:true};
}

export async function createMobileTask(env,input,now=new Date()) {
  if(!validMobileTaskCreate(input)){
    throw new MobileTaskCreateError("invalid_task_create",400);
  }
  if(!env.NOTION_TOKEN||!isUuid(env.TASKS_DB_ID)){
    throw new MobileTaskCreateError("notion_configuration_missing",503);
  }

  const status=input.status||"Do";
  const taskLevel=input.task_level||"子タスク";
  let parent=null;
  let projectId=filled(input.project_id)?input.project_id:null;

  if(filled(input.parent_task_id)){
    parent=await getMobilePage(env,input.parent_task_id);
    if(!pageBelongsToDatabase(parent,env.TASKS_DB_ID)||
      parent.archived||
      parent.properties?.["Task Level"]?.select?.name!=="親タスク"||
      ["Done","Drop"].includes(parent.properties?.Status?.select?.name)){
      throw new MobileTaskCreateError("invalid_parent_task",400);
    }
    const parentProjects=getProjectIds(parent);
    if(projectId && parentProjects.length && !parentProjects.includes(projectId)){
      throw new MobileTaskCreateError("project_parent_mismatch",400);
    }
    if(!projectId && parentProjects.length)projectId=parentProjects[0];
  }
  if(projectId){
    const project=await getMobilePage(env,projectId);
    if(!pageBelongsToDatabase(project,env.PROJECTS_DB_ID)||project.archived){
      throw new MobileTaskCreateError("invalid_project",400);
    }
  }

  const iso=now.toISOString();
  const jstDate=new Date(now.getTime()+9*3600000).toISOString().slice(0,10);
  const props={
    "名前":{title:[{text:{content:input.name.trim()}}]},
    Status:{select:{name:status}},
    "Task Level":{select:{name:taskLevel}},
    "Triage Source":{select:{name:"Manual (URL click)"}},
    "Triage At":{date:{start:iso}}
  };
  if(status==="Do")props["Since Do"]={date:{start:iso}};
  if(status==="Waiting")props["Waiting Since"]={date:{start:jstDate}};
  if(status==="Someday")props["Since Someday"]={date:{start:iso}};
  if(status==="Thinking")props["Since Thinking"]={date:{start:iso}};
  if(filled(input.priority))props.Priority={select:{name:input.priority}};
  if(filled(input.start_date)||filled(input.due_date)){
    const dates=scheduleProperties(input.start_date||null,input.due_date||null);
    // Omit empty Start Date on legacy deadline-only submissions.
    if(input.start_date)props["Start Date"]=dates["Start Date"];
    if(input.due_date)props["Due Date"]=dates["Due Date"];
  }
  if(status==="Waiting"&&filled(input.reminder_date)){
    props["Reminder Date"]={date:{start:input.reminder_date}};
  }
  if(projectId)props.Project={relation:[{id:projectId}]};
  if(parent)props["Parent Task"]={relation:[{id:parent.id}]};
  if(filled(input.context)&&input.context.trim()){
    props.Context={rich_text:[{text:{content:input.context.trim()}}]};
  }
  const response=await fetch("https://api.notion.com/v1/pages",{
    method:"POST",
    headers:notionHeaders(env),
    body:JSON.stringify({parent:{database_id:env.TASKS_DB_ID},properties:props})
  });
  if(!response.ok){
    console.error("mobile_task_create_http_"+response.status);
    throw new MobileTaskCreateError("notion_task_create_failed",502);
  }
  const created=await response.json();
  if(!isUuid(created.id)){
    throw new MobileTaskCreateError("created_task_id_unconfirmed",502);
  }
  return {
    id:created.id, name:input.name.trim(), status,
    task_level:taskLevel,parent_id:parent?.id||null,
    project_id:projectId,url:created.url||""
  };
}
