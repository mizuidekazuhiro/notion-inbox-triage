import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../scripts/NotionWeekSchedule.js", import.meta.url), "utf8");

class MockStack {
  constructor(all) { this.all = all; this.stacks = []; this.spacers = []; this.texts = []; }
  addText(value) {
    const label = { text: String(value), font: null, textColor: null, lineLimit: null, minimumScaleFactor: null };
    this.texts.push(label); this.all.push(label);
    return label;
  }
  addStack() {
    const stack = new MockStack(this.all);
    this.stacks.push(stack);
    return stack;
  }
  addSpacer(size) { this.spacers.push(size); }
  layoutHorizontally() {}
  layoutVertically() {}
  centerAlignContent() {}
}
class MockWidget extends MockStack {
  constructor() { super([]); this.padding = null; }
  setPadding(...padding) { this.padding = padding; }
}
const event = (id) => ({
  id: String(id),
  title: "予定" + id,
  start: "2026-10-" + String(13 + id).padStart(2, "0") + "T09:00:00+09:00",
  end: null,
  all_day: false,
  url: "https://www.notion.so/" + id
});

async function render(family, count=6) {
  const items = Array.from({length:count},(_,i)=>event(i+1));
  let rendered;
  const sandbox = {
    Keychain: { contains: () => true, get: () => "unit-test-token" },
    config: { runsInWidget:true, widgetFamily:family },
    Request: class {
      constructor(url) { this.url = url; }
      async loadJSON() { return { ok:true, count:items.length, items }; }
    },
    ListWidget: class extends MockWidget {
      constructor() { super(); }
    },
    LinearGradient: class { constructor() { this.colors=[]; this.locations=[]; } },
    Color: class { constructor(hex,alpha) { this.hex=hex; this.alpha=alpha; } },
    Size: class { constructor(width,height) { this.width=width; this.height=height; } },
    Font: {
      systemFont: size => ({ size }),
      mediumSystemFont: size => ({ size, weight:"medium" }),
      semiboldSystemFont: size => ({ size, weight:"semibold" })
    },
    Script: { setWidget: widget => { rendered=widget; }, complete() {} },
    Date, Intl, console
  };
  const program = new vm.Script("(async () => {\n" + source + "\n})()", { filename:"NotionWeekSchedule.js" });
  await program.runInNewContext(sandbox, {timeout:3000});
  assert.ok(rendered, "Scriptable should set a widget");
  return { rendered, texts:rendered.all.map(item=>item.text) };
}

test("medium shows five appointments and a compact overflow count",async()=>{
  const {rendered,texts}=await render("medium",6);
  for(let n=1;n<=5;n++) assert.ok(texts.includes("予定"+n), "should show event "+n);
  assert.ok(!texts.includes("予定6"), "sixth appointment must not overflow the visible area");
  assert.ok(texts.includes("5/6件"));
  assert.ok(texts.some(t=>t.includes("10/14") && t.includes("09:00")));
  assert.deepEqual(rendered.padding,[10,13,9,13]);
  const untilRefresh = rendered.refreshAfterDate.getTime() - Date.now();
  assert.ok(untilRefresh > 4.9*60*1000 && untilRefresh <= 5*60*1000,
    "refreshAfterDate must request the earliest refresh at five minutes");
  assert.equal(texts.filter(t=>t.startsWith("10/")).length,5);
  assert.ok(!texts.some(t=>t.includes("ほか 1 件")), "medium footer should not consume row space");
});
test("medium shows all four appointments without an overflow indicator",async()=>{
  const {texts}=await render("medium",4);
  assert.ok(texts.includes("4件"));
  assert.equal(texts.filter(t=>t.startsWith("10/")).length,4);
  assert.equal(texts.filter(t=>t.startsWith("予定")).length,4);
});
test("small and large keep the existing display limits",async()=>{
  const small=await render("small",6);
  const large=await render("large",6);
  assert.equal(small.texts.filter(t=>t.startsWith("予定")).length,2);
  assert.ok(small.texts.some(t=>t.includes("ほか 4 件")));
  assert.equal(large.texts.filter(t=>t.startsWith("予定")).length,6);
  assert.deepEqual(large.rendered.padding,[13,14,12,14]);
});
