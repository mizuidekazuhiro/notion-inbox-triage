// Notion Focus — a premium large iOS Scriptable widget.
// Read only. Status updates belong in the authenticated Notion Flow PWA.
// Reuses the token already saved by Notion Week; no new API or secret is needed.
const API_URL = "https://notion-inbox-triage.kazuhiro-mizuide.workers.dev/api/mobile/tasks";
const FLOW_URL = "https://notion-inbox-triage.kazuhiro-mizuide.workers.dev/mobile?tab=tasks";
const TOKEN_KEY = "NOTION_WEEK_WIDGET_SHORTCUT_TOKEN";
const MAX_DO = 3;
const MAX_WAITING = 2;
const REFRESH_MINUTES = 5; // Earliest requested refresh, not an iOS guarantee.

const C = {
  background: "#0A1925",
  backgroundEnd: "#183848",
  white: "#F4F9FC",
  faint: "#95AAB8",
  softer: "#B4C8D5",
  border: "#6699AD",
  cyan: "#8AD7E5",
  amber: "#F4C986",
  coral: "#FFADB0",
  surface: "#A7DAE4",
  shadow: "#09202D"
};
function color(hex,alpha=1) { return new Color(hex,alpha); }
function label(stack,text,size,hex,bold="regular") {
  const t=stack.addText(String(text));
  t.font=bold==="bold" ? Font.boldSystemFont(size) :
    bold==="semibold" ? Font.semiboldSystemFont(size) :
    bold==="medium" ? Font.mediumSystemFont(size) : Font.systemFont(size);
  t.textColor=color(hex);
  t.lineLimit=1;
  t.minimumScaleFactor=0.76;
  return t;
}
function dayKey(now) {
  return new Date(now.getTime()+9*60*60*1000).toISOString().slice(0,10);
}
function dateDiff(iso,today) {
  if(!iso||typeof iso!=="string") return null;
  const key=iso.slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const delta=(Date.parse(key+"T00:00:00+09:00")-Date.parse(today+"T00:00:00+09:00"))/86400000;
  return Number.isFinite(delta)?Math.round(delta):null;
}
function shortDate(date) {
  const key=String(date||"").slice(0,10);
  return /^\d{4}-\d{2}-\d{2}$/.test(key)
    ? String(Number(key.slice(5,7)))+"/"+String(Number(key.slice(8,10)))
    : "—";
}
function rankPriority(value) {
  return value==="High"?0:value==="Mid"?1:value==="Low"?2:3;
}
function actionBucket(task,today) {
  const days=dateDiff(task.due_date,today);
  if(days===null)return 3;
  if(days< -14)return 2; // Retain long-overdue tasks, but don't crowd out current work.
  if(days<=3)return 0;
  if(days<=10)return 1;
  return 3;
}
function waitingBucket(task,today) {
  const reminder=dateDiff(task.reminder_date,today);
  if(reminder!==null) return reminder<=0?0:2;
  const waiting=dateDiff(task.waiting_since,today);
  if(waiting!==null && waiting<=-3)return 1;
  return 3;
}
function dueText(task,today) {
  const days=dateDiff(task.due_date,today);
  if(days===null)return "期限なし";
  if(days< -14)return "長期超過";
  if(days<0)return "期限超過";
  if(days===0)return "今日";
  if(days===1)return "明日";
  return shortDate(task.due_date);
}
function waitingText(task,today) {
  const reminder=dateDiff(task.reminder_date,today);
  if(reminder!==null){
    if(reminder<0)return "確認超過";
    if(reminder===0)return "今日確認";
    if(reminder===1)return "明日確認";
    return shortDate(task.reminder_date);
  }
  const since=dateDiff(task.waiting_since,today);
  if(since!==null&&since<0)return String(-since)+"日待機";
  return "確認日なし";
}
function normalize(tasks,today) {
  const all=Array.isArray(tasks)?tasks:[];
  const projects=all.filter(t=>t.is_parent===true||t.task_level==="親タスク");
  const actionable=all.filter(t=>
    t && !t.is_parent && t.task_level!=="親タスク" &&
    (t.status==="Do" || t.status==="Waiting")
  );
  const doItems=actionable.filter(t=>t.status==="Do").sort((a,b)=>{
    return actionBucket(a,today)-actionBucket(b,today) ||
      rankPriority(a.priority)-rankPriority(b.priority) ||
      String(a.due_date||"9999").localeCompare(String(b.due_date||"9999")) ||
      String(a.name||"").localeCompare(String(b.name||""),"ja");
  });
  const waitingItems=actionable.filter(t=>t.status==="Waiting").sort((a,b)=>{
    return waitingBucket(a,today)-waitingBucket(b,today) ||
      rankPriority(a.priority)-rankPriority(b.priority) ||
      String(a.reminder_date||"9999").localeCompare(String(b.reminder_date||"9999")) ||
      String(a.name||"").localeCompare(String(b.name||""),"ja");
  });
  return {doItems,waitingItems,projects:projects.length,
    overdues:doItems.filter(t=>dateDiff(t.due_date,today)<0 && dateDiff(t.due_date,today)!==null).length};
}
function frost(stack,opacity=0.08) {
  stack.backgroundColor=color(C.surface,opacity);
  stack.cornerRadius=12;
  stack.borderColor=color(C.border,0.2);
  stack.borderWidth=0.6;
}
function buildBase() {
  const widget=new ListWidget();
  const gradient=new LinearGradient();
  gradient.colors=[color(C.background),color("#102938"),color(C.backgroundEnd)];
  gradient.locations=[0,0.56,1];
  widget.backgroundGradient=gradient;
  widget.setPadding(13,14,10,14);
  widget.spacing=0;
  widget.url=FLOW_URL;
  // WidgetKit applies its own refresh budget; this is only the earliest request.
  widget.refreshAfterDate=new Date(Date.now()+REFRESH_MINUTES*60000);
  return widget;
}
function addHeader(widget,now) {
  const line=widget.addStack();
  line.layoutHorizontally();
  line.centerAlignContent();
  label(line,"✦",13,C.cyan,"bold");
  line.addSpacer(6);
  label(line,"NOTION  /  FOCUS",11,C.white,"semibold");
  line.addSpacer();
  const dt=new Intl.DateTimeFormat("ja-JP",{
    timeZone:"Asia/Tokyo",month:"numeric",day:"numeric",weekday:"short"
  }).format(now);
  label(line,dt,9,C.softer,"medium");
}
function addStatStrip(widget,model) {
  const ribbon=widget.addStack();
  ribbon.layoutHorizontally();
  ribbon.centerAlignContent();
  frost(ribbon,0.07);
  ribbon.setPadding(7,12,7,12);
  ribbon.size=new Size(0,44);
  const left=ribbon.addStack();left.layoutVertically();
  label(left,"DO  /  ACTION",8,C.amber,"semibold");
  left.addSpacer(1);
  label(left,String(model.doItems.length).padStart(2,"0"),19,C.white,"bold");
  ribbon.addSpacer();
  const separator=ribbon.addStack();
  separator.size=new Size(1,27);
  separator.backgroundColor=color(C.border,0.27);
  ribbon.addSpacer();
  const right=ribbon.addStack();right.layoutVertically();
  label(right,"WAITING  /  FOLLOW-UP",8,C.cyan,"semibold");
  right.addSpacer(1);
  label(right,String(model.waitingItems.length).padStart(2,"0"),19,C.white,"bold");
}
function sectionHeading(widget,title,shown,total,hex) {
  const bar=widget.addStack();bar.layoutHorizontally();bar.centerAlignContent();
  const dot=bar.addStack();dot.size=new Size(6,6);
  dot.backgroundColor=color(hex);dot.cornerRadius=3;
  bar.addSpacer(6);
  label(bar,title,9,hex,"semibold");
  bar.addSpacer();
  label(bar,shown+"/"+total,9,C.faint,"medium");
}
function addTaskRow(widget,task,index,type,today) {
  const accent=type==="do"?C.amber:C.cyan;
  const row=widget.addStack();
  row.layoutHorizontally();row.centerAlignContent();
  row.size=new Size(0,35);
  row.setPadding(5,8,5,9);
  frost(row,0.055);
  // Tapping any task opens the status-management screen, not a Notion page.
  row.url=FLOW_URL;
  const left=row.addStack();
  left.layoutHorizontally();left.centerAlignContent();
  left.size=new Size(21,21);
  left.backgroundColor=color(accent,0.12);
  left.cornerRadius=7;
  label(left,String(index+1).padStart(2,"0"),9,accent,"semibold");
  row.addSpacer(8);
  const details=row.addStack();
  details.layoutVertically();
  details.spacing=1;
  label(details,task.name||"無題のタスク",11.4,C.white,"medium");
  const hasParent=!!task.parent_id;
  const parentName=hasParent?(task.parent_name||"親タスク"):"";
  const context=hasParent?("↳ "+parentName):
    task.task_level ? "INDEPENDENT" : "未分類";
  label(details,context,8.6,C.faint);
  row.addSpacer(5);
  const stamp=row.addStack();
  stamp.layoutVertically();stamp.centerAlignContent();
  stamp.size=new Size(52,0);
  const text=type==="do"?dueText(task,today):waitingText(task,today);
  const critical=type==="do" && dateDiff(task.due_date,today)!==null &&
    dateDiff(task.due_date,today)<0;
  label(stamp,text,text.length>=5?8.1:9,critical?C.coral:accent,"semibold");
}
function addEmptyRow(widget,message) {
  const empty=widget.addStack();
  empty.size=new Size(0,35);
  frost(empty,0.04);
  empty.setPadding(10,11,8,11);
  label(empty,message,10,C.faint);
}
function addFooter(widget,model,truncated) {
  const footer=widget.addStack();footer.layoutHorizontally();footer.centerAlignContent();
  label(footer,"案件管理 "+model.projects+"件",8.5,C.faint);
  if(model.overdues>0){
    footer.addSpacer(9);
    label(footer,"期限超過 "+model.overdues,8.5,C.coral);
  }
  if(truncated) {
    footer.addSpacer(5);
    label(footer,"一部省略",8,C.coral);
  }
  footer.addSpacer();
  label(footer,"OPEN FLOW  ↗",9,C.cyan,"semibold");
  footer.url=FLOW_URL;
}
function makeWidget(result,error,now=new Date()) {
  const widget=buildBase();
  addHeader(widget,now);
  widget.addSpacer(6);
  if(error) {
    const panel=widget.addStack();panel.layoutVertically();frost(panel,0.08);
    panel.setPadding(15,12,15,12);
    label(panel,"接続を確認してください",13,C.white,"semibold");
    panel.addSpacer(6);
    label(panel,error,10,C.faint);
    widget.addSpacer();
    label(widget,"NOTION FLOW  ↗",10,C.cyan,"semibold");
    return widget;
  }
  const today=dayKey(now);
  const model=normalize(result.items,today);
  addStatStrip(widget,model);
  widget.addSpacer(9);
  const doList=model.doItems.slice(0,MAX_DO);
  sectionHeading(widget,"ACTION NOW",doList.length,model.doItems.length,C.amber);
  widget.addSpacer(5);
  if(!doList.length)addEmptyRow(widget,"いま実行するタスクはありません");
  for(let i=0;i<doList.length;i++) {
    addTaskRow(widget,doList[i],i,"do",today);
    if(i<doList.length-1)widget.addSpacer(4);
  }
  widget.addSpacer(9);
  const waitList=model.waitingItems.slice(0,MAX_WAITING);
  sectionHeading(widget,"AWAITING",waitList.length,model.waitingItems.length,C.cyan);
  widget.addSpacer(5);
  if(!waitList.length)addEmptyRow(widget,"現在、相手待ちはありません");
  for(let i=0;i<waitList.length;i++) {
    addTaskRow(widget,waitList[i],i,"waiting",today);
    if(i<waitList.length-1)widget.addSpacer(4);
  }
  widget.addSpacer(9);
  addFooter(widget,model,!!result.truncated);
  widget.addSpacer();
  return widget;
}
async function tokenFromKeychain() {
  if(Keychain.contains(TOKEN_KEY)) return Keychain.get(TOKEN_KEY);
  if(config.runsInWidget)return null;
  const dialog=new Alert();
  dialog.title="Notion Focus";
  dialog.message="Notion Weekと同じX-Shortcut-Tokenを入力してください。Notion APIキーではありません。";
  dialog.addSecureTextField("X-Shortcut-Token","");
  dialog.addAction("保存");
  dialog.addCancelAction("キャンセル");
  if(await dialog.presentAlert()!==0)return null;
  const token=dialog.textFieldValue(0).trim();
  if(!token)return null;
  Keychain.set(TOKEN_KEY,token);
  return token;
}
let result=null,error=null;
try {
  const token=await tokenFromKeychain();
  if(!token){
    error="Scriptableで実行し、認証キーを設定";
  }else{
    const request=new Request(API_URL);
    request.method="GET";
    request.timeoutInterval=18;
    request.headers={"X-Shortcut-Token":token};
    const reply=await request.loadJSON();
    if(reply.ok!==true || !Array.isArray(reply.items)){
      error=reply.error==="unauthorized"?"認証キーをご確認ください":"Notionの取得に失敗しました";
    }else{
      result=reply;
    }
  }
}catch(e){
  error="通信エラー。Scriptableから再実行";
}
const widget=makeWidget(result,error);
if(config.runsInWidget)Script.setWidget(widget);
else await widget.presentLarge();
Script.complete();
