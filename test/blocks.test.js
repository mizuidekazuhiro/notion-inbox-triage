import test from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeTypePayload } from '../src/notion/blocks.js';

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
