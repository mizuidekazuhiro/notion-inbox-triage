import test from 'node:test';
import assert from 'node:assert/strict';
import {readTaskSchedule,validSchedule,taskFocusState,scheduleProperties} from '../src/utils/taskSchedule.js';
import {createMobileTask,validMobileTaskCreate} from '../src/notion/mobileCreate.js';
import {updateMobileSchedule} from '../src/notion/mobileSchedule.js';
import {handleMobileApi} from '../src/routes/mobileApp.js';
import {listMobileTasks} from '../src/notion/mobileData.js';
const DB='2e1dec27c9aa808a8e8dd8c09955e4a1';
const ID='11111111-2222-3333-4444-555555555555';
const DEP='22222222-2222-3333-4444-555555555555';
const ENV={NOTION_TOKEN:'test',TASKS_DB_ID:DB,SHORTCUT_TOKEN:'test-shortcut'};
const json=o=>new Response(JSON.stringify(o),{headers:{'Content-Type':'application/json'}});
const page=(props={},id=ID,db=DB)=>({id,parent:{database_id:db},properties:{Status:{select:{name:'Do'}},...props}});
async function withFetch(mock,fn){const original=global.fetch;global.fetch=mock;try{return await fn();}finally{global.fetch=original;}}
const req=(path,payload,auth=true)=>new Request('https://example.test'+path,{
 method:payload?'POST':'GET',headers:{'Content-Type':'application/json',Origin:'https://example.test',
 ...(auth?{'X-Shortcut-Token':ENV.SHORTCUT_TOKEN}:{})},body:payload?JSON.stringify(payload):undefined
});
const props={'Due Date':{date:{start:'2026-11-02',end:'2026-11-06'}}};

