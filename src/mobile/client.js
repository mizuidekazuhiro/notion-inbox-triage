export const clientJs = `
"use strict";
(function(){
const $ = id => document.getElementById(id);
const storeKey = "notion_flow_session_token";
const state = {token:"",inbox:[],tasks:[],projects:[],tab:"inbox",filter:"all",busy:false};
const labels = {Do:"Do · 実行",Waiting:"Waiting · 相手待ち",Done:"Done · 完了",Someday:"Someday · いつか",Thinking:"Thinking · 検討",Drop:"Drop · 取下げ"};
const MOVE = ["Do","Waiting","Someday","Thinking","Done","Drop"];
const NEXT = ["Done","Waiting","Do","Someday"];

function node(tag,className,text){
 const n=document.createElement(tag);
 if(className)n.className=className;
 if(text!==undefined)n.textContent=text;
 return n;
}
function clear(n){n.replaceChildren();}
function show(el,value){el.hidden=!value;}
function status(text){$("status-line").textContent=text||"";}
function safeDate(s){
 if(!s)return "期限なし";
 const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(s);
 return m?Number(m[2])+"/"+Number(m[3]):"期限なし";
}
function warning(message){
 const n=node("div","warning",message);
 return n;
}
function isTrustedNotion(url){
 try{const u=new URL(url);return u.protocol==="https:"&&(u.hostname==="notion.so"||u.hostname==="www.notion.so"||u.hostname==="app.notion.com");}
 catch(_){return false;}
}
function notionLink(url){
 if(!isTrustedNotion(url))return null;
 const a=node("a","detail-link","Notionで開く ↗");a.href=url;a.target="_blank";a.rel="noopener noreferrer";return a;
}
async function api(path,method,payload){
 if(!state.token)throw new Error("接続してください");
 const headers={"X-Shortcut-Token":state.token,"Accept":"application/json"};
 if(method==="POST")headers["Content-Type"]="application/json";
 let response;
 try{response=await fetch(path,{method:method||"GET",headers,body:payload?JSON.stringify(payload):undefined,cache:"no-store",credentials:"omit"});}
 catch(_){throw new Error("通信に失敗しました。接続を確認してください");}
 let data={};
 try{data=await response.json();}catch(_){}
 if(!response.ok||data.ok===false){
  if(response.status===401){
   logout();
   throw new Error("認証キーを確認してください");
  }
  if(response.status===409)throw new Error("他の端末で更新されています。一覧を更新してください");
  if(response.status===400)throw new Error("入力内容を確認してください");
  throw new Error(data.error==="notion_unavailable"?"Notionに接続できません":"処理できませんでした（HTTP "+response.status+"）");
 }
 return data;
}
function setBusy(value){
 state.busy=value;
 $("refresh").disabled=value;
 const buttons=document.querySelectorAll(".modal .primary");
 buttons.forEach(b=>b.disabled=value);
}
function openDialog(kicker,title,description,build){
 $("modal-kicker").textContent=kicker;
 $("modal-title").textContent=title;
 $("modal-description").textContent=description||"";
 clear($("modal-body"));
 build($("modal-body"));
 show($("modal"),true);
 document.body.style.overflow="hidden";
}
function closeDialog(){
 if(state.busy)return;
 show($("modal"),false);
 document.body.style.overflow="";
}
function selectButton(target,statusValue){
 target.classList.add("choice-grid");
 const buttons=[];
 const options=MOVE;
 for(const choice of options){
  const b=node("button","choice",labels[choice]||choice);
  b.type="button";
  if(choice===statusValue)b.classList.add("selected");
  b.addEventListener("click",()=>{
   buttons.forEach(other=>other.classList.toggle("selected",other===b));
   target.dataset.choice=choice;
  });
  buttons.push(b);target.append(b);
 }
 target.dataset.choice=statusValue;
}
function inputRow(parent,name,label,type,value){
 const l=node("label",null,label);l.htmlFor=name;parent.append(l);
 const inp=node("input");inp.id=name;inp.name=name;inp.type=type;
 if(value)inp.value=value;
 parent.append(inp);return inp;
}
function refreshUI(){
 renderInbox();renderTasks();
 $("inbox-count").textContent=String(state.inbox.length);
 $("task-count").textContent=String(state.tasks.length);
}
async function reload(){
 setBusy(true);status("Notionと同期中…");
 try{
   const answers=await Promise.allSettled([
     api("/api/mobile/inbox"),
     api("/api/mobile/tasks"),
     api("/api/mobile/projects")
   ]);
   let failures=0;
   if(answers[0].status==="fulfilled"){state.inbox=answers[0].value.items||[];}
   else failures++;
   if(answers[1].status==="fulfilled"){state.tasks=answers[1].value.items||[];}
   else failures++;
   if(answers[2].status==="fulfilled")state.projects=answers[2].value.items||[];
   if(!state.token)return;
   refreshUI();
   const count=answers.filter(a=>a.status==="fulfilled").length;
   const truncated=answers.some(a=>a.status==="fulfilled"&&a.value.truncated);
   status(failures?"一部取得できませんでした。更新で再試行してください":(truncated?"上限を超えたデータがあります。確認してください":"Notionと同期済み"));
   if(count===0)throw new Error("Notionデータの取得に失敗しました");
 }finally{setBusy(false);}
}
async function login(event){
 if(event)event.preventDefault();
 const value=$("access-key").value.trim();
 if(!value)return;
 state.token=value;setBusy(true);status("接続を確認中…");
 try{
   const result=await api("/api/mobile/inbox");
   state.inbox=result.items||[];
   try{sessionStorage.setItem(storeKey,value);}catch(_){}
   $("access-key").value="";
   show($("auth"),false);show($("dashboard"),true);show($("lock"),true);
   await reload();
 }catch(error){
   if(state.token&&!$("dashboard").hidden){status(error.message);}
   else{state.token="";try{sessionStorage.removeItem(storeKey);}catch(_){}
      status(error.message);$("access-key").focus();}
 }finally{setBusy(false);}
}
function logout(){
 state.token="";state.inbox=[];state.tasks=[];state.projects=[];
 try{sessionStorage.removeItem(storeKey);}catch(_){}
 show($("dashboard"),false);show($("auth"),true);show($("lock"),false);
 if(!$("modal").hidden){state.busy=false;closeDialog();}
 status("接続を解除しました");
}
function setTab(tab){
 state.tab=tab;
 document.querySelectorAll("[data-tab]").forEach(b=>{
  const selected=b.dataset.tab===tab;b.classList.toggle("selected",selected);
  if(selected)b.setAttribute("aria-current","page");else b.removeAttribute("aria-current");
 });
 show($("inbox-panel"),tab==="inbox");show($("tasks-panel"),tab==="tasks");
}
function row(title,description,symbol,side,handler){
 const button=node("button","item");button.type="button";
 const icon=node("span","item-symbol",symbol);icon.setAttribute("aria-hidden","true");button.append(icon);
 const info=node("div","item-text");
 info.append(node("span","item-title",title),node("span","item-meta",description));
 button.append(info);
 if(side){
   const badge=node("span","pill "+(side==="Do"?"do":side==="Waiting"?"waiting":"parent"),side);
   button.append(badge);
 }else button.append(node("span","item-arrow","›"));
 button.addEventListener("click",handler);
 return button;
}
function renderInbox(){
 const container=$("inbox-list");clear(container);
 $("inbox-caption").textContent=state.inbox.length+"件";
 if(!state.inbox.length){container.append(node("div","empty","Inboxは空です。未処理アイテムはありません。"));return;}
 for(const item of state.inbox){
  container.append(row(item.title,"Inbox → Taskに振り分け","↓",null,()=>openMove(item)));
 }
}
function openMove(item){
 openDialog("INBOX → TASK",item.title,"移動先のステータスを選択してください。原文の本文も既存処理で引き継ぎます。",body=>{
  const choices=node("div");selectButton(choices,"Do");body.append(choices);
  const doFields=node("div"),waitingFields=node("div");
  const priorityLabel=node("label",null,"優先度");priorityLabel.htmlFor="move-priority";doFields.append(priorityLabel);
  const priority=node("select");priority.id="move-priority";
  for(const p of ["指定なし","High","Mid","Low"]){const opt=node("option",null,p);opt.value=p==="指定なし"?"":p;priority.append(opt);}
  doFields.append(priority);
  const due=inputRow(doFields,"move-due","期限（任意）","date");
  const projectLabel=node("label",null,"Project（任意）");projectLabel.htmlFor="move-project";doFields.append(projectLabel);
  const project=node("select");project.id="move-project";const none=node("option",null,"指定なし");none.value="";project.append(none);
  for(const p of state.projects){const o=node("option",null,p.name);o.value=p.id;project.append(o);}
  doFields.append(project);
  const reminder=inputRow(waitingFields,"move-reminder","再確認日（任意）","date");
  body.append(doFields,waitingFields);
  function fields(){
    doFields.hidden=choices.dataset.choice!=="Do";
    waitingFields.hidden=choices.dataset.choice!=="Waiting";
  }
  choices.querySelectorAll("button").forEach(b=>b.addEventListener("click",fields));fields();
  const submit=node("button","primary","この内容でTaskに移動 →");submit.type="button";body.append(submit);
  submit.addEventListener("click",async()=>{
   if(state.busy)return;
   const to=choices.dataset.choice;
   if(!window.confirm("「"+item.title+"」を "+to+" に移動しますか？"))return;
   const payload={inbox_page_id:item.id,status:to};
   if(to==="Do"){
    if(priority.value)payload.priority=priority.value;
    if(due.value)payload.due_date=due.value;
    if(project.value)payload.project_id=project.value;
   }
   if(to==="Waiting"&&reminder.value)payload.reminder_date=reminder.value;
   setBusy(true);status("NotionのInboxを移動中…");
   try{
     const result=await api("/api/mobile/inbox/move","POST",payload);
     if(!result.ok)throw new Error("移動を確認できませんでした");
     state.busy=false;closeDialog();
     await reload();
     status("「"+item.title+"」を "+to+" に移動しました");
   }catch(error){status(error.message);}
   finally{setBusy(false);}
  });
 });
}
function formatTaskMeta(t){
 const fragments=[t.due_date?"期限 "+safeDate(t.due_date):"期限なし"];
 if(t.priority)fragments.push(t.priority);
 if(t.waiting_since&&t.status==="Waiting")fragments.push("待機開始 "+safeDate(t.waiting_since));
 return fragments.join(" · ");
}
function taskRow(t){
 return row(t.name,formatTaskMeta(t),t.is_parent?"▣":t.parent_id?"↳":"✓",t.status,()=>openTask(t));
}
function group(parent,name,subtitle,items){
 if(!items.length)return;
 const title=node("div","group-title",name);
 if(subtitle)title.append(node("span","group-caption",subtitle));
 parent.append(title);
 for(const t of items)parent.append(taskRow(t));
}
function renderTasks(){
 const root=$("tasks-list");clear(root);
 const filtered=state.tasks.filter(t=>state.filter==="all"||t.status===state.filter);
 if(!filtered.length){root.append(node("div","empty","該当するDo / Waitingタスクはありません。"));return;}
 const independent=filtered.filter(t=>!t.is_parent&&!t.parent_id&&t.task_level);
 const unclassified=filtered.filter(t=>!t.is_parent&&!t.parent_id&&!t.task_level);
 const underParent=filtered.filter(t=>!t.is_parent&&t.parent_id);
 const management=filtered.filter(t=>t.is_parent);
 group(root,"INDEPENDENT","単独タスク",independent);
 if(unclassified.length)group(root,"UNCLASSIFIED","分類未設定",unclassified);
 const groups=new Map();
 for(const item of underParent){
  if(!groups.has(item.parent_id))groups.set(item.parent_id,{name:item.parent_name||"親タスク",children:[]});
  groups.get(item.parent_id).children.push(item);
 }
 for(const g of groups.values())group(root,"PROJECT TASKS",g.name,g.children);
 if(management.length){
  const details=node("details","management");
  const summary=node("summary",null,"親タスク（案件管理） "+management.length+"件　⌄");
  details.append(summary);
  for(const item of management)details.append(taskRow(item));
  root.append(details);
 }
}
function openTask(t){
 const description=t.parent_id?"親タスク："+(t.parent_name||"親タスク"):
   t.is_parent?"親タスク（案件管理用）":"現在："+t.status;
 openDialog(t.is_parent?"PROJECT TASK":"TASK STATUS",t.name,description,body=>{
  const meta=node("p","help",formatTaskMeta(t));body.append(meta);
  const choices=node("div","choice-grid");
  body.append(choices);
  for(const next of NEXT){
   const button=node("button","choice",next===t.status?labels[next]+" · 現在":labels[next]);
   button.disabled=next===t.status;button.type="button";choices.append(button);
   button.addEventListener("click",async()=>{
    if(state.busy)return;
    if(!window.confirm("「"+t.name+"」を "+next+" に変更しますか？"))return;
    setBusy(true);status("ステータスを変更しています…");
    try{
     const result=await api("/api/mobile/task/status","POST",{task_id:t.id,expected_status:t.status,to:next});
     if(!result.ok)throw new Error("変更を確認できませんでした");
     state.busy=false;closeDialog();await reload();
     status("「"+t.name+"」を "+next+" に変更しました");
    }catch(error){status(error.message);}
    finally{setBusy(false);}
   });
  }
  if(t.is_parent)body.append(node("p","help","親タスクの変更は案件全体に影響するため、子タスクの状態も確認してください。"));
  const link=notionLink(t.url);if(link)body.append(link);
 });
}
$("login-form").addEventListener("submit",login);
$("lock").addEventListener("click",()=>{if(window.confirm("この端末の接続を解除しますか？"))logout();});
$("refresh").addEventListener("click",()=>reload().catch(e=>status(e.message)));
$("modal-close").addEventListener("click",closeDialog);
document.querySelector(".modal-scrim").addEventListener("click",closeDialog);
document.addEventListener("keydown",e=>{if(e.key==="Escape")closeDialog();});
document.querySelectorAll("[data-tab]").forEach(button=>button.addEventListener("click",()=>setTab(button.dataset.tab)));
document.querySelectorAll("[data-status-filter]").forEach(button=>button.addEventListener("click",()=>{
  state.filter=button.dataset.statusFilter;
  document.querySelectorAll("[data-status-filter]").forEach(other=>other.classList.toggle("selected",other===button));
  renderTasks();
}));
try{state.token=sessionStorage.getItem(storeKey)||"";}catch(_){}
if(state.token){
 show($("auth"),false);show($("dashboard"),true);show($("lock"),true);
 reload().catch(error=>status(error.message));
}else $("access-key").focus();
if("serviceWorker" in navigator){
 navigator.serviceWorker.register("/mobile/sw.js",{scope:"/mobile"}).catch(()=>{});
}
})();
`;
