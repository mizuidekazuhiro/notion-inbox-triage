import { html, css, manifest, serviceWorker } from "../mobile/shell.js";
import { clientJs } from "../mobile/client.js";
import { mobileSvgIcon, mobilePngIcon } from "../mobile/icon.js";
import { notionHeaders } from "../notion/client.js";
import {
  listMobileInbox, listMobileProjects, listMobileTasks, getMobilePage,
  isUuid, pageBelongsToDatabase, transitionMobileTask, MOVE_CHOICES
} from "../notion/mobileData.js";
import { handleMoveCore } from "./move.js";
import { jsonResponse } from "../utils/http.js";
import { safeEqual } from "../utils/signature.js";

const MIME = Object.freeze({
  "/mobile":"text/html; charset=UTF-8",
  "/mobile/":"text/html; charset=UTF-8",
  "/mobile/styles.css":"text/css; charset=UTF-8",
  "/mobile/client.js":"application/javascript; charset=UTF-8",
  "/mobile/manifest.webmanifest":"application/manifest+json",
  "/mobile/sw.js":"application/javascript; charset=UTF-8"
});
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; manifest-src 'self'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'; form-action 'none'; upgrade-insecure-requests";
const MAX_BODY_BYTES = 4096;

function protectedJson(data, code=200) {
 const response=jsonResponse(data,code);
 response.headers.set("X-Content-Type-Options","nosniff");
 response.headers.set("Referrer-Policy","no-referrer");
 return response;
}
function requireMobileAuth(request,env) {
 if(!env.SHORTCUT_TOKEN) return protectedJson({ok:false,error:"server_token_missing"},503);
 const provided=request.headers.get("X-Shortcut-Token")||"";
 if(!provided||!safeEqual(provided,env.SHORTCUT_TOKEN)){
  return protectedJson({ok:false,error:"unauthorized"},401);
 }
 return null;
}
function writeOriginAllowed(request) {
 const url=new URL(request.url);
 const origin=request.headers.get("Origin");
 if(origin && origin!==url.origin) return false;
 const site=request.headers.get("Sec-Fetch-Site");
 return !site||site==="same-origin"||site==="none";
}
async function bodyJson(request) {
 if(!String(request.headers.get("Content-Type")||"").toLowerCase().startsWith("application/json")){
   throw new Error("content_type_invalid");
 }
 const len=Number(request.headers.get("Content-Length")||0);
 if(len>MAX_BODY_BYTES) throw new Error("payload_too_large");
 const text=await request.text();
 if(text.length>MAX_BODY_BYTES) throw new Error("payload_too_large");
 let obj;try{obj=JSON.parse(text);}catch(_){throw new Error("invalid_json");}
 if(!obj||typeof obj!=="object"||Array.isArray(obj))throw new Error("invalid_json");
 return obj;
}
function validDate(value){
 if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const [y,m,d]=value.split("-").map(Number);
 const utc=new Date(Date.UTC(y,m-1,d));
 return y>=2000&&y<=2100&&utc.getUTCFullYear()===y&&utc.getUTCMonth()+1===m&&utc.getUTCDate()===d;
}
function validMoveRequest(data) {
 if(!isUuid(data.inbox_page_id)||!MOVE_CHOICES.includes(data.status))return false;
 if(data.priority!=null&&!["","High","Mid","Low"].includes(data.priority))return false;
 for(const name of ["due_date","reminder_date"]){
  if(data[name]!=null&&!validDate(data[name]))return false;
 }
 if(data.project_id!=null&&data.project_id!==""&&!isUuid(data.project_id))return false;
 return true;
}
function parseError(error){
 const msg=String(error?.message||"");
 return msg.startsWith("notion_")?"notion_unavailable":"internal_error";
}

export async function handleMobileAsset(request) {
 if(request.method!=="GET"&&request.method!=="HEAD")
  return new Response("Method Not Allowed",{status:405});
 const url=new URL(request.url),path=url.pathname;
 if(path==="/mobile/icon.svg")return mobileSvgIcon();
 if(path==="/mobile/icon.png"){
  const size=Number(url.searchParams.get("size")||180);
  return mobilePngIcon(size);
 }
 const content=path==="/mobile"||path==="/mobile/"?html:
   path==="/mobile/styles.css"?css:
   path==="/mobile/client.js"?clientJs:
   path==="/mobile/manifest.webmanifest"?manifest:
   path==="/mobile/sw.js"?serviceWorker:null;
 if(content===null)return new Response("Not Found",{status:404});
 const response=new Response(request.method==="HEAD"?null:content,{
  headers:{
   "Content-Type":MIME[path]||"text/plain; charset=UTF-8",
   "Cache-Control":path==="/mobile"||path==="/mobile/"?"no-store":"public,max-age=300",
   "X-Content-Type-Options":"nosniff",
   "Referrer-Policy":"no-referrer",
   "Strict-Transport-Security":"max-age=31536000",
   "Content-Security-Policy":CSP,
   "Permissions-Policy":"camera=(),microphone=(),geolocation=()"
  }
 });
 if(path==="/mobile/sw.js")response.headers.set("Service-Worker-Allowed","/mobile");
 return response;
}

