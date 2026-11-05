import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { clientJs } from "../src/mobile/client.js";
import { html, css } from "../src/mobile/shell.js";

class Element {
  constructor() {
    this.children = [];
    this.handlers = {};
    this.dataset = {};
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.style = {};
    this.value = "";
    this.textContent = "";
    this.classList = { add() {}, toggle() {} };
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; }
  addEventListener(name, fn) { (this.handlers[name] ||= []).push(fn); }
  setAttribute() {}
  removeAttribute() {}
  focus() {}
  querySelectorAll() { return []; }
  async trigger(name) {
    for (const fn of this.handlers[name] || []) await fn({ preventDefault() {} });
  }
}

const tasks = [
  { id: "11111111111111111111111111111111", name: "資料作成", status: "Do", task_level: "子タスク", is_parent: false, focus_state: "now" },
  { id: "22222222222222222222222222222222", name: "確認依頼", status: "Waiting", task_level: "子タスク", is_parent: false, focus_state: "now" },
  { id: "33333333333333333333333333333333", name: "案件全体", status: "Do", task_level: "親タスク", is_parent: true, focus_state: "now" }
];

const json = data => new Response(JSON.stringify(data), {
  status: 200,
  headers: { "Content-Type": "application/json" }
});
async function until(predicate) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  throw new Error("UI did not settle");
}
function browser(mode = "verified") {
  const elements = new Map();
  const el = id => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  const tabs = ["inbox", "tasks"].map(tab => {
    const node = new Element();
    node.dataset.tab = tab;
    return node;
  });
  const postCalls = [];
  const document = {
    getElementById: el,
    createElement: () => new Element(),
    querySelectorAll(selector) { return selector === "[data-tab]" ? tabs : []; },
    querySelector: () => new Element(),
    addEventListener() {},
    body: new Element()
  };
  const fetch = async (path, options = {}) => {
    if (path === "/api/mobile/session") return json({ ok: true });
    if (path === "/api/mobile/inbox") return json({ ok: true, items: [] });
    if (path === "/api/mobile/tasks?scope=all") return json({ ok: true, items: tasks });
    if (path === "/api/mobile/projects") return json({ ok: true, items: [] });
    if (path === "/api/mobile/task/status") {
      postCalls.push(JSON.parse(options.body));
      return json({ ok: true, verified: mode !== "unverified" });
    }
    throw new Error("unexpected request " + path);
  };
  const window = { location: { search: "?tab=tasks" }, confirm: () => true };
  new vm.Script(clientJs).runInNewContext({
    document, window, fetch,
    navigator: {}, sessionStorage: { removeItem() {} }, URL, URLSearchParams, console
  }, { timeout: 2000 });
  return { el, postCalls };
}

test("bulk UI exposes filtered selection and reuses the authenticated single-task API", async () => {
  assert.match(html, /id="bulk-toggle"/);
  assert.match(html, /id="bulk-select-visible"/);
  assert.match(html, /id="bulk-apply"/);
  assert.match(css, /\.bulk-item/);
  const page = browser();
  await until(() => page.el("tasks-list").children.length > 0);
  await page.el("bulk-toggle").trigger("click");
  await page.el("bulk-select-visible").trigger("click");
  assert.equal(page.el("bulk-count").textContent, "2件選択");
  page.el("bulk-target").value = "Done";
  await page.el("bulk-apply").trigger("click");
  await until(() => page.el("status-line").textContent.includes("2/2件の完了を確認"));
  assert.deepEqual(page.postCalls.map(x => [x.task_id, x.expected_status, x.to]), [
    [tasks[0].id, "Do", "Done"],
    [tasks[1].id, "Waiting", "Done"]
  ]);
  assert.equal(page.el("bulk-toggle").getAttribute?.("aria-pressed"), undefined);
  assert.equal(page.el("bulk-actions").hidden, true);
});

test("bulk status changes stop at first unverified response, avoiding repeat writes", async () => {
  const page = browser("unverified");
  await until(() => page.el("tasks-list").children.length > 0);
  await page.el("bulk-toggle").trigger("click");
  await page.el("bulk-select-visible").trigger("click");
  page.el("bulk-target").value = "Done";
  await page.el("bulk-apply").trigger("click");
  await until(() => page.el("status-line").textContent.includes("確認不能な更新"));
  assert.equal(page.postCalls.length, 1);
  assert.equal(page.el("bulk-actions").hidden, true);
});
