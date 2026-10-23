import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  ALLOWED_ACTIONS,
  ALLOWED_URGENCIES,
  ALLOWED_ROUTING_QUEUES
} from '../src/policies/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('Vocabulary: ALLOWED_ACTIONS has exactly 20 standard actions', () => {
  assert.strictEqual(ALLOWED_ACTIONS.length, 20);
});

test('Vocabulary: ALLOWED_URGENCIES has exactly 3 urgency levels', () => {
  assert.deepStrictEqual(ALLOWED_URGENCIES, ['emergency', 'urgent', 'routine']);
});

test('Vocabulary: ALLOWED_ROUTING_QUEUES matches clinic policy queues', () => {
  assert.deepStrictEqual(ALLOWED_ROUTING_QUEUES, [
    'clinician_urgent',
    'clinician_routine',
    'provider_refills',
    'front_desk',
    'billing'
  ]);
});

test('Vocabulary: All actions in labels_sample.json exist in ALLOWED_ACTIONS', () => {
  const labelsPath = path.resolve(__dirname, '../edvak_forge_data/labels_sample.json');
  const labels = JSON.parse(fs.readFileSync(labelsPath, 'utf8'));

  for (const label of labels) {
    for (const action of label.expected_actions) {
      assert.ok(
        ALLOWED_ACTIONS.includes(action),
        `Action "${action}" from label ${label.id} is not in ALLOWED_ACTIONS`
      );
    }
  }
});
