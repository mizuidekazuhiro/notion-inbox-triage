export const clientJs = `
"use strict";
(function(){
const $ = id => document.getElementById(id);
const storeKey = "notion_flow_session_token";
const state = {token:"",loggedIn:false,inbox:[],tasks:[],projects:[],tab:"inbox",filter:"all",period:"now",busy:false,bulkMode:false,selectedTaskIds:new Set(),visibleTaskIds:[],inboxBulkMode:false,selectedInboxIds:new Set()};
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
 const m=/^(\\d{4})-(\\d{2})-(\\d{2})/.exec(s);
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
 if(!state.loggedIn&&!state.token)throw new Error("接続してください");
 const headers={"Accept":"application/json","X-Notion-Flow":"1"};
 if(state.token)headers["X-Shortcut-Token"]=state.token;
 if(method==="POST")headers["Content-Type"]="application/json";
 let response;
 try{response=await fetch(path,{method:method||"GET",headers,body:payload?JSON.stringify(payload):undefined,cache:"no-store",credentials:"same-origin"});}
 catch(_){throw new Error("通信に失敗しました。接続を確認してください");}
 let data={};
 try{data=await response.json();}catch(_){}
 if(!response.ok||data.ok===false){
  if(response.status===401){
   if(path!=="/api/mobile/session/start")localLogout();
   throw new Error("認証キーを確認してください");
  }
  if(response.status===409)throw new Error(data.error==="already_processed"?
    "すでに処理済みのInboxです。画面を更新して確認してください":
    "他の端末で更新されています。一覧を更新してください");
  if(response.status===400)throw new Error("入力内容を確認してください");
  throw new Error(data.error==="move_failed"?
    "Inboxの移動に失敗しました。Notionの元ページにあるError Messageを確認してください":
    data.error==="notion_unavailable"?"Notionに接続できません":
    "処理できませんでした（HTTP "+response.status+"）");
 }
 return data;
}
function setBusy(value){
 state.busy=value;
 $("refresh").disabled=value;
 $("new-task").disabled=value;
 const buttons=document.querySelectorAll(".modal .primary");
 buttons.forEach(b=>b.disabled=value);
 renderBulkControls();
 renderInboxBulkControls();
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
function selectRow(parent,id,labelText,options){
 const l=node("label",null,labelText);l.htmlFor=id;parent.append(l);
 const select=node("select");select.id=id;select.name=id;
 for(const choice of options){
  const opt=node("option",null,choice[1]);opt.value=choice[0];
  select.append(opt);
 }
 parent.append(select);return select;
}
function createFieldGroup(parent,className){
 const div=node("div",className);
 parent.append(div);return div;
}
function todayKey(){return new Date(Date.now()+9*3600000).toISOString().slice(0,10);}
function shiftedDay(key,days){return new Date(Date.parse(key+"T00:00:00Z")+days*86400000).toISOString().slice(0,10);}
function scheduleFields(form,prefix,startValue,dueValue){
 const dates=createFieldGroup(form,"field-row");
 const startBox=createFieldGroup(dates,"");
 const dueBox=createFieldGroup(dates,"");
 const start=inputRow(startBox,prefix+"-start","いつから（開始予定日）","date",startValue);
 const due=inputRow(dueBox,prefix+"-due","いつまで（期限）","date",dueValue);
 const shortcuts=createFieldGroup(form,"date-shortcuts");
 const today=todayKey();
 const day=new Date(today+"T00:00:00Z").getUTCDay();
 const nextMonday=shiftedDay(today,day===0?1:8-day);
 for(const [text,value] of [["今日から",today],["明日から",shiftedDay(today,1)],["来週から",nextMonday],["開始日なし",""]]){
  const b=node("button","date-shortcut",text);b.type="button";
  b.addEventListener("click",()=>{start.value=value;validate();});shortcuts.append(b);
 }
 function validate(){
  const invalid=Boolean(start.value&&due.value&&start.value>due.value);
  due.setCustomValidity(invalid?"期限は開始予定日以降にしてください":"");
  return !invalid;
 }
 start.addEventListener("change",validate);due.addEventListener("change",validate);
 form.append(node("p","field-note","日付は両方とも任意です。開始日だけ・期限だけでも登録できます。"));
 validate();return {start,due,validate};
}
async function openCreateTask(){
 if(state.busy||!state.loggedIn)return;
 setBusy(true);
 let parentItems=[],parentError=false;
 try{
  const data=await api("/api/mobile/task/parents");
  parentItems=data.items||[];
  parentError=!!data.truncated;
 }catch(e){
  if(!state.loggedIn)return;
  parentError=true;
 }finally{setBusy(false);}
 if(!state.loggedIn)return;

 openDialog("CREATE / TASK","新しいタスクを登録",
   "NotionのTasks DBに直接保存します。Inboxには入れません。",body=>{
  const form=node("form","create-form");form.id="create-task-form";
  const name=inputRow(form,"create-name","タスク名 *","text");
  name.required=true;name.maxLength=240;name.placeholder="何をする？";
  name.autocomplete="off";name.autocapitalize="sentences";

  const upper=createFieldGroup(form,"field-row");
  const statusHolder=createFieldGroup(upper,"");
  const typeHolder=createFieldGroup(upper,"");
  const statusSelect=selectRow(statusHolder,"create-status","ステータス",[
    ["Do","Do · 実行"],["Waiting","Waiting · 相手待ち"],
    ["Someday","Someday · いつか"],["Thinking","Thinking · 検討"]
  ]);
  const levelSelect=selectRow(typeHolder,"create-level","タスク区分",[
    ["子タスク","実行タスク"],["親タスク","親タスク"]
  ]);

  const parentBox=createFieldGroup(form,"");
  const parentSelect=selectRow(parentBox,"create-parent","親タスク（任意）",
    [["","紐づけなし"],...parentItems.map(p=>[p.id,p.name])]);
  if(parentError)parentBox.append(node("p","field-note",
    "親タスク一覧を完全に取得できませんでした。必要なら再度開き直してください。"));
  const parentHelp=node("p","field-note",
    "親タスクを選ぶと、そのProjectを自動継承します。");
  parentBox.append(parentHelp);

  const projectBox=createFieldGroup(form,"");
  const projectSelect=selectRow(projectBox,"create-project","Project（任意）",
    [["","指定なし"],...state.projects.map(p=>[p.id,p.name])]);

  const schedule=scheduleFields(form,"create",null,null);
  const dueInput=schedule.due;
  const reminderHolder=createFieldGroup(form,"");
  const reminderInput=inputRow(reminderHolder,"create-reminder","再確認日（Waiting時）","date");

  const prioritySelect=selectRow(form,"create-priority","優先度（任意）",[
    ["","指定なし"],["High","High"],["Mid","Mid"],["Low","Low"]
  ]);
  const contextLabel=node("label",null,"メモ（任意）");
  contextLabel.htmlFor="create-context";form.append(contextLabel);
  const context=node("textarea");context.id="create-context";
  context.name="create-context";context.rows=2;context.maxLength=1000;
  context.placeholder="背景・次にやること";form.append(context);

  function updateFields(){
    parentBox.hidden=levelSelect.value==="親タスク";
    if(parentBox.hidden)parentSelect.value="";
    projectBox.hidden=Boolean(parentSelect.value);
    if(projectBox.hidden)projectSelect.value="";
    reminderHolder.hidden=statusSelect.value!=="Waiting";
    if(reminderHolder.hidden)reminderInput.value="";
  }
  levelSelect.addEventListener("change",updateFields);
  parentSelect.addEventListener("change",updateFields);
  statusSelect.addEventListener("change",updateFields);
  updateFields();

  const submit=node("button","primary","Notionにタスクを登録 →");
  submit.type="submit";form.append(submit);
  form.append(node("p","field-note",
    "登録後はDo/WaitingのみTasks一覧に表示されます。"));
  form.addEventListener("submit",async event=>{
    event.preventDefault();
    if(state.busy)return;
    if(!schedule.validate()){dueInput.reportValidity();return;}
    const title=name.value.trim();
    if(!title){name.focus();return;}
    const to=statusSelect.value;
    if(!window.confirm("「"+title+"」を "+to+" で登録しますか？"))return;
    const payload={name:title,status:to,task_level:levelSelect.value};
    if(prioritySelect.value)payload.priority=prioritySelect.value;
    if(schedule.start.value)payload.start_date=schedule.start.value;
    if(dueInput.value)payload.due_date=dueInput.value;
    if(to==="Waiting"&&reminderInput.value)payload.reminder_date=reminderInput.value;
    if(!parentBox.hidden&&parentSelect.value)payload.parent_task_id=parentSelect.value;
    else if(projectSelect.value)payload.project_id=projectSelect.value;
    if(context.value.trim())payload.context=context.value.trim();

    setBusy(true);status("Notionにタスクを登録中…");
    let created;
    try{
      created=await api("/api/mobile/task/create","POST",payload);
      if(!created.id)throw new Error("作成IDが確認できません");
    }catch(error){
      status("登録結果を確認できません。重複防止のためNotionを確認してから再試行してください。");
      return;
    }finally{setBusy(false);}

    closeDialog();
    state.period="all";
    document.querySelectorAll("[data-period-filter]").forEach(b=>b.classList.toggle("selected",b.dataset.periodFilter==="all"));
    setTab("tasks");
    try{await reload();}catch(error){status("タスクは登録されましたが一覧を再取得できません。更新を試してください。");return;}
    if(created.verified===false){
      status("タスクを作成しましたが最終確認は未了です。Notionで確認してください。");
    }else if(to==="Someday"||to==="Thinking"){
      status(title+" を "+to+" に登録しました（Tasks一覧には表示されません）。");
    }else{
      status(title+" を "+to+" に登録しました。");
    }
  });
  body.append(form);
  name.focus();
 });
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
     api("/api/mobile/tasks?scope=all"),
     api("/api/mobile/projects")
   ]);
   let failures=0;
   if(answers[0].status==="fulfilled"){state.inbox=answers[0].value.items||[];}
   else failures++;
   if(answers[1].status==="fulfilled"){state.tasks=answers[1].value.items||[];}
   else failures++;
   if(answers[2].status==="fulfilled"){state.projects=answers[2].value.items||[];updateInboxBulkProjectOptions();}
   if(!state.loggedIn)return;
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
   await api("/api/mobile/session/start","POST",{});
   // Never persist or retain the X-Shortcut-Token in JavaScript after login.
   state.token="";state.loggedIn=true;
   try{sessionStorage.removeItem(storeKey);}catch(_){}
   $("access-key").value="";
   show($("auth"),false);show($("dashboard"),true);show($("lock"),true);
   await reload();
 }catch(error){
   state.token="";
   if(state.loggedIn&&!$("dashboard").hidden)status(error.message);
   else{state.loggedIn=false;status(error.message);$("access-key").focus();}
 }finally{setBusy(false);}
}
function localLogout(){
 state.token="";state.loggedIn=false;state.inbox=[];state.tasks=[];state.projects=[];
 state.bulkMode=false;state.selectedTaskIds.clear();state.visibleTaskIds=[];
 state.inboxBulkMode=false;state.selectedInboxIds.clear();
 try{sessionStorage.removeItem(storeKey);}catch(_){}
 show($("dashboard"),false);show($("auth"),true);show($("lock"),false);
 if(!$("modal").hidden){state.busy=false;closeDialog();}
}
async function logout(){
 if(state.busy)return;
 setBusy(true);status("セッションを解除中…");
 try{
   await api("/api/mobile/session/logout","POST",{});
   localLogout();status("接続を解除しました");
 }catch(error){status("接続解除できません: "+error.message);}
 finally{setBusy(false);}
}
function setTab(tab){
 state.tab=tab;
 document.querySelectorAll("[data-tab]").forEach(b=>{
  const selected=b.dataset.tab===tab;b.classList.toggle("selected",selected);
  if(selected)b.setAttribute("aria-current","page");else b.removeAttribute("aria-current");
 });
 show($("inbox-panel"),tab==="inbox");show($("tasks-panel"),tab==="tasks");
 if(tab!=="tasks"){state.bulkMode=false;state.selectedTaskIds.clear();}
 if(tab!=="inbox"){
  const wasBulk=state.inboxBulkMode;
  state.inboxBulkMode=false;
  state.selectedInboxIds.clear();
  // Restore normal row click handlers when leaving bulk mode via tab switch.
  if(wasBulk)renderInbox();
 }
 renderBulkControls();
 renderInboxBulkControls();
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
 const available=new Set(state.inbox.map(item=>item.id));
 for(const id of state.selectedInboxIds)if(!available.has(id))state.selectedInboxIds.delete(id);
 renderInboxBulkControls();
 if(!state.inbox.length){container.append(node("div","empty","Inboxは空です。未処理アイテムはありません。"));return;}
 for(const item of state.inbox){
  if(!state.inboxBulkMode){
   container.append(row(item.title,"Inbox → Taskに振り分け","↓",null,()=>openMove(item)));
   continue;
  }
  const wrapper=node("div","bulk-item");
  const checkbox=node("input","bulk-check");
  checkbox.type="checkbox";
  checkbox.checked=state.selectedInboxIds.has(item.id);
  checkbox.setAttribute("aria-label","選択: "+item.title);
  checkbox.addEventListener("change",()=>toggleInboxSelection(item.id,checkbox.checked));
  const itemButton=row(item.title,"Inbox → Taskに振り分け","↓",null,
   ()=>toggleInboxSelection(item.id,!state.selectedInboxIds.has(item.id)));
  itemButton.setAttribute("aria-pressed",String(checkbox.checked));
  wrapper.classList.toggle("picked",checkbox.checked);
  wrapper.append(checkbox,itemButton);
  container.append(wrapper);
 }
}
function toggleInboxSelection(id,selected){
 if(state.busy||!state.inboxBulkMode||!state.inbox.some(item=>item.id===id))return;
 if(selected)state.selectedInboxIds.add(id);else state.selectedInboxIds.delete(id);
 renderInbox();
}
function updateInboxBulkProjectOptions(){
 const project=$("inbox-bulk-project");
 if(!project)return;
 const previous=project.value;
 clear(project);
 const blank=node("option",null,"指定なし");blank.value="";project.append(blank);
 for(const p of state.projects){
  const option=node("option",null,p.name);option.value=p.id;project.append(option);
 }
 project.value=state.projects.some(p=>p.id===previous)?previous:"";
}
function renderInboxBulkControls(){
 const toggle=$("inbox-bulk-toggle");
 if(!toggle)return;
 const active=state.inboxBulkMode;
 toggle.textContent=active?"選択終了":"複数選択";
 toggle.setAttribute("aria-pressed",String(active));
 toggle.disabled=state.busy;
 for(const id of ["inbox-bulk-count","inbox-bulk-select-all","inbox-bulk-clear","inbox-bulk-actions"]){
  show($(id),active);
 }
 $("inbox-bulk-count").textContent=state.selectedInboxIds.size+"件選択";
 $("inbox-bulk-select-all").disabled=state.busy||!state.inbox.length||
  state.inbox.every(item=>state.selectedInboxIds.has(item.id));
 $("inbox-bulk-clear").disabled=state.busy||state.selectedInboxIds.size===0;
 const to=$("inbox-bulk-target").value||"Do";
 show($("inbox-bulk-do-fields"),active&&to==="Do");
 show($("inbox-bulk-waiting-fields"),active&&to==="Waiting");
 for(const id of ["inbox-bulk-target","inbox-bulk-priority","inbox-bulk-due",
                  "inbox-bulk-project","inbox-bulk-reminder"]){
  $(id).disabled=state.busy;
 }
 $("inbox-bulk-apply").disabled=state.busy||state.selectedInboxIds.size===0;
}
async function applyInboxBulk(){
 if(state.busy||!state.inboxBulkMode)return;
 const to=$("inbox-bulk-target").value;
 if(!MOVE.includes(to)){status("移動先を選択してください");return;}
 const selected=state.inbox.filter(item=>state.selectedInboxIds.has(item.id));
 if(!selected.length){status("処理するInboxを選択してください");return;}
 const options={status:to};
 if(to==="Do"){
  const priority=$("inbox-bulk-priority").value;
  const dueDate=$("inbox-bulk-due").value;
  const projectId=$("inbox-bulk-project").value;
  if(priority)options.priority=priority;
  if(dueDate)options.due_date=dueDate;
  if(projectId)options.project_id=projectId;
 }
 if(to==="Waiting"){
  const reminder=$("inbox-bulk-reminder").value;
  if(reminder)options.reminder_date=reminder;
 }
 const details=["選択中の "+selected.length+" 件を "+to+" に移動しますか？",
  "Inbox原文を引き継いでTasksに新規登録し、元のInboxを処理済みにします。"];
 if(to==="Do"){
  if(options.priority)details.push("共通優先度: "+options.priority);
  if(options.due_date)details.push("共通期限: "+options.due_date);
  if(options.project_id)details.push("共通Projectを指定しています。");
 }
 if(to==="Waiting"&&options.reminder_date)details.push("共通再確認日: "+options.reminder_date);
 details.push("1件でもエラーまたは結果確認不能なら中断します。自動再試行はしません。");
 if(!window.confirm(details.join(String.fromCharCode(10))))return;
 let confirmed=0,issue="";
 setBusy(true);
 try{
  for(let i=0;i<selected.length;i++){
   const item=selected[i];
   status("Inbox一括移動 "+(i+1)+"/"+selected.length+" 件: "+item.title);
   try{
    const result=await api("/api/mobile/inbox/move","POST",{
     inbox_page_id:item.id,...options
    });
    if(result.verified!==true||!result.created_task_id){
     issue="「"+item.title+"」の移動後の結果を確認できません。タスクが作成されている可能性があるため、Notionを確認し、再実行しないでください。";
     break;
    }
    confirmed++;
   }catch(error){
    issue="「"+item.title+"」で途中停止: "+error.message+"。タスク作成済みの可能性があるため、Notionを確認してから再処理してください。";
    break;
   }
  }
 }finally{
  // Never retain selected IDs after success or a partial failure.
  state.inboxBulkMode=false;
  state.selectedInboxIds.clear();
  setBusy(false);
 }
 let refreshIssue="";
 if(state.loggedIn){
  try{await reload();}
  catch(error){refreshIssue="一覧の更新に失敗しました: "+error.message;}
 }
 status("Inbox一括移動: "+confirmed+"/"+selected.length+" 件の完了を確認。"+
   (issue?" "+issue:"")+(refreshIssue?" "+refreshIssue:""));
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
     status(result.verified===false?"移動処理は実行されましたが最終確認できません。Notionを確認し、再実行しないでください":"「"+item.title+"」を "+to+" に移動しました");
   }catch(error){status(error.message);}
   finally{setBusy(false);}
  });
 });
}
function formatTaskMeta(t){
 const fullDate=value=>value ? value.split("-").map(Number).join("/") : "";
 const period=t.start_date&&t.due_date ? fullDate(t.start_date)+"〜"+fullDate(t.due_date) :
   t.start_date ? fullDate(t.start_date)+"から" : t.due_date ? fullDate(t.due_date)+"まで" : "日付未設定";
 const fragments=[period];
 if(t.focus_state==="blocked")fragments.push("前工程待ち");
 else if(t.focus_state==="upcoming")fragments.push("開始前・確認前");
 if(t.priority)fragments.push(t.priority);
 if(t.waiting_since&&t.status==="Waiting")fragments.push("待機開始 "+safeDate(t.waiting_since));
 return fragments.join(" · ");
}
function taskRow(t){
 const makeRow=handler=>row(t.name,formatTaskMeta(t),t.is_parent?"▣":t.parent_id?"↳":"✓",t.status,handler);
 // Parent tasks represent a whole project; exclude them from bulk changes.
 if(!state.bulkMode||t.is_parent)return makeRow(()=>openTask(t));
 const container=node("div","bulk-item");
 const checkbox=node("input","bulk-check");
 checkbox.type="checkbox";
 checkbox.checked=state.selectedTaskIds.has(t.id);
 checkbox.setAttribute("aria-label","選択: "+t.name);
 checkbox.addEventListener("change",()=>toggleTaskSelection(t.id,checkbox.checked));
 const taskButton=makeRow(()=>toggleTaskSelection(t.id,!state.selectedTaskIds.has(t.id)));
 taskButton.setAttribute("aria-pressed",String(checkbox.checked));
 container.classList.toggle("picked",checkbox.checked);
 container.append(checkbox,taskButton);
 return container;
}
function toggleTaskSelection(id,selected){
 if(state.busy||!state.bulkMode||!state.visibleTaskIds.includes(id))return;
 if(selected)state.selectedTaskIds.add(id);else state.selectedTaskIds.delete(id);
 renderTasks();
}
function renderBulkControls(){
 const active=state.bulkMode;
 const toggle=$("bulk-toggle");
 if(!toggle)return;
 toggle.textContent=active?"選択終了":"複数選択";
 toggle.setAttribute("aria-pressed",String(active));
 toggle.disabled=state.busy;
 for(const id of ["bulk-count","bulk-select-visible","bulk-clear","bulk-actions"])show($(id),active);
 $("bulk-count").textContent=state.selectedTaskIds.size+"件選択";
 $("bulk-select-visible").disabled=state.busy||!state.visibleTaskIds.length||
   state.visibleTaskIds.every(id=>state.selectedTaskIds.has(id));
 $("bulk-clear").disabled=state.busy||state.selectedTaskIds.size===0;
 $("bulk-target").disabled=state.busy;
 $("bulk-apply").disabled=state.busy||state.selectedTaskIds.size===0;
}
async function applyBulkStatus(){
 if(state.busy||!state.bulkMode)return;
 const to=$("bulk-target").value;
 if(!NEXT.includes(to))return;
 const visible=new Set(state.visibleTaskIds);
 const selected=state.tasks.filter(t=>visible.has(t.id)&&state.selectedTaskIds.has(t.id)&&
   !t.is_parent&&(t.status==="Do"||t.status==="Waiting"));
 const pending=selected.filter(t=>t.status!==to);
 if(!pending.length){status("選択したタスクは既に "+to+" です");return;}
 const skipped=selected.length-pending.length;
 const message=[
   pending.length+"件のタスクを "+to+" に変更しますか？",
   skipped?"既に "+to+" の "+skipped+"件は変更しません。":"",
   "親タスクは対象外です。",
   "更新は1件ずつ行います。失敗した場合、一部のみ変更済みとなることがあります。"
 ].filter(Boolean).join(String.fromCharCode(10));
 if(!window.confirm(message))return;
 let confirmed=0,issue="";
 setBusy(true);
 try{
  for(let i=0;i<pending.length;i++){
   const item=pending[i];
   status("一括処理 "+(i+1)+"/"+pending.length+"件: "+item.name);
   try{
    const result=await api("/api/mobile/task/status","POST",{
     task_id:item.id,expected_status:item.status,to
    });
    if(result.verified!==true){
     issue="確認不能な更新があるため処理を停止しました。Notionで状態を確認してください。";
     break;
    }
    confirmed++;
   }catch(error){
    issue="途中停止: "+error.message+"。変更済みの可能性があるため、Notionを確認してから再処理してください。";
    break;
   }
  }
 }finally{
  // Clear the selection to prevent accidental resubmission after a partial failure.
  state.bulkMode=false;
  state.selectedTaskIds.clear();
  setBusy(false);
 }
 let refreshIssue="";
 if(state.loggedIn){
  try{await reload();}
  catch(error){refreshIssue="一覧更新に失敗しました: "+error.message;}
 }
 status("一括変更: "+confirmed+"/"+pending.length+"件の完了を確認。"+
   (issue?" "+issue:"")+(refreshIssue?" "+refreshIssue:""));
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
 const today=todayKey(),weekEnd=shiftedDay(today,7);
 const all=state.tasks.filter(t=>state.filter==="all"||t.status===state.filter);
 const filtered=all.filter(t=>{
   if(state.period==="all")return true;
   if(t.is_parent)return false;
   if(t.focus_state==="now")return true;
   if(state.period!=="week"||t.focus_state==="blocked"||t.focus_state==="unscheduled")return false;
   if(t.start_date&&t.start_date>weekEnd)return false;
   const next=t.status==="Waiting"?(t.reminder_date||t.start_date):(t.start_date||t.due_date);
   return Boolean(next&&next<=weekEnd);
 });
 state.visibleTaskIds=filtered.filter(t=>!t.is_parent).map(t=>t.id);
 const visible=new Set(state.visibleTaskIds);
 for(const id of state.selectedTaskIds)if(!visible.has(id))state.selectedTaskIds.delete(id);
 renderBulkControls();
 const count=kind=>all.filter(t=>!t.is_parent&&t.focus_state===kind).length;
 $("task-period-note").textContent="先の予定 "+count("upcoming")+"件 · 日付未設定 "+count("unscheduled")+"件 · 前工程待ち "+count("blocked")+"件（「すべて」で確認）";
 if(!filtered.length){root.append(node("div","empty","この表示に該当するタスクはありません。「すべて」で先の予定・日付未設定も確認できます。"));return;}
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
  const edit=node("button","primary secondary","開始予定日・期限を編集");edit.type="button";
  edit.addEventListener("click",()=>openSchedule(t));body.append(edit);
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
     status(result.verified===false?"更新処理は実行されましたが最終確認できません。Notionで状態を確認してください":"「"+t.name+"」を "+next+" に変更しました");
    }catch(error){status(error.message);}
    finally{setBusy(false);}
   });
  }
  if(t.is_parent)body.append(node("p","help","親タスクの変更は案件全体に影響するため、子タスクの状態も確認してください。"));
  const link=notionLink(t.url);if(link)body.append(link);
 });
}
function openSchedule(t){
 openDialog("TASK / PERIOD",t.name,"開始予定日と期限を変更します。実際の完了日は変更しません。",body=>{
  const form=node("form","create-form");
  const fields=scheduleFields(form,"edit",t.start_date,t.due_date);
  const save=node("button","primary","期間を保存");save.type="submit";form.append(save);
  const message=node("p","field-note");form.append(message);
  form.addEventListener("submit",async event=>{
   event.preventDefault();if(state.busy)return;
   if(!fields.validate()){fields.due.reportValidity();return;}
   setBusy(true);message.textContent="保存中…";
   try{
    const result=await api("/api/mobile/task/schedule","POST",{
     task_id:t.id,start_date:fields.start.value||null,due_date:fields.due.value||null,
     expected_revision:t.schedule_revision
    });
    if(result.verified!==true){
     save.disabled=true;message.textContent="更新処理は実行されましたが最終確認できません。一覧を更新して確認してください。";
     return;
    }
    state.busy=false;closeDialog();await reload();status("開始予定日・期限を更新しました");
   }catch(error){message.textContent=error.message;}
   finally{setBusy(false);}
  });body.append(form);
 });
}
$("login-form").addEventListener("submit",login);
$("lock").addEventListener("click",()=>{if(window.confirm("この端末の接続を解除しますか？"))logout();});
$("refresh").addEventListener("click",()=>reload().catch(e=>status(e.message)));
$("new-task").addEventListener("click",()=>openCreateTask().catch(e=>status(e.message)));
$("inbox-bulk-toggle").addEventListener("click",()=>{
 if(state.busy)return;
 state.inboxBulkMode=!state.inboxBulkMode;
 state.selectedInboxIds.clear();
 renderInbox();
});
$("inbox-bulk-select-all").addEventListener("click",()=>{
 if(state.busy||!state.inboxBulkMode)return;
 for(const item of state.inbox)state.selectedInboxIds.add(item.id);
 renderInbox();
});
$("inbox-bulk-clear").addEventListener("click",()=>{
 if(state.busy)return;
 state.selectedInboxIds.clear();
 renderInbox();
});
$("inbox-bulk-target").addEventListener("change",renderInboxBulkControls);
$("inbox-bulk-apply").addEventListener("click",()=>applyInboxBulk().catch(error=>status(error.message)));
$("bulk-toggle").addEventListener("click",()=>{
 if(state.busy)return;
 state.bulkMode=!state.bulkMode;state.selectedTaskIds.clear();renderTasks();
});
$("bulk-select-visible").addEventListener("click",()=>{
 if(state.busy)return;
 for(const id of state.visibleTaskIds)state.selectedTaskIds.add(id);
 renderTasks();
});
$("bulk-clear").addEventListener("click",()=>{
 if(state.busy)return;
 state.selectedTaskIds.clear();renderTasks();
});
$("bulk-apply").addEventListener("click",()=>applyBulkStatus().catch(e=>status(e.message)));
$("modal-close").addEventListener("click",closeDialog);
document.querySelector(".modal-scrim").addEventListener("click",closeDialog);
document.addEventListener("keydown",e=>{if(e.key==="Escape")closeDialog();});
document.querySelectorAll("[data-tab]").forEach(button=>button.addEventListener("click",()=>{if(!state.busy)setTab(button.dataset.tab);}));
document.querySelectorAll("[data-status-filter]").forEach(button=>button.addEventListener("click",()=>{
  if(state.busy)return;
 state.filter=button.dataset.statusFilter;
  document.querySelectorAll("[data-status-filter]").forEach(other=>other.classList.toggle("selected",other===button));
  renderTasks();
}));
document.querySelectorAll("[data-period-filter]").forEach(button=>button.addEventListener("click",()=>{
 if(state.busy)return;
 state.period=button.dataset.periodFilter;
 document.querySelectorAll("[data-period-filter]").forEach(other=>other.classList.toggle("selected",other===button));
 renderTasks();
}));
// Open the Tasks tab directly when launched from the Notion Focus widget.
setTab(new URLSearchParams(window.location.search).get("tab")==="tasks"?"tasks":"inbox");
try{sessionStorage.removeItem(storeKey);}catch(_){}
async function resumeSession(){
  // Persistent session belongs to this browser/PWA; never read the secret from browser storage.
  try{
    const response=await fetch("/api/mobile/session",{
      method:"GET",credentials:"same-origin",cache:"no-store",
      headers:{"Accept":"application/json"}
    });
    if(response.ok){
      state.loggedIn=true;
      show($("auth"),false);show($("dashboard"),true);show($("lock"),true);
      await reload();
      return;
    }
  }catch(error){status("通信状態を確認してください");}
  state.loggedIn=false;show($("auth"),true);show($("dashboard"),false);show($("lock"),false);
  $("access-key").focus();
}
show($("auth"),false);
resumeSession().catch(error=>status(error.message));
if("serviceWorker" in navigator){
 navigator.serviceWorker.register("/mobile/sw.js",{scope:"/mobile"}).catch(()=>{});
}
})();
`;
