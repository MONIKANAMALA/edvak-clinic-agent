import { test } from 'node:test';
import assert from 'node:assert';
import { validateAgentOutput } from '../src/schemas/outputSchema.js';

test('Schema: passes valid agent output', () => {
  const valid = {
    id: 'M001',
    patient_id: 'P002',
    intents: ['refill'],
    urgency: 'routine',
    actions: ['prepare_refill_for_approval'],
    routed_to: ['provider_refills'],
    tool_calls: ['find_patient', 'check_refill_eligibility'],
    reply_draft: 'Your refill has been prepared.'
  };

  const res = validateAgentOutput(valid);
  assert.strictEqual(res.success, true);
});

test('Schema: rejects unknown action vocabulary', () => {
  const invalid = {
    id: 'M001',
    patient_id: 'P002',
    intents: ['refill'],
    urgency: 'routine',
    actions: ['custom_invented_action'], // not in ALLOWED_ACTIONS
    routed_to: ['provider_refills'],
    tool_calls: [],
    reply_draft: 'Sample reply'
  };

  const res = validateAgentOutput(invalid);
  assert.strictEqual(res.success, false);
});

test('Schema: rejects invalid urgency level', () => {
  const invalid = {
    id: 'M001',
    patient_id: 'P002',
    intents: ['refill'],
    urgency: 'critical', // only 'emergency', 'urgent', 'routine' allowed
    actions: ['escalate_emergency'],
    routed_to: ['clinician_urgent'],
    tool_calls: [],
    reply_draft: 'Sample reply'
  };

  const res = validateAgentOutput(invalid);
  assert.strictEqual(res.success, false);
});

test('Schema: rejects missing reply_draft', () => {
  const invalid = {
    id: 'M001',
    patient_id: 'P002',
    intents: ['refill'],
    urgency: 'routine',
    actions: ['prepare_refill_for_approval'],
    routed_to: ['provider_refills'],
    tool_calls: [],
    reply_draft: '' // empty string
  };

  const res = validateAgentOutput(invalid);
  assert.strictEqual(res.success, false);
});