test('existing Notion ranges expose both start and actual deadline; single dates remain deadlines',()=>{
 assert.deepEqual(readTaskSchedule(props),{start_date:'2026-11-02',due_date:'2026-11-06',schedule_revision:JSON.stringify([null,props['Due Date'].date])});
 assert.equal(readTaskSchedule({'Due Date':{date:{start:'2026-11-06'}}}).start_date,null);
 assert.equal(readTaskSchedule({'Start Date':{date:{start:'2026-11-03'}},...props}).start_date,'2026-11-02');
 assert.equal(readTaskSchedule({'Due Date':{date:{start:'2026-10-31T16:00:00Z'}}}).due_date,'2026-11-01');
});
test('periods validate calendar dates and order including leap years; empty dates are optional',()=>{
 for(const [a,b,ok] of [[null,null,true],['2028-02-29',null,true],['2026-02-29',null,false],['2026-11-07','2026-11-06',false],['2026-11-06','2026-11-06',true]]){
  assert.equal(validSchedule(a,b),ok);
  assert.equal(validMobileTaskCreate({name:'task',start_date:a,due_date:b}),ok);
 }
 assert.equal(validMobileTaskCreate({name:'task',start_date:false}),false);
 assert.equal(validMobileTaskCreate({name:'task',start_date:0}),false);
});
test('creation stores full periods, start-only or deadline-only without changing real stage timestamps',async()=>{
 const writes=[];
 await withFetch(async(_url,init)=>{writes.push(JSON.parse(init.body).properties);return json({id:ID});},async()=>{
  await createMobileTask(ENV,{name:'period',start_date:'2026-11-02',due_date:'2026-11-06'});
  await createMobileTask(ENV,{name:'start only',start_date:'2026-11-02'});
  await createMobileTask(ENV,{name:'due only',due_date:'2026-11-06'});
 });
 assert.deepEqual(writes[0]['Due Date'].date,{start:'2026-11-02',end:'2026-11-06'});
 assert.equal(writes[0]['Start Date'].date,null);
 assert.equal(writes[1]['Start Date'].date.start,'2026-11-02');assert.ok(!writes[1]['Due Date']);
 assert.deepEqual(writes[2]['Due Date'].date,{start:'2026-11-06',end:null});
 assert.ok(!writes[2]['Start Date']);
 assert.ok(writes.every(p=>p['Since Do']&&!p['Done date']));
});
test('focus excludes explicit future starts even near deadlines, includes running long tasks, and separates undated/blocked',()=>{
 const today='2026-10-27',base={status:'Do'};
 assert.equal(taskFocusState({...base,start_date:'2026-11-01',due_date:'2026-11-02'},today),'upcoming');
 assert.equal(taskFocusState({...base,start_date:today,due_date:'2026-12-31'},today),'now');
 assert.equal(taskFocusState({...base,due_date:'2026-11-03'},today),'now');
 assert.equal(taskFocusState({...base,due_date:'2026-11-04'},today),'upcoming');
 assert.equal(taskFocusState({...base,due_date:'2026-01-01'},today),'now');
 assert.equal(taskFocusState(base,today),'unscheduled');
 assert.equal(taskFocusState({...base,start_date:today,blocked_by:[DEP]},today),'blocked');
 assert.equal(taskFocusState({status:'Waiting',reminder_date:'2026-10-28'},today),'upcoming');
 assert.equal(taskFocusState({status:'Waiting',waiting_since:'2026-10-24'},today),'now');
});
test('editing verifies final dates and patches only schedule fields, leaving status, dependencies and actual dates untouched',async()=>{
 let current=page(props),writes=0;
 await withFetch(async(_url,init)=>{
  if(init?.method==='PATCH'){
   writes++;const data=JSON.parse(init.body);
   assert.deepEqual(Object.keys(data.properties).sort(),['Due Date','Start Date']);
   current=page({...current.properties,...data.properties});
  }return json(current);
 },async()=>{
  const result=await updateMobileSchedule(ENV,{task_id:ID,start_date:'2026-11-03',due_date:'2026-11-09',expected_revision:readTaskSchedule(props).schedule_revision});
  assert.equal(result.verified,true);assert.equal(writes,1);
  assert.equal(current.properties['Due Date'].date.end,'2026-11-09');
 });
});
test('stale edits, invalid order and foreign pages never write',async()=>{
 let writes=0;
 await withFetch(async(_url,init)=>{if(init?.method==='PATCH')writes++;return json(page(props));},async()=>{
  assert.equal((await updateMobileSchedule(ENV,{task_id:ID,start_date:'2026-11-02',due_date:'2026-11-06',expected_revision:'stale'})).status,409);
  assert.equal((await updateMobileSchedule(ENV,{task_id:ID,start_date:'2026-11-07',due_date:'2026-11-06',expected_revision:'x'})).status,400);
 });
 await withFetch(async()=>json(page(props,ID,DEP)),async()=>{
  assert.equal((await updateMobileSchedule(ENV,{task_id:ID,start_date:null,due_date:null,expected_revision:readTaskSchedule(props).schedule_revision})).status,403);
 });assert.equal(writes,0);
});
test('schedule endpoint requires auth and blocks cross-origin writes',async()=>{
 const payload={task_id:ID,start_date:null,due_date:null,expected_revision:'x'};
 assert.equal((await handleMobileApi(req('/api/mobile/task/schedule',payload,false),ENV)).status,401);
 const foreign=req('/api/mobile/task/schedule',payload);foreign.headers.set('Origin','https://evil.test');
 assert.equal((await handleMobileApi(foreign,ENV)).status,403);
 assert.equal((await handleMobileApi(req('/api/mobile/task/schedule'),ENV)).status,405);
});
test('no-op date edits preserve existing time-of-day without writes; clearing supports start-only',async()=>{
 const timed={'Start Date':{date:{start:'2026-11-02T09:00:00+09:00'}},'Due Date':{date:{start:'2026-11-02T09:00:00+09:00',end:'2026-11-06T18:00:00+09:00'}}};
 await withFetch(async(_url,init)=>{assert.notEqual(init?.method,'PATCH');return json(page(timed));},async()=>{
  const result=await updateMobileSchedule(ENV,{task_id:ID,start_date:'2026-11-02',due_date:'2026-11-06',expected_revision:readTaskSchedule(timed).schedule_revision});
  assert.equal(result.changed,false);
 });
 const cleared=scheduleProperties('2026-11-02',null,props);
 assert.equal(cleared['Due Date'].date,null);assert.equal(cleared['Start Date'].date.start,'2026-11-02');
 const preserved=scheduleProperties('2026-11-03','2026-11-06',timed);
 assert.equal(preserved['Due Date'].date.end,'2026-11-06T18:00:00+09:00');
});
test('legacy Scriptable URL is focused by default while mobile all scope retains future/undated tasks',async()=>{
 const future=page({'Due Date':{date:{start:'2099-11-02',end:'2099-11-06'}}});
 const undated=page({},DEP);
 await withFetch(async()=>json({results:[future,undated],has_more:false}),async()=>{
  const focus=await (await handleMobileApi(req('/api/mobile/tasks'),ENV)).json();
  assert.equal(focus.items.length,0);assert.equal(focus.upcoming_count,1);assert.equal(focus.unscheduled_count,1);
  const all=await (await handleMobileApi(req('/api/mobile/tasks?scope=all'),ENV)).json();
  assert.equal(all.items.length,2);assert.equal(all.items[0].due_date,'2099-11-06');
 });
});
test('dependencies remain blocked until their predecessor is actually Done, including failed lookup',async()=>{
 const dependent=page({...props,'次のタスクにより保留中：':{relation:[{id:DEP}]}});
 for(const status of ['Do','Done','Drop','unavailable']){
  await withFetch(async url=>{
   if(url.endsWith('/query'))return json({results:[dependent],has_more:false});
   if(status==='unavailable')throw new Error('network');
   return json(page({Status:{select:{name:status}}},DEP));
  },async()=>{
   const {items}=await listMobileTasks(ENV);
   assert.equal(items[0].blocked_by.length,status==='Done'?0:1);
  });
 }
});
