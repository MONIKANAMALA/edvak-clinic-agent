import { test } from 'node:test';
import assert from 'node:assert';
import { evaluateRefillEligibility, findMatchingMedication, addDays } from '../src/policies/refillPolicy.js';
import { dataStore } from '../src/data/dataStore.js';

test('Refill policy: eligible medication within 7-day window is prepared for approval', () => {
  const patient = dataStore.getPatientById('P002'); // Robert Chen, last visit 2026-09-15
  const medication = {
    patient_id: 'P002',
    medication: 'Lisinopril 10 mg',
    controlled_schedule: null,
    days_supply: 30,
    last_filled: '2026-10-14', // supply depletes 2026-11-13; within 7 days of 2026-11-09
    refills_remaining: 3,
    prescriber: 'OKAFOR'
  };

  const res = evaluateRefillEligibility({ patient, medication, today: '2026-11-09' });
  assert.strictEqual(res.eligible, true);
  assert.deepStrictEqual(res.actions, ['prepare_refill_for_approval']);
  assert.deepStrictEqual(res.routed_to, ['provider_refills']);
});

test('Refill policy: controlled substance C-IV cannot be prepared by agent', () => {
  const patient = dataStore.getPatientById('P006'); // Marcus Bell
  const medication = {
    patient_id: 'P006',
    medication: 'Alprazolam 0.5 mg',
    controlled_schedule: 'C-IV',
    days_supply: 30,
    last_filled: '2026-10-15',
    refills_remaining: 0,
    prescriber: 'OKAFOR'
  };

  const res = evaluateRefillEligibility({ patient, medication, today: '2026-11-09' });
  assert.strictEqual(res.eligible, false);
  assert.strictEqual(res.isControlled, true);
  assert.deepStrictEqual(res.actions, ['route_to_provider']);
});

test('Refill policy: patient not seen in 12 months requires visit before refill', () => {
  const patient = dataStore.getPatientById('P004'); // Thomas Wright, last visit 2025-06-10 (> 12m)
  const medication = {
    patient_id: 'P004',
    medication: 'Metformin 500 mg',
    controlled_schedule: null,
    days_supply: 30,
    last_filled: '2026-10-12',
    refills_remaining: 2,
    prescriber: 'OKAFOR'
  };

  const res = evaluateRefillEligibility({ patient, medication, today: '2026-11-09' });
  assert.strictEqual(res.eligible, false);
  assert.strictEqual(res.needsVisit, true);
  assert.ok(res.actions.includes('refill_needs_visit'));
  assert.ok(res.actions.includes('offer_appointment'));
});

test('Refill policy: zero refills remaining routes to provider for new authorization', () => {
  const patient = dataStore.getPatientById('P008'); // George Adams
  const medication = {
    patient_id: 'P008',
    medication: 'Amlodipine 5 mg',
    controlled_schedule: null,
    days_supply: 30,
    last_filled: '2026-10-12',
    refills_remaining: 0,
    prescriber: 'PATEL'
  };

  const res = evaluateRefillEligibility({ patient, medication, today: '2026-11-09' });
  assert.strictEqual(res.eligible, false);
  assert.strictEqual(res.zeroRefills, true);
  assert.deepStrictEqual(res.actions, ['route_to_provider']);
});

test('Refill policy: request earlier than 7 days returns refill_too_early and earliest date', () => {
  const patient = dataStore.getPatientById('P015'); // Fatima Hassan
  const medication = {
    patient_id: 'P015',
    medication: 'Omeprazole 20 mg',
    controlled_schedule: null,
    days_supply: 30,
    last_filled: '2026-10-25', // depletes Nov 24; earliest Nov 17
    refills_remaining: 2,
    prescriber: 'PATEL'
  };

  const res = evaluateRefillEligibility({ patient, medication, today: '2026-11-09' });
  assert.strictEqual(res.eligible, false);
  assert.strictEqual(res.tooEarly, true);
  assert.strictEqual(res.earliestRequestDate, '2026-11-17');
  assert.deepStrictEqual(res.actions, ['refill_too_early']);
});
