import test from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeTypePayload, cloneWritableBlockTree, copyPageBody } from '../src/notion/blocks.js';

test('sanitizeTypePayload removes null icon and keeps required fields', () => {
  const payload = {
    rich_text: [{ type: 'text', text: { content: 'hello' } }],
    color: 'default',
    caption: [],
    icon: null,
    children: [{ type: 'paragraph' }],
    created_time: '2024-01-01T00:00:00.000Z',
    some_optional: null
  };

  const sanitized = sanitizeTypePayload(payload);

  assert.equal('icon' in sanitized, false);
  assert.equal('children' in sanitized, false);
  assert.equal('created_time' in sanitized, false);
  assert.equal('some_optional' in sanitized, false);
  assert.deepEqual(sanitized.rich_text, payload.rich_text);
  assert.equal(sanitized.color, 'default');
  assert.deepEqual(sanitized.caption, []);
});


test('cloneWritableBlockTree strips read-only numbered and bulleted list metadata', async () => {
 const block={
  id:'source-1',object:'block',type:'numbered_list_item',has_children:false,
  numbered_list_item:{
   rich_text:[{type:'text',text:{content:'Important item'}}],
   color:'default',
   list_format:'numbers',
   list_start_index:3,
   icon:null,
   children:[{type:'paragraph'}],
   last_edited_time:'2026-11-05T00:00:00.000Z'
  }
 };
 const {writableBlock}=await cloneWritableBlockTree({},block);
 assert.deepEqual(Object.keys(writableBlock.numbered_list_item).sort(),['color','rich_text']);
 assert.equal(writableBlock.numbered_list_item.rich_text[0].text.content,'Important item');
 assert.equal(block.numbered_list_item.list_format,'numbers','source block must not be mutated');
 const bullet=await cloneWritableBlockTree({},{
  ...block,type:'bulleted_list_item',
  bulleted_list_item:{rich_text:[],color:'default',list_format:'bullets'}
 });
 assert.deepEqual(Object.keys(bullet.writableBlock.bulleted_list_item).sort(),['color','rich_text']);
});

test('copyPageBody never sends read-only list_format metadata to Notion',async()=>{
 const originalFetch=global.fetch;
 const sourceBlocks=[
  {id:'s1',type:'numbered_list_item',has_children:false,
   numbered_list_item:{rich_text:[{type:'text',text:{content:'一つ目'}}],color:'default',list_format:'numbers',list_start_index:1}},
  {id:'s2',type:'bulleted_list_item',has_children:false,
   bulleted_list_item:{rich_text:[{type:'text',text:{content:'二つ目'}}],color:'default',list_format:'bullets'}}
 ];
 const writes=[];
 global.fetch=async(url,init={})=>{
  const path=String(url);
  if(init.method==='PATCH'&&path.includes('/v1/blocks/target/children')){
   const payload=JSON.parse(init.body);
   writes.push(payload);
   for(const item of payload.children){
    assert.equal('list_format' in item[item.type],false);
    assert.equal('list_start_index' in item[item.type],false);
   }
   return new Response(JSON.stringify({results:[{id:'out1'},{id:'out2'}]}),{status:200});
  }
  if(path.includes('/v1/blocks/source/children')){
   return new Response(JSON.stringify({results:sourceBlocks,has_more:false}),{status:200});
  }
  throw new Error('unexpected request '+path);
 };
 try{
  const result=await copyPageBody({NOTION_TOKEN:'fake'},'source','target');
  assert.equal(result.sourceTopLevelCount,2);
  assert.equal(result.appendedCount,2);
  assert.equal(writes.length,1);
 }finally{global.fetch=originalFetch;}
});
