import { test } from 'node:test';
import assert from 'node:assert';
import { verifySender } from '../src/policies/privacyPolicy.js';
import { dataStore } from '../src/data/dataStore.js';

test('Patient verification: matches phone on file', () => {
  const patient = dataStore.getPatientById('P001'); // Linda Morales, phone: 555-0101
  const result = verifySender(patient, {
    from_name: 'Linda Morales',
    from_contact: '555-0101',
    channel: 'sms'
  });
  assert.strictEqual(result.isVerified, true);
  assert.strictEqual(result.isCaregiver, false);
});

test('Patient verification: matches email on file', () => {
  const patient = dataStore.getPatientById('P002'); // Robert Chen, email: robert.chen@example.com
  const result = verifySender(patient, {
    from_name: 'Robert Chen',
    from_contact: 'robert.chen@example.com',
    channel: 'portal'
  });
  assert.strictEqual(result.isVerified, true);
});

test('Patient verification: authorised caregiver on file verified via phone', () => {
  const patient = dataStore.getPatientById('P009'); // Sofia Rossi, caregiver: Anna Rossi, phone: 555-0109
  const result = verifySender(patient, {
    from_name: 'Anna Rossi',
    from_contact: '555-0109',
    channel: 'sms'
  });
  assert.strictEqual(result.isVerified, true);
  assert.strictEqual(result.isCaregiver, true);
});

test('Patient verification: fails when email unknown and DOB mismatch', () => {
  const patient = dataStore.getPatientById('P002'); // Robert Chen, dob: 1971-11-02
  const result = verifySender(patient, {
    from_name: 'Robert Chen',
    from_contact: 'rchen.new@example.org',
    stated_dob: '1971-11-20',
    channel: 'email'
  });
  assert.strictEqual(result.isVerified, false);
});

test('Patient verification: rejects third party (spouse not on file)', () => {
  const patient = dataStore.getPatientById('P013'); // Grace Park, no caregiver
  const result = verifySender(patient, {
    from_name: 'Mike',
    from_contact: '555-0888',
    channel: 'sms',
    body: 'Can you tell me if my wife Grace Park has an appointment this week?'
  });
  assert.strictEqual(result.isVerified, false);
  assert.strictEqual(result.isThirdParty, true);
});
