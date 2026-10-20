import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
const source=readFileSync(new URL("../scripts/NotionCalendarFourWeeks.js",import.meta.url),"utf8");
const NOW="2026-10-20T16:36:00.000Z";
const item=(title,start,end=null,all_day=true)=>({id:title,title,start,end,all_day,
  url:"https://www.notion.so/"+encodeURIComponent(title)});
const reply={ok:true,timezone:"Asia/Tokyo",from:"2026-10-18",until_exclusive:"2026-11-15",
  count:4,items:[item("出張","2026-10-20","2026-10-22"),
    item("飲み会","2026-10-22T18:00:00+09:00",null,false),
    item("追加予定","2026-10-22"),item("七五三","2026-11-07")]};
class Stack {
  constructor(){this.children=[];this.spacers=[];}
  addText(text){const t={text:String(text)};this.children.push(t);return t;}
  addStack(){const s=new Stack();this.children.push(s);return s;}
  addSpacer(n){this.spacers.push(n);}
  layoutHorizontally(){} layoutVertically(){} centerAlignContent(){}
  setPadding(...p){this.padding=p;}
}
async function run({fail=false,status=200,cache=null,width=375,body=reply}={}) {
  let widget,saved=cache?JSON.stringify(cache):null;
  const all=[];
  class Widget extends Stack {constructor(){super();all.push(this);}}
  class Clock extends Date {constructor(x){super(x??NOW);}static now(){return Date.parse(NOW);}}
  const sandbox={Date:Clock,Intl,console,
    Keychain:{contains:()=>true,get:()=>"test"},
    config:{runsInWidget:true,widgetFamily:"large"},
    Device:{screenSize:()=>({width,height:667})},
    FileManager:{local:()=>({documentsDirectory:()=>"/local",joinPath:(a,b)=>a+"/"+b,
      fileExists:()=>!!saved,readString:()=>saved,writeString:(_,v)=>{saved=v;}})},
    Request:class {constructor(){this.response={statusCode:status};}
      async loadJSON(){if(fail)throw Error("offline");return body;}},
    ListWidget:Widget,LinearGradient:class{},Color:class {constructor(hex,alpha){this.hex=hex;this.alpha=alpha;}},
    Size:class {constructor(width,height){this.width=width;this.height=height;}},
    Font:{systemFont:size=>({size}),semiboldSystemFont:size=>({size,bold:true})},
    Script:{setWidget:w=>{widget=w;},complete(){}}
  };
  const program=new vm.Script("(async()=>{"+source+
    ";return {rangeFor,eventsForDay,safeNotionURL};})()");
  const api=await program.runInNewContext(sandbox,{timeout:3000});
  function flatten(s){return [s,...(s.children||[]).flatMap(flatten)];}
  return {widget,saved,api,all:flatten(widget),texts:flatten(widget).filter(x=>x.text).map(x=>x.text)};
}
test("renders 28 cells, exactly one highlighted today and inherited palette on SE size",async()=>{
  const r=await run({width:375});
  const cells=r.all.filter(x=>x.size?.height===58);
  assert.equal(cells.length,28);
  const today=cells.filter(x=>x.borderWidth===1.2);
  assert.equal(today.length,1);
  assert.equal(today[0].children[0].children[0].backgroundColor.hex,"#8AD7E5");
  assert.ok(r.texts.includes("今日 10/21（水）"));
  assert.ok(r.texts.includes("11/1"));
  assert.ok(r.texts.includes("＋2件"));
  assert.equal(r.widget.backgroundGradient.colors[0].hex,"#0A1925");
  assert.equal(JSON.parse(r.saved).count,4);
  assert.equal(r.widget.refreshAfterDate.getTime()-Date.parse(NOW),30*60000);
});
test("all-day final date inclusive; midnight timed end exclusive; timed UTC start in JST",async()=>{
  const {api}=await run();
  const events=[
    item("trip","2026-10-20","2026-10-22"),
    item("midnight","2026-10-21T22:00:00+09:00","2026-10-22T00:00:00+09:00",false),
    item("utc","2026-10-21T16:00:00Z",null,false)
  ];
  assert.deepEqual(Array.from(api.eventsForDay(events,"2026-10-22"),x=>x.title),["trip","utc"]);
  assert.equal(api.eventsForDay(events,"2026-10-23").length,0);
});
test("same-window cache survives network failure with timestamp; week-old range rejected",async()=>{
  const cache={...reply,fetched_at:"2026-10-20T10:15:00Z"};
  const offline=await run({fail:true,cache});
  assert.ok(offline.texts.includes("前回取得 10/20 19:15・更新できません"));
  assert.ok(offline.texts.includes("七五三"));
  const old=await run({fail:true,cache:{...cache,from:"2026-10-11"}});
  assert.ok(old.texts.includes("予定を取得できません・タップしてNotionへ"));
  assert.ok(!old.texts.includes("七五三"));
});
test("authentication failure does not expose cached schedules or overwrite cache",async()=>{
  const cache={...reply,fetched_at:NOW};
  const r=await run({status:401,body:{ok:false,error:"unauthorized"},cache});
  assert.ok(r.texts.includes("認証キーを確認してください"));
  assert.ok(!r.texts.includes("七五三"));
  assert.deepEqual(JSON.parse(r.saved),cache);
});
test("events link to Notion; successful empty result clears previous events",async()=>{
  const r=await run();
  const event=r.all.find(x=>x.text==="七五三");
  assert.ok(event.url.startsWith("https://www.notion.so/"));
  assert.equal(r.api.safeNotionURL("https://malicious.test/"),r.widget.url);
  const cleared=await run({body:{...reply,count:0,items:[]},cache:{...reply,fetched_at:NOW}});
  assert.equal(JSON.parse(cleared.saved).items.length,0);
  assert.ok(!cleared.texts.includes("七五三"));
});
