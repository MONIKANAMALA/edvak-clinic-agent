import assert from 'assert';
import { assessEmergency, assessUrgency } from '../src/policies/safetyPolicy.js';
import { verifySender } from '../src/policies/privacyPolicy.js';
import { evaluateRefillEligibility } from '../src/policies/refillPolicy.js';
import { isProviderOnLeave, hasBookingConflict, findAvailableSlots, isTimeSlotValid } from '../src/policies/schedulingPolicy.js';
import { dataStore } from '../src/data/dataStore.js';

console.log('====================================================');
console.log(' Maplewood Family Clinic - Safety & Invariant Tests');
console.log('====================================================');

let testsPassed = 0;
let testsFailed = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`[PASS] ${name}`);
    testsPassed++;
  } catch (err) {
    console.error(`[FAIL] ${name}: ${err.message}`);
    testsFailed++;
  }
}

// 1. Emergency Escalation Tests
runTest('Safety: Cardiac distress (crushing chest pain radiating to left arm) triggers emergency', () => {
  const res = assessEmergency('Woke up with crushing chest pain going into my left arm, feel sweaty and dizzy.');
  assert.strictEqual(res.isEmergency, true);
  assert.strictEqual(res.action, 'escalate_emergency');
});

runTest('Safety: Head injury with confusion in elderly triggers emergency', () => {
  const res = assessEmergency('Mom fell this morning and hit her head, she seems confused now.');
  assert.strictEqual(res.isEmergency, true);
  assert.strictEqual(res.action, 'escalate_emergency');
});

runTest('Safety: Bleeding on anticoagulant (warfarin) triggers emergency', () => {
  const res = assessEmergency('Refill warfarin please. Also my gums have been bleeding a lot and I have dark stools.');
  assert.strictEqual(res.isEmergency, true);
});

runTest('Safety: Severe acute respiratory distress (inhaler failing) triggers emergency', () => {
  const res = assessEmergency("My inhaler isn't helping, I'm wheezing and can't finish sentences.");
  assert.strictEqual(res.isEmergency, true);
});

runTest('Safety: Severe hypoglycemia on insulin (blood sugar 45) triggers emergency', () => {
  const res = assessEmergency("My blood sugar reading was 45 this morning and I'm shaky and sweaty right now.");
  assert.strictEqual(res.isEmergency, true);
});

// 2. Idiom Differentiation (No False Positive Escalation)
runTest('Safety: Colloquial idiom ("dying to get in") must NOT escalate as emergency', () => {
  const res = assessEmergency("I'm dying to get in before my trip lol, any chance of a physical with Sarah Kim this week?");
  assert.strictEqual(res.isEmergency, false);
});

// 3. Privacy & Unauthorized Third-Party Disclosure Prevention
runTest('Privacy: Unknown email and mismatched DOB must reject verification and block disclosure', () => {
  const patient = dataStore.getPatientById('P002'); // Robert Chen, dob: 1971-11-02
  const verification = verifySender(patient, {
    from_name: 'Robert Chen',
    from_contact: 'rchen.new@example.org',
    stated_dob: '1971-11-20',
    body: 'Please send my lab results to this email.'
  });
  assert.strictEqual(verification.isVerified, false);
});

runTest('Privacy: Third party (husband not on file) must be denied appointment disclosure', () => {
  const patient = dataStore.getPatientById('P013'); // Grace Park, no caregiver on file
  const verification = verifySender(patient, {
    from_name: 'Mike',
    from_contact: '555-0888',
    body: 'Can you tell me if my wife Grace Park has an appointment this week?'
  });
  assert.strictEqual(verification.isVerified, false);
  assert.strictEqual(verification.isThirdParty, true);
});

runTest('Privacy: Authorized caregiver on file is verified successfully', () => {
  const patient = dataStore.getPatientById('P017'); // Margaret Ellis, caregiver: Claire Ellis (555-0177)
  const verification = verifySender(patient, {
    from_name: 'Claire Ellis',
    from_contact: '555-0177',
    body: "Mom's donepezil refill please"
  });
  assert.strictEqual(verification.isVerified, true);
  assert.strictEqual(verification.isCaregiver, true);
});

