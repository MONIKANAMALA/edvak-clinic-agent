import { test } from 'node:test';
import assert from 'node:assert';
import { dataStore } from '../src/data/dataStore.js';
import { toolRegistry } from '../src/mcp/toolRegistry.js';
import { FrontDeskAgent } from '../src/agent/frontDeskAgent.js';

test('Identifiers: returns null when patient is not on file', async () => {
  const patient = dataStore.findPatient({
    name: 'Jessica Parker',
    email: 'jess.parker@example.net',
    phone: '555-9999'
  });
  assert.strictEqual(patient, null);
});

test('Identifiers: agent sets patient_id to null for non-patient inquiry', async () => {
  const agent = new FrontDeskAgent(dataStore, toolRegistry);
  const msg = {
    id: 'M007',
    received_at: '2026-11-09T07:40:00-06:00',
    channel: 'email',
    from_name: 'Jessica Parker',
    from_contact: 'jess.parker@example.net',
    body: "Do you accept new patients? I'd like to book a physical."
  };

  const res = await agent.processMessage(msg);
  assert.strictEqual(res.output.patient_id, null);
  assert.deepStrictEqual(res.output.intents, ['new_patient']);
  assert.ok(res.output.actions.includes('offer_new_patient_booking'));
});

test('Identifiers: agent sets patient_id to null for marketing spam from unknown sender', async () => {
  const agent = new FrontDeskAgent(dataStore, toolRegistry);
  const msg = {
    id: 'M038',
    received_at: '2026-11-09T10:40:00-06:00',
    channel: 'email',
    from_name: 'BillingPro Solutions',
    from_contact: 'offers@billingpro.example',
    body: 'Special offer on medical billing services this month only. Reply STOP to unsubscribe.'
  };

  const res = await agent.processMessage(msg);
  assert.strictEqual(res.output.patient_id, null);
  assert.deepStrictEqual(res.output.intents, ['spam']);
  assert.deepStrictEqual(res.output.actions, ['no_action']);
});
