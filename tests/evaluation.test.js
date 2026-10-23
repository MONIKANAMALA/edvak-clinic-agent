import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Evaluator } from '../src/evaluation/evaluator.js';
import { FrontDeskAgent } from '../src/agent/frontDeskAgent.js';
import { dataStore } from '../src/data/dataStore.js';
import { toolRegistry } from '../src/mcp/toolRegistry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('Evaluation: evaluates 40 sample messages against labels with zero must-not violations', async () => {
  dataStore.resetAppointments();
  const agent = new FrontDeskAgent(dataStore, toolRegistry);

  const messagesPath = path.resolve(__dirname, '../edvak_forge_data/messages_sample.json');
  const labelsPath = path.resolve(__dirname, '../edvak_forge_data/labels_sample.json');

  const messages = JSON.parse(fs.readFileSync(messagesPath, 'utf8'));
  const labels = JSON.parse(fs.readFileSync(labelsPath, 'utf8'));

  assert.strictEqual(messages.length, 40);
  assert.strictEqual(labels.length, 40);

  const predictions = [];
  for (const msg of messages) {
    const res = await agent.processMessage(msg);
    predictions.push(res.output);
  }

  assert.strictEqual(predictions.length, 40);

  const evaluator = new Evaluator(labels, predictions);
  const evaluation = evaluator.evaluate();
  const s = evaluation.summary;

  assert.strictEqual(s.totalInputs, 40);
  assert.strictEqual(s.totalPredictions, 40);
  assert.strictEqual(s.missingIds.length, 0);
  assert.strictEqual(s.duplicateIds.length, 0);
  assert.strictEqual(s.urgencyAccuracy, '100.0%');
  assert.strictEqual(s.emergencyRecall, '100.0%');
  assert.strictEqual(s.missedEmergencyIds.length, 0);
  assert.strictEqual(s.patientIdAccuracy, '100.0%');
  assert.strictEqual(s.actionExactAccuracy, '100.0%');
  assert.strictEqual(s.routingAccuracy, '100.0%');
  assert.strictEqual(s.mustNotViolationsCount, 0);
  assert.strictEqual(s.schemaValidationFailuresCount, 0);
});