export async function handleMobileApi(request,env) {
 const path=new URL(request.url).pathname;
 const known={
  "/api/mobile/inbox":"GET",
  "/api/mobile/tasks":"GET",
  "/api/mobile/projects":"GET",
  "/api/mobile/inbox/move":"POST",
  "/api/mobile/task/status":"POST"
 };
 if(!Object.hasOwn(known,path))return protectedJson({ok:false,error:"not_found"},404);
 if(request.method!==known[path])return protectedJson({ok:false,error:"method_not_allowed"},405);
 const auth=requireMobileAuth(request,env);
 if(auth)return auth;
 if(request.method==="POST"&&!writeOriginAllowed(request))
  return protectedJson({ok:false,error:"origin_forbidden"},403);
 try {
  if(path==="/api/mobile/inbox")return protectedJson({ok:true,...await listMobileInbox(env)});
  if(path==="/api/mobile/tasks")return protectedJson({ok:true,...await listMobileTasks(env)});
  if(path==="/api/mobile/projects")return protectedJson({ok:true,...await listMobileProjects(env)});
  let data;try{data=await bodyJson(request);}
  catch(_){return protectedJson({ok:false,error:"invalid_payload"},400);}
  if(path==="/api/mobile/inbox/move"){
   if(!validMoveRequest(data))return protectedJson({ok:false,error:"invalid_move"},400);
   const source=await getMobilePage(env,data.inbox_page_id);
   if(!pageBelongsToDatabase(source,env.INBOX_DB_ID))
     return protectedJson({ok:false,error:"not_inbox_database"},403);
   if(source.properties?.Processed?.rich_text?.length || source.properties?.["Processed At"]?.date?.start)
     return protectedJson({ok:false,error:"already_processed"},409);
   if(data.project_id){
    const project=await getMobilePage(env,data.project_id);
    if(!pageBelongsToDatabase(project,env.PROJECTS_DB_ID))
      return protectedJson({ok:false,error:"invalid_project"},400);
   }
   const result=await handleMoveCore({
    env,pageId:data.inbox_page_id,status:data.status,
    priority:data.status==="Do"?(data.priority||null):null,
    dueDate:data.status==="Do"?(data.due_date||null):null,
    reminderDate:data.status==="Waiting"?(data.reminder_date||null):null,
    projectId:data.status==="Do"?(data.project_id||null):null,
    baseUrl:new URL(request.url).origin,responseMode:"json"
   });
   let detail={};try{detail=await result.json();}catch(_){}
   if(!result.ok || !detail.ok) {
    const code=result.status===409?409:502;
    return protectedJson({ok:false,error:code===409?"already_processed":"move_failed"},code);
   }
   // The existing move routine may return before checking the final Processed At write.
   const changed=await getMobilePage(env,data.inbox_page_id);
   const verified=!!changed.properties?.["Processed At"]?.date?.start;
   return protectedJson({ok:true,verified,created_task_id:detail.created_task_id,
      moved_to:data.status,undo_url:detail.undo_url||null});
  }
  if(path==="/api/mobile/task/status"){
   const result=await transitionMobileTask(env,data.task_id,data.expected_status,data.to);
   if(!result.ok)return protectedJson({ok:false,error:result.error,current_status:result.current_status||null},result.status);
   const changed=await getMobilePage(env,data.task_id);
   const verified=changed.properties?.Status?.select?.name===data.to;
   return protectedJson({ok:true,verified,changed:result.changed,from:result.from,to:result.to});
  }
 } catch(error) {
  console.error("mobile_app_error",parseError(error));
  return protectedJson({ok:false,error:"notion_unavailable"},502);
 }
 return protectedJson({ok:false,error:"not_found"},404);
}

export {validDate,validMoveRequest,writeOriginAllowed,requireMobileAuth,bodyJson};
