import { test } from 'node:test';
import assert from 'node:assert';
import {
  isHoliday,
  isWeekend,
  isProviderOnLeave,
  isTimeSlotValid,
  hasBookingConflict,
  findAvailableSlots
} from '../src/policies/schedulingPolicy.js';
import { dataStore } from '../src/data/dataStore.js';

test('Scheduling: Thanksgiving and day after are recognized clinic holidays', () => {
  assert.strictEqual(isHoliday('2026-11-26'), true);
  assert.strictEqual(isHoliday('2026-11-27'), true);
  assert.strictEqual(isHoliday('2026-11-25'), false);
});

test('Scheduling: Weekends are detected correctly', () => {
  assert.strictEqual(isWeekend('2026-11-14'), true); // Saturday
  assert.strictEqual(isWeekend('2026-11-15'), true); // Sunday
  assert.strictEqual(isWeekend('2026-11-09'), false); // Monday
});

test('Scheduling: Provider leave for Dr. Okafor (Nov 16-20) blocks scheduling', () => {
  assert.strictEqual(isProviderOnLeave('OKAFOR', '2026-11-16'), true);
  assert.strictEqual(isProviderOnLeave('OKAFOR', '2026-11-18'), true);
  assert.strictEqual(isProviderOnLeave('OKAFOR', '2026-11-20'), true);
  assert.strictEqual(isProviderOnLeave('OKAFOR', '2026-11-13'), false);
  assert.strictEqual(isProviderOnLeave('PATEL', '2026-11-18'), false);
});

test('Scheduling: Time slot validity enforces :00, :20, :40 starts and lunch break', () => {
  assert.strictEqual(isTimeSlotValid('09:00', 20).valid, true);
  assert.strictEqual(isTimeSlotValid('09:20', 20).valid, true);
  assert.strictEqual(isTimeSlotValid('09:40', 20).valid, true);
  assert.strictEqual(isTimeSlotValid('09:15', 20).valid, false); // invalid minute boundary
  assert.strictEqual(isTimeSlotValid('12:00', 20).valid, false); // lunch overlap
  assert.strictEqual(isTimeSlotValid('11:40', 40).valid, false); // extends into lunch
});

test('Scheduling: Prevents overlapping bookings for the same provider', () => {
  const existing = [
    { provider: 'OKAFOR', date: '2026-11-12', start: '14:00', end: '14:20', status: 'booked' }
  ];
  const conflict = hasBookingConflict(existing, 'OKAFOR', '2026-11-12', '14:00', 20);
  assert.strictEqual(conflict, true);
  const noConflict = hasBookingConflict(existing, 'OKAFOR', '2026-11-12', '14:20', 20);
  assert.strictEqual(noConflict, false);
});