// 4. Refill Invariants: Controlled Substances & Policy Rules
runTest('Refill Policy: Controlled substances (Xanax / Alprazolam) cannot be prepared by agent', () => {
  const patient = dataStore.getPatientById('P006');
  const medication = {
    medication: 'Alprazolam 0.5 mg',
    controlled_schedule: 'C-IV',
    days_supply: 30,
    last_filled: '2026-10-15',
    refills_remaining: 0,
    prescriber: 'OKAFOR'
  };
  const evalResult = evaluateRefillEligibility({ patient, medication, today: '2026-11-09' });
  assert.strictEqual(evalResult.eligible, false);
  assert.strictEqual(evalResult.isControlled, true);
  assert.ok(evalResult.actions.includes('route_to_provider'));
  assert.ok(!evalResult.actions.includes('prepare_refill_for_approval'));
});

runTest('Refill Policy: Patient not seen in 12 months requires visit before refill', () => {
  const patient = dataStore.getPatientById('P004'); // last_visit: 2025-06-10 (> 12 months from 2026-11-09)
  const medication = {
    medication: 'Metformin 500 mg',
    controlled_schedule: null,
    days_supply: 30,
    last_filled: '2026-10-12',
    refills_remaining: 2,
    prescriber: 'OKAFOR'
  };
  const evalResult = evaluateRefillEligibility({ patient, medication, today: '2026-11-09' });
  assert.strictEqual(evalResult.eligible, false);
  assert.strictEqual(evalResult.needsVisit, true);
  assert.ok(evalResult.actions.includes('refill_needs_visit'));
  assert.ok(evalResult.actions.includes('offer_appointment'));
  assert.ok(!evalResult.actions.includes('prepare_refill_for_approval'));
});

runTest('Refill Policy: Refill requested > 7 days before depletion is too early', () => {
  const patient = dataStore.getPatientById('P015');
  const medication = {
    medication: 'Omeprazole 20 mg',
    controlled_schedule: null,
    days_supply: 30,
    last_filled: '2026-10-25', // Depletes Nov 24, earliest request Nov 17
    refills_remaining: 2,
    prescriber: 'PATEL'
  };
  const evalResult = evaluateRefillEligibility({ patient, medication, today: '2026-11-09' });
  assert.strictEqual(evalResult.eligible, false);
  assert.strictEqual(evalResult.tooEarly, true);
  assert.strictEqual(evalResult.earliestRequestDate, '2026-11-17');
  assert.ok(evalResult.actions.includes('refill_too_early'));
  assert.ok(!evalResult.actions.includes('prepare_refill_for_approval'));
});

// 5. Scheduling Invariants: Provider Leave & Double Booking
runTest('Scheduling: Booking on provider leave (Okafor Nov 16-20) is blocked', () => {
  const onLeave = isProviderOnLeave('OKAFOR', '2026-11-18');
  assert.strictEqual(onLeave, true);
});

runTest('Scheduling: Overlapping appointment causes conflict detection', () => {
  const existing = [
    { provider: 'OKAFOR', date: '2026-11-12', start: '14:00', end: '14:20', status: 'booked' }
  ];
  const conflict = hasBookingConflict(existing, 'OKAFOR', '2026-11-12', '14:00', 20);
  assert.strictEqual(conflict, true);
});

runTest('Scheduling: Appointments during lunch break (12:00-13:00) are invalid', () => {
  const valid = isTimeSlotValid('12:20', 20);
  assert.strictEqual(valid.valid, false);
});

console.log('----------------------------------------------------');
console.log(`Safety & Invariant Test Results: ${testsPassed} passed, ${testsFailed} failed.`);
console.log('====================================================');

if (testsFailed > 0) {
  process.exit(1);
}
