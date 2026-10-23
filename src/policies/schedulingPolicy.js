/**
 * Scheduling Policy: Clinic Hours, Provider Leave, Holidays, Durations, and Conflict Detection
 */

export const CLINIC_CONFIG = {
  open: '09:00',
  close: '17:00',
  lunchStart: '12:00',
  lunchEnd: '13:00',
  holidays: ['2026-11-26', '2026-11-27', '2026-12-25'],
  providers: {
    PATEL: { id: 'PATEL', name: 'Dr. Maya Patel', leave: [] },
    OKAFOR: { id: 'OKAFOR', name: 'Dr. James Okafor', leave: [['2026-11-16', '2026-11-20']] },
    KIM: { id: 'KIM', name: 'Sarah Kim, NP', leave: [] }
  },
  visitDurations: {
    new_patient: 40,
    annual_physical: 40,
    follow_up: 20,
    sick_visit: 20,
    telehealth: 20
  }
};

/**
 * Convert HH:MM to total minutes from midnight
 */
export function timeToMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Convert minutes from midnight to HH:MM
 */
export function minutesToTime(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Check if date is a weekend (Sat/Sun)
 */
export function isWeekend(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const day = d.getUTCDay();
  return day === 0 || day === 6; // Sunday = 0, Saturday = 6
}

/**
 * Check if date is a clinic holiday
 */
export function isHoliday(dateStr) {
  return CLINIC_CONFIG.holidays.includes(dateStr);
}

/**
 * Check if a provider is on leave on a given date
 */
export function isProviderOnLeave(providerId, dateStr) {
  const provider = CLINIC_CONFIG.providers[providerId];
  if (!provider || !provider.leave) return false;
  return provider.leave.some(([start, end]) => dateStr >= start && dateStr <= end);
}

/**
 * Check if a proposed time slot is valid under clinic operating rules:
 * - Starts at :00, :20, or :40
 * - Falls between 09:00 and 17:00
 * - Does not overlap lunch (12:00 - 13:00)
 */
export function isTimeSlotValid(startTime, durationMinutes) {
  const startMins = timeToMinutes(startTime);
  const endMins = startMins + durationMinutes;

  const openMins = timeToMinutes(CLINIC_CONFIG.open);
  const closeMins = timeToMinutes(CLINIC_CONFIG.close);
  const lunchStartMins = timeToMinutes(CLINIC_CONFIG.lunchStart);
  const lunchEndMins = timeToMinutes(CLINIC_CONFIG.lunchEnd);

  // Must start on valid boundary (:00, :20, :40)
  const minutePart = startMins % 60;
  if (![0, 20, 40].includes(minutePart)) {
    return { valid: false, reason: 'Appointments must start on the hour or at :20 / :40' };
  }

  // Must be within open and close hours
  if (startMins < openMins || endMins > closeMins) {
    return { valid: false, reason: `Appointment must be between ${CLINIC_CONFIG.open} and ${CLINIC_CONFIG.close}` };
  }

  // Must not overlap lunch (12:00 - 13:00)
  if (startMins < lunchEndMins && endMins > lunchStartMins) {
    return { valid: false, reason: 'Appointment cannot overlap lunch break (12:00 - 13:00)' };
  }

  return { valid: true };
}

/**
 * Check if a provider has an existing booking overlapping with the proposed time
 */
export function hasBookingConflict(existingAppointments, providerId, dateStr, startTime, durationMinutes) {
  const newStart = timeToMinutes(startTime);
  const newEnd = newStart + durationMinutes;

  return existingAppointments.some(appt => {
    if (appt.provider !== providerId || appt.date !== dateStr || appt.status !== 'booked') {
      return false;
    }
    const apptStart = timeToMinutes(appt.start);
    const apptEnd = timeToMinutes(appt.end);
    // Overlap condition: start < otherEnd && end > otherStart
    return newStart < apptEnd && newEnd > apptStart;
  });
}

/**
 * Generate all potential start times for a given duration in minutes
 */
export function getDailySlotCandidates(durationMinutes) {
  const candidates = [];
  const openMins = timeToMinutes(CLINIC_CONFIG.open);
  const closeMins = timeToMinutes(CLINIC_CONFIG.close);
  const lunchStartMins = timeToMinutes(CLINIC_CONFIG.lunchStart);
  const lunchEndMins = timeToMinutes(CLINIC_CONFIG.lunchEnd);

  for (let m = openMins; m + durationMinutes <= closeMins; m += 20) {
    const endM = m + durationMinutes;
    // Skip if overlaps lunch
    if (m < lunchEndMins && endM > lunchStartMins) {
      continue;
    }
    candidates.push(minutesToTime(m));
  }
  return candidates;
}

/**
 * Find available slots for a given provider, date, and visit type
 */
export function findAvailableSlots({
  existingAppointments,
  providerId,
  dateStr,
  visitType = 'follow_up',
  timeOfDay = null // 'morning' (before 12:00) or 'afternoon' (after 13:00)
}) {
  if (isWeekend(dateStr)) {
    return { available: false, slots: [], reason: 'Clinic is closed on weekends' };
  }
  if (isHoliday(dateStr)) {
    return { available: false, slots: [], reason: `Clinic is closed for holiday on ${dateStr}` };
  }
  if (isProviderOnLeave(providerId, dateStr)) {
    return {
      available: false,
      slots: [],
      onLeave: true,
      reason: `Provider ${providerId} is on leave on ${dateStr}`
    };
  }

  const duration = CLINIC_CONFIG.visitDurations[visitType] || 20;
  const candidates = getDailySlotCandidates(duration);
  const freeSlots = [];

  for (const startTime of candidates) {
    const startMins = timeToMinutes(startTime);
    if (timeOfDay === 'morning' && startMins >= timeToMinutes(CLINIC_CONFIG.lunchStart)) {
      continue;
    }
    if (timeOfDay === 'afternoon' && startMins < timeToMinutes(CLINIC_CONFIG.lunchEnd)) {
      continue;
    }

    if (!hasBookingConflict(existingAppointments, providerId, dateStr, startTime, duration)) {
      freeSlots.push({
        provider: providerId,
        date: dateStr,
        start: startTime,
        end: minutesToTime(startMins + duration),
        duration,
        visit_type: visitType
      });
    }
  }

  return {
    available: freeSlots.length > 0,
    slots: freeSlots,
    reason: freeSlots.length > 0 ? 'Slots available' : 'No available slots found for the requested criteria'
  };
}
