import { test } from 'node:test';
import assert from 'node:assert';
import { assessEmergency, assessUrgency } from '../src/policies/safetyPolicy.js';

test('Safety: detects crushing chest pain with radiation as emergency', () => {
  const res = assessEmergency('Woke up with crushing chest pain going into my left arm, feel sweaty and dizzy. Can someone call me?');
  assert.strictEqual(res.isEmergency, true);
  assert.strictEqual(res.urgency, 'emergency');
  assert.strictEqual(res.action, 'escalate_emergency');
});

test('Safety: detects head injury with confusion in elderly as emergency', () => {
  const res = assessEmergency("This is Margaret Ellis's daughter. Mom fell this morning and hit her head, she seems confused now.");
  assert.strictEqual(res.isEmergency, true);
  assert.strictEqual(res.action, 'escalate_emergency');
});

test('Safety: detects anticoagulant gastrointestinal bleeding as emergency', () => {
  const res = assessEmergency('Refill warfarin please. Also my gums have been bleeding a lot and I have dark stools.');
  assert.strictEqual(res.isEmergency, true);
});

test('Safety: detects severe respiratory failure / asthma exacerbation as emergency', () => {
  const res = assessEmergency("My inhaler isn't helping, I'm wheezing and can't finish sentences.");
  assert.strictEqual(res.isEmergency, true);
});

test('Safety: detects severe neuroglycopenic hypoglycemia as emergency', () => {
  const res = assessEmergency("My blood sugar reading was 45 this morning and I'm shaky and sweaty right now.");
  assert.strictEqual(res.isEmergency, true);
});

test('Safety: does not falsely escalate colloquial idioms ("dying to get in")', () => {
  const res = assessEmergency("I'm dying to get in before my trip lol, any chance of a physical with Sarah Kim this week?");
  assert.strictEqual(res.isEmergency, false);
});

test('Safety: classifies mood/depression concerns as urgent clinical triage', () => {
  const res = assessUrgency("Refill sertraline please. Also, I've been feeling really low lately and some days I don't see the point of anything.");
  assert.strictEqual(res.urgency, 'urgent');
  assert.ok(res.actions.includes('route_to_clinician'));
});
