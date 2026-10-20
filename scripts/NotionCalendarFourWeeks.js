// Scriptable — Notion Calendar, Sunday first, current week + next three weeks.
// Shares Notion Week's existing Worker token. Use a LARGE home-screen widget.
const API_URL = "https://notion-inbox-triage.kazuhiro-mizuide.workers.dev/api/widget/schedule/calendar";
const TOKEN_KEY = "NOTION_WEEK_WIDGET_SHORTCUT_TOKEN";
const NOTION_HOME_URL = "https://www.notion.so/3d6dec27c9aa81d08065df5c1a1b9f76";
const CACHE_NAME = "notion-calendar-four-weeks-v1.json";
const DAY_MS = 86400000;
const C = { background:"#0A1925", backgroundEnd:"#183848", white:"#F4F9FC",
  faint:"#95AAB8", softer:"#B4C8D5", border:"#6699AD", cyan:"#8AD7E5",
  coral:"#FFADB0", blue:"#94BFFF", surface:"#A7DAE4" };
const DAYS = ["日","月","火","水","木","金","土"];

function dayKey(value) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Date(date.getTime() + 9 * 3600000).toISOString().slice(0,10) : null;
}
function dayMs(key) { return Date.parse(key + "T00:00:00+09:00"); }
function rangeFor(now) {
  const today = dayKey(now);
  const weekday = new Date(dayMs(today) + 9 * 3600000).getUTCDay();
  const start = dayMs(today) - weekday * DAY_MS;
  return { today, weekday, start, from:dayKey(start), until:dayKey(start+28*DAY_MS) };
}
function eventBounds(item) {
  const start = /^\d{4}-\d{2}-\d{2}$/.test(item.start)
    ? dayMs(item.start) : Date.parse(item.start);
  const value = item.end || item.start;
  const end = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? dayMs(value) + DAY_MS : Date.parse(value) + (item.end ? 0 : 1);
  return {start,end};
}
function eventsForDay(items,key) {
  const from = dayMs(key);
  return items.filter(item => {
    if (!item || typeof item.start !== "string") return false;
    const b = eventBounds(item);
    return b.start < from + DAY_MS && b.end > from;
  }).sort((a,b) => Number(!!b.all_day)-Number(!!a.all_day) ||
    eventBounds(a).start-eventBounds(b).start ||
    String(a.title).localeCompare(String(b.title),"ja"));
}
function validReply(reply,range) {
  return reply?.ok === true && Array.isArray(reply.items) &&
    reply.timezone === "Asia/Tokyo" && reply.from === range.from &&
    reply.until_exclusive === range.until && reply.count === reply.items.length &&
    reply.items.every(x => x && typeof x.title === "string" &&
      typeof x.start === "string" && Number.isFinite(eventBounds(x).start) &&
      Number.isFinite(eventBounds(x).end));
}
function safeNotionURL(value) {
  return typeof value === "string" &&
    /^https:\/\/(?:www\.)?(?:notion\.so|notion\.site)\//i.test(value)
    ? value : NOTION_HOME_URL;
}
function color(hex,alpha=1) { return new Color(hex,alpha); }
function label(stack,text,size,hex,bold=false) {
  const t=stack.addText(String(text));
  t.font=bold?Font.semiboldSystemFont(size):Font.systemFont(size);
  t.textColor=color(hex); t.lineLimit=1; t.minimumScaleFactor=0.9;
  return t;
}
function widgetWidth() {
  const screen=Device.screenSize();
  const w=Math.min(screen.width,screen.height);
  return w<=320?292:w<=375?329:w<=390?338:w<=414?360:364;
}
function addDateBadge(cell,key,today,past,width) {
  // Draw the whole date at a fixed size. A narrow text stack with flexible
  // spacers can compress "21" to "2" on a real Scriptable widget.
  const day=Number(key.slice(8,10));
  const stamp=day===1?Number(key.slice(5,7))+"/1":String(day);
  const canvas=new DrawContext();
  canvas.size=new Size(width,20);
  canvas.opaque=false;
  canvas.respectScreenScale=true;
  if(today) {
    canvas.setFillColor(color(C.cyan));
    canvas.fillEllipse(new Rect((width-20)/2,0,20,20));
  }
  canvas.setFont(Font.semiboldSystemFont(10));
  canvas.setTextColor(color(today?C.background:past?C.faint:C.white));
  canvas.setTextAlignedCenter();
  canvas.drawTextInRect(stamp,new Rect(0,3,width,16));
  const image=cell.addImage(canvas.getImage());
  image.imageSize=new Size(width,20);
}
function makeWidget(result,state,now=new Date()) {
  const range=rangeFor(now);
  const widget=new ListWidget();
  const gradient=new LinearGradient();
  gradient.colors=[color(C.background,0.96),color(C.backgroundEnd,0.94)];
  gradient.locations=[0,1]; widget.backgroundGradient=gradient;
  widget.setPadding(12,12,12,12); widget.url=NOTION_HOME_URL;
  widget.refreshAfterDate=new Date(now.getTime()+30*60000);
  if(config.widgetFamily && config.widgetFamily!=="large" && config.runsInWidget) {
    label(widget,"Notion Calendar",14,C.cyan,true);
    widget.addSpacer(10);
    label(widget,"大サイズで追加してください",11,C.white);
    return widget;
  }
  const width=widgetWidth(), cellWidth=(width-24-18)/7;
  const cellHeight=width<=292?51:58;
  const header=widget.addStack(); header.centerAlignContent();
  label(header,"NOTION CALENDAR",11,C.softer,true); header.addSpacer();
  const todayText=Number(range.today.slice(5,7))+"/"+Number(range.today.slice(8,10));
  label(header,"今日 "+todayText+"（"+DAYS[range.weekday]+"）",10,C.cyan,true);
  widget.addSpacer(5);
  const last=dayKey(range.start+27*DAY_MS);
  label(widget,range.from.replace(/-/g,".")+" — "+last.replace(/-/g,"."),10,C.faint);
  widget.addSpacer(8);
  const weekdays=widget.addStack();
  for(let d=0;d<7;d++) {
    const box=weekdays.addStack(); box.size=new Size(cellWidth,14);
    box.addSpacer();
    label(box,DAYS[d],9,d===0?C.coral:d===6?C.blue:C.faint,true);
    box.addSpacer(); if(d<6)weekdays.addSpacer(3);
  }
  widget.addSpacer(4);
  for(let week=0;week<4;week++) {
    const row=widget.addStack(); row.layoutHorizontally();
    for(let d=0;d<7;d++) {
      const key=dayKey(range.start+(week*7+d)*DAY_MS);
      const today=key===range.today, past=key<range.today;
      const cell=row.addStack(); cell.layoutVertically();
      cell.size=new Size(cellWidth,cellHeight); cell.setPadding(3,2,3,2);
      cell.cornerRadius=7;
      cell.backgroundColor=color(today?C.cyan:C.surface,today?0.15:past?0.025:0.055);
      cell.borderColor=color(today?C.cyan:C.border,today?0.95:0.17);
      cell.borderWidth=today?1.2:0.5;
      addDateBadge(cell,key,today,past,cellWidth-4);
      cell.addSpacer(3);
      const events=eventsForDay(result?.items||[],key);
      const visible=events.length>2?events.slice(0,1):events.slice(0,2);
      for(const item of visible) {
        const t=label(cell,item.title,9,past?C.faint:C.white);
        t.url=safeNotionURL(item.url);
      }
      if(events.length>2) {
        label(cell,"＋"+(events.length-1)+"件",8,C.cyan).url=NOTION_HOME_URL;
      }
      cell.addSpacer();
      if(d<6)row.addSpacer(3);
    }
    if(week<3)widget.addSpacer(3);
  }
  widget.addSpacer(6);
  let footer=state.message||"";
  if(result?.fetched_at) {
    const fetched=new Date(result.fetched_at);
    const clock=new Intl.DateTimeFormat("ja-JP",{timeZone:"Asia/Tokyo",
      hour:"2-digit",minute:"2-digit",hour12:false}).format(fetched);
    const stamp=dayKey(fetched)===range.today?clock:
      Number(dayKey(fetched).slice(5,7))+"/"+Number(dayKey(fetched).slice(8,10))+" "+clock;
    footer=state.cached?"前回取得 "+stamp+"・更新できません":"更新 "+stamp;
  }
  label(widget,footer||"予定はありません",8,state.error?C.coral:C.faint);
  widget.addSpacer();
  return widget;
}
async function tokenFromKeychain() {
  if(Keychain.contains(TOKEN_KEY))return Keychain.get(TOKEN_KEY);
  if(config.runsInWidget)return null;
  const dialog=new Alert(); dialog.title="Notion Calendar";
  dialog.message="Notion Weekと同じX-Shortcut-Tokenを入力してください。Notion APIキーではありません。";
  dialog.addSecureTextField("X-Shortcut-Token","");
  dialog.addAction("保存"); dialog.addCancelAction("キャンセル");
  if(await dialog.presentAlert()!==0)return null;
  const token=dialog.textFieldValue(0).trim();
  if(token)Keychain.set(TOKEN_KEY,token);
  return token||null;
}
function readCache(range) {
  try {
    const fm=FileManager.local(), path=fm.joinPath(fm.documentsDirectory(),CACHE_NAME);
    if(!fm.fileExists(path))return null;
    const saved=JSON.parse(fm.readString(path));
    return validReply(saved,range) && Number.isFinite(Date.parse(saved.fetched_at))?saved:null;
  }catch(_){return null;}
}
function writeCache(reply) {
  try {
    const fm=FileManager.local(), path=fm.joinPath(fm.documentsDirectory(),CACHE_NAME);
    fm.writeString(path,JSON.stringify(reply));
  }catch(_){ /* Cache failure must not discard a successful network result. */ }
}
async function loadCalendar(now=new Date()) {
  const range=rangeFor(now);
  const token=await tokenFromKeychain();
  if(!token)return {result:null,state:{error:true,message:"Scriptableで実行して認証設定"}};
  try {
    const request=new Request(API_URL);
    request.method="GET"; request.timeoutInterval=18;
    request.headers={"X-Shortcut-Token":token};
    const reply=await request.loadJSON();
    if(request.response?.statusCode===401 || reply?.error==="unauthorized")
      return {result:null,state:{error:true,message:"認証キーを確認してください"}};
    if(!validReply(reply,range))throw new Error("invalid_reply");
    const result={...reply,fetched_at:now.toISOString()};
    writeCache(result);
    return {result,state:{error:false}};
  }catch(_) {
    const cached=readCache(range);
    return {result:cached,state:{error:true,cached:!!cached,
      message:"予定を取得できません・タップしてNotionへ"}};
  }
}
// Use the same date snapshot for loading and drawing across Sunday midnight.
const snapshot=new Date();
const loaded=await loadCalendar(snapshot);
const widget=makeWidget(loaded.result,loaded.state,snapshot);
if(config.runsInWidget)Script.setWidget(widget);
else await widget.presentLarge();
Script.complete();
