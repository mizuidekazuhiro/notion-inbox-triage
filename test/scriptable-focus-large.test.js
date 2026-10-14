import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const SOURCE=readFileSync(new URL("../scripts/NotionFocusLarge.js",import.meta.url),"utf8");
const APP_URL="https://notion-inbox-triage.kazuhiro-mizuide.workers.dev/mobile?tab=tasks";
const API_URL="https://notion-inbox-triage.kazuhiro-mizuide.workers.dev/api/mobile/tasks";
const TOKEN_KEY="NOTION_WEEK_WIDGET_SHORTCUT_TOKEN";

class Stack {
  constructor(all) { this.all=all; this.texts=[];this.stacks=[];this.spacers=[];this.padding=null;this.url=null; }
  addStack() { const next=new Stack(this.all);this.stacks.push(next);return next; }
  addText(t) {
    const entry={text:String(t),font:null,color:null,lineLimit:null};
    this.texts.push(entry);this.all.push(entry);
    return entry;
  }
  addSpacer(n) {this.spacers.push(n);}
  setPadding(...v) {this.padding=v;}
  layoutHorizontally() {}
  layoutVertically() {}
  centerAlignContent() {}
}
class Widget extends Stack {
  constructor() {super([]);}
  async presentLarge() {this.presentedLarge=true;}
}
function sampleTask(overrides={}){
  return {
    id:"11111111-2222-3333-4444-555555555555",
    name:"会議資料を準備する",status:"Do",is_parent:false,task_level:"子タスク",
    parent_id:null,parent_name:"",priority:"Mid",due_date:"2026-10-14",
    reminder_date:null,waiting_since:null,url:"https://www.notion.so/11111111222233334444555555555555",
    ...overrides
  };
}
function dataSample(){
  return [
    sampleTask({name:"長期滞留",due_date:"2026-06-01",priority:"High"}),
    sampleTask({name:"本日の対応",due_date:"2026-10-14",parent_id:"abc",parent_name:"案件A",priority:"Mid"}),
    sampleTask({name:"直近フォロー",due_date:"2026-10-16",priority:"High"}),
    sampleTask({name:"期限なしの作業",due_date:null}),
    sampleTask({name:"来月の案件",due_date:"2026-11-10"}),
    sampleTask({name:"親タスクそのもの",is_parent:true,task_level:"親タスク"}),
    sampleTask({name:"Waiting今日確認",status:"Waiting",reminder_date:"2026-10-14",due_date:null,waiting_since:"2026-10-05",parent_id:"abc",parent_name:"案件A"}),
    sampleTask({name:"Waiting未来確認",status:"Waiting",reminder_date:"2026-10-20",due_date:null,waiting_since:"2026-10-05"}),
    sampleTask({name:"Waiting経過",status:"Waiting",reminder_date:null,due_date:null,waiting_since:"2026-10-08"})
  ];
}
async function runWidget({data=dataSample(),family="large",token=true,fail=false,truncated=false}={}){
  const requests=[];
  const keyLookups=[];
  let currentWidget;
  class FixedDate extends Date {
    constructor(value) { super(value === undefined ? "2026-10-13T16:15:00.000Z" : value); }
    static now() { return Date.parse("2026-10-13T16:15:00.000Z"); }
  }
  const sandbox={
    ListWidget:class extends Widget {},
    LinearGradient:class {constructor(){this.colors=[];this.locations=[];}},
    Color:class {constructor(hex,alpha){this.hex=hex;this.alpha=alpha;}},
    Size:class {constructor(w,h){this.width=w;this.height=h;}},
    Font:{
      systemFont:n=>({size:n}),mediumSystemFont:n=>({size:n,weight:"medium"}),
      semiboldSystemFont:n=>({size:n,weight:"semibold"}),
      boldSystemFont:n=>({size:n,weight:"bold"})
    },
    Keychain:{
      contains:key=>{keyLookups.push(key);return token;},
      get:key=>"secret-from-existing-notion-week"
    },
    config:{runsInWidget:true,widgetFamily:family},
    Request:class{
      constructor(url){this.url=url;requests.push(this);}
      async loadJSON(){
        if(fail)throw new Error("network");
        return {ok:true,count:data.length,items:data,truncated};
      }
    },
    Alert:class {},
    Script:{setWidget(w){currentWidget=w;},complete(){}},
    Date:FixedDate,Intl,URL,console
  };
  const script=new vm.Script("(async()=>{\n"+SOURCE+"\n})()",{filename:"NotionFocusLarge.js"});
  await script.runInNewContext(sandbox,{timeout:4000});
  return {
    requests,keyLookups,widget:currentWidget,
    texts:currentWidget.all.map(item=>item.text)
  };
}
test("premium large widget loads authenticated mobile tasks from existing token, read-only",async()=>{
  const {requests,keyLookups,widget,texts}=await runWidget();
  assert.ok(widget,"widget must be returned");
  assert.equal(requests.length,1);
  assert.equal(requests[0].url,API_URL);
  assert.equal(requests[0].method,"GET");
  assert.equal(requests[0].headers["X-Shortcut-Token"],"secret-from-existing-notion-week");
  assert.deepEqual(keyLookups,[TOKEN_KEY]);
  assert.equal(widget.url,APP_URL);
  // FixedDate.now() is pinned by the Scriptable VM test harness.
  assert.equal(widget.refreshAfterDate.getTime() - Date.parse("2026-10-13T16:15:00.000Z"), 5*60*1000);
  assert.equal(widget.backgroundGradient.colors.length,3);
  assert.ok(texts.includes("NOTION  /  FOCUS"));
  assert.ok(texts.includes("OPEN FLOW  ↗"));
});
test("active child and standalone tasks display; parent appears only as a count",async()=>{
  const result=await runWidget();
  const txt=result.texts;
  assert.ok(txt.includes("会議資料を準備する")===false,"sample not present");
  assert.ok(txt.includes("本日の対応"));
  assert.ok(txt.includes("直近フォロー"));
  assert.ok(txt.includes("↳ 案件A"));
  assert.ok(txt.includes("案件管理 1件"));
  assert.ok(!txt.includes("親タスクそのもの"));
  assert.ok(txt.includes("長期滞留"),"long overdue remains visible after current priorities");
  assert.ok(txt.some(t=>t==="3/5"),"shows visible/total count for Do");
  assert.ok(txt.some(t=>t==="3/3"),"uses three Waiting slots when both statuses have at least three tasks");
});
test("waiting section surfaces overdue reminder before future reminders",async()=>{
  const {texts}=await runWidget();
  assert.ok(texts.includes("Waiting今日確認"));
  assert.ok(texts.includes("Waiting経過"));
  assert.ok(texts.includes("Waiting未来確認"));
  assert.ok(texts.indexOf("Waiting今日確認") < texts.indexOf("Waiting未来確認"));
  assert.ok(texts.includes("今日確認"));
  assert.ok(texts.includes("6日待機"));
});
test("eight Do and zero Waiting fill six visible cards without wasting space",async()=>{
  const data=Array.from({length:8},(_,i)=>sampleTask({
    id:String(i),name:"実行タスク "+(i+1),status:"Do",due_date:"2026-10-"+String(14+i).padStart(2,"0")
  }));
  const {widget,texts}=await runWidget({data});
  assert.ok(texts.includes("6/8"),"the section heading must report six of eight");
  assert.ok(texts.includes("実行タスク 1"));
  assert.ok(texts.includes("実行タスク 6"));
  assert.ok(!texts.includes("実行タスク 7"));
  assert.ok(!texts.includes("AWAITING"),"a zero-Waiting placeholder wastes too much room");
  assert.ok(!texts.includes("現在、相手待ちはありません"));
  const allStacks=(s)=>[s,...s.stacks.flatMap(allStacks)];
  const rows=allStacks(widget).filter(s=>s.size?.height===31 && s.url===APP_URL);
  assert.equal(rows.length,6,"six interactive task cards fit the large widget");
  assert.ok(rows.every(s=>s.spacers.includes(undefined)),
    "task cards should expand to available width rather than shrink around text");
  assert.ok(texts.includes("OPEN FLOW  ↗"),"the footer is retained");
  assert.deepEqual(widget.padding,[10,14,8,14]);
});
test("unused Waiting capacity is redistributed to Do without hiding urgent follow-ups",async()=>{
 const base=Array.from({length:8},(_,i)=>sampleTask({
   id:"do-"+i,name:"DO項目 "+(i+1),status:"Do",
   due_date:"2026-10-"+String(14+i).padStart(2,"0")
 }));
 const createWait=i=>sampleTask({
   id:"waiting-"+i,name:"WAIT項目 "+(i+1),status:"Waiting",
   reminder_date:"2026-10-"+String(14+i).padStart(2,"0"),
   due_date:null
 });
 for(const [waiting,expectDo,expectWait] of [[0,6,0],[1,5,1],[2,4,2],[3,3,3],[5,3,3]]){
   const {texts}=await runWidget({data:[...base,...Array.from({length:waiting},(_,i)=>createWait(i))]});
   assert.ok(texts.includes(expectDo+"/8"));
   if(waiting)assert.ok(texts.includes(expectWait+"/"+waiting));
   for(let i=1;i<=expectDo;i++)assert.ok(texts.includes("DO項目 "+i));
   for(let i=1;i<=expectWait;i++)assert.ok(texts.includes("WAIT項目 "+i));
   assert.equal(texts.filter(t=>t.startsWith("DO項目 ")).length+texts.filter(t=>t.startsWith("WAIT項目 ")).length,6);
 }
});
test("Waiting-only days use all six available slots too",async()=>{
 const data=Array.from({length:7},(_,i)=>sampleTask({
   id:"waiting-"+i,name:"待機 "+(i+1),status:"Waiting",
   reminder_date:"2026-10-"+String(14+i).padStart(2,"0"),due_date:null
 }));
 const {texts}=await runWidget({data});
 assert.ok(!texts.includes("ACTION NOW"));
 assert.ok(texts.includes("6/7"));
 assert.equal(texts.filter(t=>t.startsWith("待機 ")).length,6);
});
test("expired long overdue tasks are not silently dropped",async()=>{
  const onlyOld=[sampleTask({name:"昔のタスク",due_date:"2026-06-01"})];
  const {texts}=await runWidget({data:onlyOld});
  assert.ok(texts.includes("昔のタスク"));
  assert.ok(texts.includes("長期超過"));
  assert.ok(texts.some(t=>t.includes("期限超過 1")));
});
test("missing token shows error and does not fetch any personal information",async()=>{
  const {requests,texts}=await runWidget({token:false});
  assert.equal(requests.length,0);
  assert.ok(texts.some(t=>t.includes("Scriptableで実行")));
});
test("empty dataset renders meaningful placeholders and no invented work",async()=>{
  const {texts}=await runWidget({data:[]});
  assert.ok(texts.includes("いま実行するタスクはありません"));
  assert.ok(texts.includes("現在、相手待ちはありません"));
  assert.ok(texts.includes("00"));
});
test("source handles failure and database truncation clearly",async()=>{
  const failure=await runWidget({fail:true});
  assert.ok(failure.texts.some(t=>t.includes("通信エラー")));
  const truncated=await runWidget({truncated:true});
  assert.ok(truncated.texts.includes("一部省略"));
});
test("all tappable widget surfaces open Notion Flow Tasks rather than a Notion page",async()=>{
  const {widget}=await runWidget();
  const visit=(s)=>[...(s.url?[s.url]:[]),...s.stacks.flatMap(visit)];
  const urls=visit(widget);
  assert.ok(urls.length>=5, "include widget, actionable rows and footer");
  assert.ok(urls.every(url=>url===APP_URL), "all clickable rows must open the Tasks management screen");
  assert.equal(widget.url,APP_URL);
});
