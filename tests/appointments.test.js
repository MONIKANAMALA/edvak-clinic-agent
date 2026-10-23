import { test } from 'node:test';
import assert from 'node:assert';
import { dataStore } from '../src/data/dataStore.js';
import { toolRegistry } from '../src/mcp/toolRegistry.js';

test('Appointments: books appointment with duration and boundary validation', async () => {
  dataStore.resetAppointments();
  const bookRes = await toolRegistry.executeTool('book_appointment', {
    patient_id: 'P013',
    provider: 'PATEL',
    date: '2026-11-17',
    start: '09:00',
    visit_type: 'follow_up'
  });

  assert.strictEqual(bookRes.success, true);
  assert.strictEqual(bookRes.appointment.start, '09:00');
  assert.strictEqual(bookRes.appointment.end, '09:20');
});

test('Appointments: reschedules existing appointment and updates in-memory store', async () => {
  dataStore.resetAppointments();
  // Get existing appointment
  const appts = dataStore.getAppointments({ patient_id: 'P007', date: '2026-11-11' });
  assert.ok(appts.length > 0);
  const targetId = appts[0].id;

  const reschedRes = await toolRegistry.executeTool('reschedule_appointment', {
    appointment_id: targetId,
    date: '2026-11-13',
    start: '14:00',
    end: '14:20'
  });

  assert.strictEqual(reschedRes.success, true);
  assert.strictEqual(reschedRes.appointment.date, '2026-11-13');
  assert.strictEqual(reschedRes.appointment.start, '14:00');

  // Verify memory update
  const updated = dataStore.getAppointmentById(targetId);
  assert.strictEqual(updated.date, '2026-11-13');
});

test('Appointments: cancels appointment and updates status in-memory', async () => {
  dataStore.resetAppointments();
  const appts = dataStore.getAppointments({ patient_id: 'P011', date: '2026-11-10' });
  assert.ok(appts.length > 0);
  const targetId = appts[0].id;

  const cancelRes = await toolRegistry.executeTool('cancel_appointment', {
    appointment_id: targetId
  });

  assert.strictEqual(cancelRes.success, true);
  assert.strictEqual(cancelRes.appointment.status, 'cancelled');

  const updated = dataStore.getAppointmentById(targetId);
  assert.strictEqual(updated.status, 'cancelled');
});

test('Appointments: blocks booking during provider leave', async () => {
  dataStore.resetAppointments();
  const bookRes = await toolRegistry.executeTool('book_appointment', {
    patient_id: 'P025',
    provider: 'OKAFOR',
    date: '2026-11-18', // Dr. Okafor on leave Nov 16-20
    start: '10:00',
    visit_type: 'follow_up'
  });

  assert.strictEqual(bookRes.success, false);
  assert.strictEqual(bookRes.on_leave, true);
  assert.strictEqual(bookRes.action, 'offer_alternatives');
});
