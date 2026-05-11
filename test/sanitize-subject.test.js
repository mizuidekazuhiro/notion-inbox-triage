import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeSubject } from "../src/email/parseEmail.js";

test("decodes ISO-2022-JP Base64 encoded-word subject", () => {
  const input = "=?iso-2022-jp?B?MjYbJEJGfBsoQiAbJEJJMU8pPVBEJTNORycbKEI=?=";
  assert.equal(sanitizeSubject(input), "26日 姫路出張確認");
});

test("decodes UTF-8 Base64 encoded-word subject", () => {
  const input = "=?UTF-8?B?44GT44KT44Gr44Gh44Gv?=";
  assert.equal(sanitizeSubject(input), "こんにちは");
});

test("keeps plain subject unchanged", () => {
  assert.equal(sanitizeSubject("hello"), "hello");
});

test("returns fallback for empty or null subject", () => {
  assert.equal(sanitizeSubject(""), "(no subject)");
  assert.equal(sanitizeSubject(null), "(no subject)");
});

test("returns original value for invalid encoded-word", () => {
  const input = "=?UTF-8?B?%%%INVALID%%%?=";
  assert.equal(sanitizeSubject(input), input);
});
