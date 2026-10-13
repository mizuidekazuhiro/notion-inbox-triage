import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { mintSessionCookie, verifySession, clearSessionCookie, SESSION_COOKIE, SESSION_TTL_SECONDS } from "../src/mobile/session.js";
import { handleMobileApi } from "../src/routes/mobileApp.js";
import { clientJs } from "../src/mobile/client.js";
import { html } from "../src/mobile/shell.js";

const env={
  NOTION_TOKEN:"notion-access-token-placeholder",
  SHORTCUT_TOKEN:"long-existing-widget-token",
  ACTION_SECRET:"long-existing-action-signature-secret",
  INBOX_DB_ID:"2e2dec27c9aa809d82f0db2ca819140c",
  TASKS_DB_ID:"2e1dec27c9aa808a8e8dd8c09955e4a1"
};
const base="https://example.test";
const origin={"Origin":base,"X-Notion-Flow":"1"};
const cookieOf=header=>header.split(";")[0];
async function openSession(){
 const request=new Request(base+"/api/mobile/session/start",{
  method:"POST",
  headers:{"X-Shortcut-Token":env.SHORTCUT_TOKEN,...origin,"Content-Type":"application/json"},
  body:"{}"
 });
 const response=await handleMobileApi(request,env);
 assert.equal(response.status,200);
 const raw=response.headers.get("Set-Cookie");
 assert.ok(raw,"must return a session cookie");
 return {raw,cookie:cookieOf(raw),body:await response.json()};
}
test("Cookie remains signed, host-only, secure, inaccessible to JS, Strict, and 30-day bound",async()=>{
 const {raw,cookie}=await openSession();
 assert.match(raw,/__Host-nf_session=v1\./);
 assert.match(raw,/; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000/);
 assert.equal(raw.includes("Domain="),false);
 assert.ok(!raw.includes(env.SHORTCUT_TOKEN),"raw Shortcut token never appears in cookie");
 const valid=await verifySession(new Request(base+"/api/mobile/session",{headers:{Cookie:cookie}}),env);
 assert.ok(valid && valid.remaining>SESSION_TTL_SECONDS-120);
});
test("Cookie signature tampering, expiry and secret rotation block authentication",async()=>{
 const now=Date.parse("2026-10-14T02:00:00.000Z");
 const raw=await mintSessionCookie(env,now);
 const cookie=cookieOf(raw);
 const verify=(value,e=env,t=now+1000)=>verifySession(new Request(base+"/api/mobile/session",{headers:{Cookie:value}}),e,t);
 assert.ok(await verify(cookie));
 assert.equal(await verify(cookie,env,now+(SESSION_TTL_SECONDS+1)*1000),null);
 assert.equal(await verify(cookie,{...env,SHORTCUT_TOKEN:"rotated-secret"}),null);
 assert.equal(await verify(cookie,{...env,ACTION_SECRET:"rotated-secret"}),null);
 const [name,value]=cookie.split("=");
 const parts=value.split(".");
 parts[3]="f".repeat(64);
 assert.equal(await verify(name+"="+parts.join(".")),null);
 assert.equal(await verify(SESSION_COOKIE+"="+value.slice(0,15)),null);
 const expParts=value.split(".");
 expParts[1]=String(Math.floor(now/1000)+SESSION_TTL_SECONDS*3);
 assert.equal(await verify(name+"="+expParts.join(".")),null);
});
test("Resume sends no reentry request and provides session renewal near expiry",async()=>{
 const current=Date.now();
 const from=current-(SESSION_TTL_SECONDS-1800)*1000;
 const oldCookie=cookieOf(await mintSessionCookie(env,from));
 const response=await handleMobileApi(new Request(base+"/api/mobile/session",{
  headers:{Cookie:oldCookie}
 }),env);
 assert.equal(response.status,200);
 assert.equal((await response.json()).authenticated,true);
 assert.ok(response.headers.get("Set-Cookie"),"extend session near expiry");
 const freshCookie=(await openSession()).cookie;
 const freshResponse=await handleMobileApi(new Request(base+"/api/mobile/session",{
  headers:{Cookie:freshCookie}
 }),env);
 assert.equal(freshResponse.status,200);
 assert.equal(freshResponse.headers.get("Set-Cookie"),null,"do not renew brand-new sessions");
});
test("Mobile Inbox API accepts first-party Cookie but does not allow unauthenticated access",async()=>{
 const {cookie}=await openSession();
 const request=new Request(base+"/api/mobile/inbox",{headers:{Cookie:cookie}});
 const original=global.fetch;let calls=0;
 global.fetch=async(url,options)=>{
  calls++;
  assert.match(url,/api\.notion\.com/);
  assert.equal(options.method,"POST");
  return new Response(JSON.stringify({results:[],has_more:false}),{status:200});
 };
 try{
  const response=await handleMobileApi(request,env);
  assert.equal(response.status,200);
  assert.equal((await response.json()).count,0);
  assert.equal(calls,1);
  assert.equal((await handleMobileApi(new Request(base+"/api/mobile/inbox"),env)).status,401);
 }finally{global.fetch=original;}
});
test("Cookie-based writes require Origin and anti-CSRF header",async()=>{
 const {cookie}=await openSession();
 const payload=JSON.stringify({task_id:"8e8dec27c9aa809d82f0db2ca819140c",expected_status:"Do",to:"Done"});
 const request=h=>new Request(base+"/api/mobile/task/status",{
  method:"POST",headers:{"Content-Type":"application/json",Cookie:cookie,...h},body:payload
 });
 assert.equal((await handleMobileApi(request({"X-Notion-Flow":"1"}),env)).status,403);
 assert.equal((await handleMobileApi(request({"Origin":base}),env)).status,403);
 assert.equal((await handleMobileApi(request({"Origin":"https://evil.test","X-Notion-Flow":"1"}),env)).status,403);
 const allowed=request({...origin});
 const original=global.fetch;
 let count=0;
 global.fetch=async(_url,options)=>{
  count++;
  if(options?.method==="PATCH")return new Response(JSON.stringify({id:"test"}),{status:200});
  return new Response(JSON.stringify({id:"8e8dec27c9aa809d82f0db2ca819140c",parent:{database_id:env.TASKS_DB_ID},
    properties:{Status:{select:{name:count===1?"Do":"Done"}}}}),{status:200});
 };
 try{
  const reply=await handleMobileApi(allowed,env);
  assert.equal(reply.status,200);
  const json=await reply.json();
  assert.equal(json.ok,true);
  assert.equal(json.verified,true);
  assert.ok(count>=3);
 } finally{global.fetch=original;}
});
test("Explicit logout clears cookie and rejects cross-site logout requests",async()=>{
 const {cookie}=await openSession();
 const cross=new Request(base+"/api/mobile/session/logout",{
  method:"POST",headers:{Cookie:cookie,Origin:"https://evil.test","X-Notion-Flow":"1"}
 });
 assert.equal((await handleMobileApi(cross,env)).status,403);
 const response=await handleMobileApi(new Request(base+"/api/mobile/session/logout",{
  method:"POST",headers:{Cookie:cookie,...origin}
 }),env);
 assert.equal(response.status,200);
 assert.match(response.headers.get("Set-Cookie"),/Max-Age=0/);
 assert.match(clearSessionCookie(),/Max-Age=0/);
});
test("Browser client no longer persists the shortcut token in sessionStorage/localStorage",()=>{
 assert.doesNotThrow(()=>new vm.Script(clientJs));
 assert.match(clientJs,/credentials:"same-origin"/);
 assert.match(clientJs,/api\/mobile\/session\/start/);
 assert.match(clientJs,/api\/mobile\/session\/logout/);
 assert.match(clientJs,/api\/mobile\/session/);
 assert.doesNotMatch(clientJs,/sessionStorage\.setItem\(storeKey/);
 assert.doesNotMatch(clientJs,/localStorage\./);
 assert.match(clientJs,/state\.token="";state\.loggedIn=true/);
 assert.match(html,/安全なCookieで保持/);
});
