import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const browser=await chromium.launch({
 executablePath:process.env.CHROME_PATH||"/usr/bin/google-chrome",
 headless:true,args:["--no-sandbox","--disable-dev-shm-usage"]
});
const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2});
const tasks=[
 {id:"11111111-1111-4111-8111-111111111111",name:"資料整理",status:"Do",focus_state:"now",is_parent:false,task_level:"子タスク"},
 {id:"22222222-2222-4222-8222-222222222222",name:"確認依頼",status:"Waiting",focus_state:"now",is_parent:false,task_level:"子タスク"}
];
const inbox=[
 {id:"33333333-3333-4333-8333-333333333333",title:"問い合わせ対応"},
 {id:"44444444-4444-4444-8444-444444444444",title:"資料の確認"},
 {id:"55555555-5555-4555-8555-555555555555",title:"経費処理"}
];
const moves=[],statuses=[],errors=[];
page.on("pageerror",e=>errors.push(e.message));
page.on("dialog",dialog=>dialog.accept());
await page.route("**/api/mobile/**",async(route)=>{
 const u=new URL(route.request().url());
 const path=u.pathname;
 let body={ok:true};
 if(path==="/api/mobile/session")body={ok:true,authenticated:true};
 else if(path==="/api/mobile/inbox")body={ok:true,items:inbox};
 else if(path==="/api/mobile/tasks")body={ok:true,items:tasks};
 else if(path==="/api/mobile/projects")body={ok:true,items:[]};
 else if(path==="/api/mobile/inbox/move"){
  moves.push(route.request().postDataJSON());
  body={ok:true,verified:true,created_task_id:"66666666-6666-4666-8666-666666666666"};
 }
 else if(path==="/api/mobile/task/status"){
  statuses.push(route.request().postDataJSON());
  body={ok:true,verified:true};
 }
 else throw Error("unexpected API "+path);
 await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(body)});
});
try{
 await page.goto("https://notion-inbox-triage.kazuhiro-mizuide.workers.dev/mobile?tab=inbox",{waitUntil:"networkidle",timeout:30000});
 await page.locator("#inbox-list .item").first().waitFor({timeout:10000});
 console.log("UI initialized",await page.locator("#inbox-count").textContent(),"inbox items");

 await page.locator("#inbox-bulk-toggle").click();
 await page.locator("#inbox-bulk-select-all").click();
 assert.equal(await page.locator("#inbox-bulk-count").textContent(),"3件選択");
 await page.locator("#inbox-bulk-target").selectOption("Waiting");
 await page.locator("#inbox-bulk-reminder").fill("2026-11-15");
 await page.locator("#inbox-bulk-apply").click();
 await page.waitForFunction(()=>document.querySelector("#status-line")?.textContent.includes("3/3 件の完了を確認"),{timeout:12000});
 assert.equal(moves.length,3);
 assert.ok(moves.every(x=>x.status==="Waiting"&&x.reminder_date==="2026-11-15"));
 console.log("Inbox multi-select and Waiting bulk move with synthetic API: PASS",moves.length);

 await page.locator("#inbox-bulk-toggle").click();
 await page.locator("#inbox-bulk-select-all").click();
 await page.locator("#tab-tasks").click();
 await page.locator("#tab-inbox").click();
 await page.locator("#inbox-list .item").first().click();
 assert.equal(await page.locator("#modal").isVisible(),true);
 await page.locator("#modal-close").click();
 console.log("Inbox ordinary item click restored after tab switch: PASS");

 await page.locator("#tab-tasks").click();
 await page.locator("#bulk-toggle").click();
 await page.locator("#bulk-select-visible").click();
 assert.equal(await page.locator("#bulk-count").textContent(),"2件選択");
 await page.locator("#bulk-target").selectOption("Done");
 await page.locator("#bulk-apply").click();
 await page.waitForFunction(()=>document.querySelector("#status-line")?.textContent.includes("2/2件の完了を確認"),{timeout:12000});
 assert.equal(statuses.length,2);
 console.log("Tasks bulk status with synthetic API: PASS",statuses.length);
 assert.deepEqual(errors,[]);
 console.log("No uncaught browser exceptions.");
}finally{
 await browser.close();
}
