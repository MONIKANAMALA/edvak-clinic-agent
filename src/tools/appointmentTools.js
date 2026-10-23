import {
  findAvailableSlots,
  isProviderOnLeave,
  isHoliday,
  isWeekend,
  isTimeSlotValid,
  hasBookingConflict,
  CLINIC_CONFIG
} from '../policies/schedulingPolicy.js';

export function createAppointmentTools(dataStore) {
  return {
    get_patient_appointments: {
      name: 'get_patient_appointments',
      description: 'Retrieves all booked appointments for a verified patient.',
      parameters: {
        type: 'object',
        properties: {
          patient_id: { type: 'string', description: 'Patient ID' }
        },
        required: ['patient_id']
      },
      handler: async (args) => {
        const appts = dataStore.getAppointments({ patient_id: args.patient_id, status: 'booked' });
        return {
          count: appts.length,
          appointments: appts
        };
      }
    },

    find_available_slots: {
      name: 'find_available_slots',
      description: 'Searches for open appointment slots adhering to clinic hours, provider leave, lunch break, and visit durations.',
      parameters: {
        type: 'object',
        properties: {
          provider: { type: 'string', description: 'Provider ID (PATEL, OKAFOR, KIM)' },
          date: { type: 'string', description: 'Date (YYYY-MM-DD)' },
          visit_type: {
            type: 'string',
            description: 'Visit type (new_patient, annual_physical, follow_up, sick_visit, telehealth)'
          },
          time_of_day: { type: 'string', description: 'morning or afternoon' }
        },
        required: ['provider', 'date']
      },
      handler: async (args) => {
        const existing = dataStore.getAppointments();
        const result = findAvailableSlots({
          existingAppointments: existing,
          providerId: args.provider,
          dateStr: args.date,
          visitType: args.visit_type || 'follow_up',
          timeOfDay: args.time_of_day || null
        });
        return result;
      }
    },

    book_appointment: {
      name: 'book_appointment',
      description: 'Books an appointment for a verified patient, preventing conflicts, holiday bookings, or bookings during provider leave.',
      parameters: {
        type: 'object',
        properties: {
          patient_id: { type: 'string', description: 'Patient ID' },
          provider: { type: 'string', description: 'Provider ID (PATEL, OKAFOR, KIM)' },
          date: { type: 'string', description: 'Date (YYYY-MM-DD)' },
          start: { type: 'string', description: 'Start time (HH:MM)' },
          visit_type: {
            type: 'string',
            description: 'Visit type (new_patient, annual_physical, follow_up, sick_visit, telehealth)'
          }
        },
        required: ['patient_id', 'provider', 'date', 'start']
      },
      handler: async (args) => {
        const visitType = args.visit_type || 'follow_up';
        const duration = CLINIC_CONFIG.visitDurations[visitType] || 20;

        // Check weekend
        if (isWeekend(args.date)) {
          return {
            success: false,
            error: 'Clinic is closed on weekends',
            action: 'offer_alternatives'
          };
        }

        // Check holiday
        if (isHoliday(args.date)) {
          return {
            success: false,
            error: `Clinic is closed for holiday on ${args.date}`,
            action: 'offer_alternatives'
          };
        }

        // Check provider leave
        if (isProviderOnLeave(args.provider, args.date)) {
          return {
            success: false,
            on_leave: true,
            error: `Provider ${args.provider} is on leave on ${args.date}`,
            action: 'offer_alternatives'
          };
        }

        // Check slot validity
        const slotCheck = isTimeSlotValid(args.start, duration);
        if (!slotCheck.valid) {
          return {
            success: false,
            error: slotCheck.reason,
            action: 'offer_alternatives'
          };
        }

        // Check conflict with existing appointments
        const existing = dataStore.getAppointments();
        if (hasBookingConflict(existing, args.provider, args.date, args.start, duration)) {
          return {
            success: false,
            conflict: true,
            error: `Time slot ${args.start} with provider ${args.provider} on ${args.date} is already booked`,
            action: 'offer_alternatives'
          };
        }

        // Compute end time
        const [h, m] = args.start.split(':').map(Number);
        const endTotal = h * 60 + m + duration;
        const endH = Math.floor(endTotal / 60);
        const endM = endTotal % 60;
        const endTime = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;

        const newAppt = dataStore.bookAppointment({
          patient_id: args.patient_id,
          provider: args.provider,
          date: args.date,
          start: args.start,
          end: endTime,
          visit_type: visitType
        });

        return {
          success: true,
          appointment: newAppt,
          message: `Appointment successfully booked for ${args.date} at ${args.start}-${endTime} with ${args.provider}.`
        };
      }
    },

    reschedule_appointment: {
      name: 'reschedule_appointment',
      description: 'Reschedules an existing appointment to a new date and time.',
      parameters: {
        type: 'object',
        properties: {
          appointment_id: { type: 'string', description: 'Existing appointment ID' },
          date: { type: 'string', description: 'New date (YYYY-MM-DD)' },
          start: { type: 'string', description: 'New start time (HH:MM)' },
          end: { type: 'string', description: 'New end time (HH:MM)' }
        },
        required: ['appointment_id', 'date', 'start']
      },
      handler: async (args) => {
        const appt = dataStore.getAppointmentById(args.appointment_id);
        if (!appt) {
          return { success: false, error: `Appointment ${args.appointment_id} not found` };
        }

        const duration = CLINIC_CONFIG.visitDurations[appt.visit_type] || 20;

        // Check provider leave
        if (isProviderOnLeave(appt.provider, args.date)) {
          return {
            success: false,
            on_leave: true,
            error: `Provider ${appt.provider} is on leave on ${args.date}`,
            action: 'offer_alternatives'
          };
        }

        // Check conflict with other appointments (excluding this appointment itself)
        const otherAppointments = dataStore.getAppointments().filter(a => a.id !== args.appointment_id);
        if (hasBookingConflict(otherAppointments, appt.provider, args.date, args.start, duration)) {
          return {
            success: false,
            conflict: true,
            error: `Slot ${args.start} on ${args.date} is already occupied`,
            action: 'offer_alternatives'
          };
        }

        // Calculate end time if not given
        let endTime = args.end;
        if (!endTime) {
          const [h, m] = args.start.split(':').map(Number);
          const endTotal = h * 60 + m + duration;
          endTime = `${String(Math.floor(endTotal / 60)).padStart(2, '0')}:${String(endTotal % 60).padStart(2, '0')}`;
        }

        const updated = dataStore.rescheduleAppointment(args.appointment_id, {
          date: args.date,
          start: args.start,
          end: endTime
        });

        return {
          success: true,
          appointment: updated,
          message: `Appointment ${args.appointment_id} successfully rescheduled to ${args.date} from ${args.start} to ${endTime}.`
        };
      }
    },

    cancel_appointment: {
      name: 'cancel_appointment',
      description: 'Cancels an existing appointment for a verified patient.',
      parameters: {
        type: 'object',
        properties: {
          appointment_id: { type: 'string', description: 'Appointment ID to cancel' }
        },
        required: ['appointment_id']
      },
      handler: async (args) => {
        const appt = dataStore.getAppointmentById(args.appointment_id);
        if (!appt) {
          return { success: false, error: `Appointment ${args.appointment_id} not found` };
        }
        const cancelled = dataStore.cancelAppointment(args.appointment_id);
        return {
          success: true,
          appointment: cancelled,
          message: `Appointment ${args.appointment_id} has been cancelled.`
        };
      }
    }
  };
}
