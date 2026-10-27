import { getMobilePage, isUuid, pageBelongsToDatabase } from "./mobileData.js";
import { notionHeaders } from "./client.js";
import { readTaskSchedule, validSchedule, scheduleProperties } from "../utils/taskSchedule.js";

export async function updateMobileSchedule(env,input) {
  const allowed=["task_id","start_date","due_date","expected_revision"];
  if (!input || Object.keys(input).some(key=>!allowed.includes(key)) ||
      !isUuid(input.task_id) || !Object.hasOwn(input,"start_date") || !Object.hasOwn(input,"due_date") ||
      (input.start_date!==null && typeof input.start_date!=="string") ||
      (input.due_date!==null && typeof input.due_date!=="string") ||
      !validSchedule(input.start_date,input.due_date) ||
      typeof input.expected_revision!=="string" || input.expected_revision.length>1000) {
    return {ok:false,error:"invalid_schedule",status:400};
  }
  const page=await getMobilePage(env,input.task_id);
  if (!pageBelongsToDatabase(page,env.TASKS_DB_ID) || page.archived || page.in_trash)
    return {ok:false,error:"not_task_database",status:403};
  const current=readTaskSchedule(page.properties);
  if (current.schedule_revision!==input.expected_revision)
    return {ok:false,error:"schedule_changed",status:409};
  const start=input.start_date||null,due=input.due_date||null;
  if (start===current.start_date && due===current.due_date)
    return {ok:true,changed:false,verified:true,status:200};
  const properties=scheduleProperties(start,due,page.properties);
  const response=await fetch("https://api.notion.com/v1/pages/"+input.task_id,{
    method:"PATCH",headers:notionHeaders(env),body:JSON.stringify({properties})
  });
  if (!response.ok) throw new Error("notion_schedule_update_http_"+response.status);
  let verified=false;
  try {
    const after=await getMobilePage(env,input.task_id);
    const dates=readTaskSchedule(after.properties);
    verified=pageBelongsToDatabase(after,env.TASKS_DB_ID) &&
      dates.start_date===start && dates.due_date===due;
  } catch(_) {console.warn("mobile_schedule_verification_unavailable");}
  return {ok:true,changed:true,verified,status:200};
}
