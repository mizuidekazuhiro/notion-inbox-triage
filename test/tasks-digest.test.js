import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyTasksForDigest,
  isParentTask
} from "../src/utils/tasksDigest.js";
import { buildTasksDigestMail } from "../src/mail/buildTasksDigestMail.js";
import { resolveSnoozeDate } from "../src/routes/confirm.js";
import { mapTaskPage } from "../src/notion/tasks.js";

const TODAY = new Date("2026-09-10T15:00:00.000Z"); // 2026-09-11 JST

function task(overrides = {}) {
  return {
    id: overrides.id || overrides.name || "id",
    name: "Task",
    status: "Do",
    priority: "Mid",
    dueDateISO: "2026-09-11",
    sinceDoISO: "2026-09-10",
    reminderDateISO: null,
    waitingSinceISO: null,
    taskLevel: "子タスク",
    parentTaskName: "",
    url: "",
    ...overrides
  };
}

test("親タスクはDaily Digestから除外する", () => {
  assert.equal(isParentTask(task({ taskLevel: "親タスク" })), true);
  const digest = classifyTasksForDigest(
    [
      task({ name: "Parent", taskLevel: "親タスク" }),
      task({ name: "Child", parentTaskName: "Parent" })
    ],
    TODAY
  );
  assert.deepEqual(digest.actionNow.map((item) => item.name), ["Child"]);
});

test("DoはAction Now / Long Overdue / Coming Up / Needs Setupに分類する", () => {
  const digest = classifyTasksForDigest(
    [
      task({ name: "Now", dueDateISO: "2026-09-07", sinceDoISO: "2026-09-07" }),
      task({ name: "OldDue", dueDateISO: "2026-06-04", sinceDoISO: "2026-06-04" }),
      task({ name: "OldDo", dueDateISO: "2026-09-02", sinceDoISO: "2026-07-30" }),
      task({ name: "Future", dueDateISO: "2026-10-09", sinceDoISO: "2026-07-17" }),
      task({ name: "NoDue", dueDateISO: null })
    ],
    TODAY
  );

  assert.deepEqual(digest.actionNow.map((item) => item.name), ["Now"]);
  assert.deepEqual(digest.longOverdue.map((item) => item.name), ["OldDue", "OldDo"]);
  assert.deepEqual(digest.comingUp.map((item) => item.name), ["Future"]);
  assert.deepEqual(digest.needsSetup.map((item) => item.name), ["NoDue"]);
});

test("将来Reminder DateのDo/WaitingはSnooze中としてDigestから外す", () => {
  const digest = classifyTasksForDigest(
    [
      task({ name: "DoSnoozed", reminderDateISO: "2026-09-14" }),
      task({
        name: "WaitingSnoozed",
        status: "Waiting",
        dueDateISO: "2026-09-01",
        waitingSinceISO: "2026-08-01",
        reminderDateISO: "2026-09-14"
      })
    ],
    TODAY
  );

  assert.equal(digest.actionNow.length, 0);
  assert.equal(digest.followUp.length, 0);
});

test("Waiting Sinceが3日以上ならFollow-up、日付情報が無いWaitingはNeeds Setup", () => {
  const digest = classifyTasksForDigest(
    [
      task({
        name: "Follow",
        status: "Waiting",
        waitingSinceISO: "2026-09-02",
        dueDateISO: "2026-09-07"
      }),
      task({
        name: "BrokenWaiting",
        status: "Waiting",
        waitingSinceISO: null,
        reminderDateISO: null,
        dueDateISO: "2026-02-21"
      })
    ],
    TODAY
  );

  assert.deepEqual(digest.followUp.map((item) => item.name), ["Follow"]);
  assert.deepEqual(digest.needsSetup.map((item) => item.name), ["BrokenWaiting"]);
});

test("Notion mapperは正しい Waiting Since と親子プロパティを読む", () => {
  const mapped = mapTaskPage({
    id: "child",
    url: "https://notion.so/child",
    properties: {
      "名前": { title: [{ plain_text: "Child" }] },
      Status: { select: { name: "Waiting" } },
      Priority: { select: { name: "High" } },
      "Due Date": { date: { start: "2026-09-07" } },
      "Reminder Date": { date: null },
      "Waiting Since": { date: { start: "2026-09-02" } },
      "Since Do": { date: null },
      "Since Someday": { date: null },
      "Task Level": { select: { name: "子タスク" } },
      "Parent Task": { relation: [{ id: "parent" }] },
      "Child Tasks": { relation: [] },
      Summary: { rich_text: [] },
      "My Tasks": { rich_text: [] },
      "Other Tasks": { rich_text: [] }
    }
  });

  assert.equal(mapped.waitingSinceISO, "2026-09-02");
  assert.equal(mapped.taskLevel, "子タスク");
  assert.deepEqual(mapped.parentTaskIds, ["parent"]);
});

test("メールは子タスクに親タスク名とSnoozeボタンを表示する", () => {
  const html = buildTasksDigestMail({
    actionNow: [
      task({
        name: "資料作成",
        parentTaskName: "Kalyani面談",
        dueDateISO: "2026-09-02"
      })
    ],
    longOverdue: [],
    followUp: [],
    comingUp: [],
    needsSetup: [],
    somedayItems: [],
    baseUrl: "https://example.com",
    weekStart: false,
    todayJstStr: "2026-09-11"
  });

  assert.match(html, /資料作成/);
  assert.match(html, /Kalyani面談/);
  assert.match(html, /snooze_days=1/);
  assert.match(html, /snooze_days=3/);
  assert.doesNotMatch(html, /Thinking<\/a>/);
});

test("Snooze日はJST基準で計算する", () => {
  assert.equal(
    resolveSnoozeDate(3, new Date("2026-09-11T00:00:00.000Z")),
    "2026-09-14"
  );
});
