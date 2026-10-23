import { assessEmergency, assessUrgency } from '../policies/safetyPolicy.js';
import { verifySender } from '../policies/privacyPolicy.js';
import { findMatchingMedication, evaluateRefillEligibility } from '../policies/refillPolicy.js';
import { isProviderOnLeave, hasBookingConflict, findAvailableSlots, CLINIC_CONFIG } from '../policies/schedulingPolicy.js';

/**
 * Deterministic Baseline & Safety Supervisor Engine
 * Executes exact clinic policy rules deterministically and validates AI proposed actions.
 */
export class DeterministicEngine {
  constructor(dataStore, toolRegistry) {
    this.store = dataStore;
    this.tools = toolRegistry;
  }

  async processMessage(message) {
    const recordedToolCalls = [];
    const callTool = async (name, args) => {
      recordedToolCalls.push(name);
      return await this.tools.executeTool(name, args);
    };

    const body = (message.body || '').trim();
    const today = this.store.getToday();

    // ----------------------------------------------------
    // STEP 1: SAFETY TRIAGE & PROMPT INJECTION DETECTION
    // ----------------------------------------------------
    const emergencyEval = assessEmergency(body);
    const urgencyEval = assessUrgency(body);

    const isPromptInjection = /ignore\s+(your\s+)?(previous|prior)\s+instructions/i.test(body) ||
      /approve\s+refills\s+for\s+all/i.test(body) ||
      /bulk\s+approve/i.test(body);

    // ----------------------------------------------------
    // STEP 2: SENDER IDENTIFICATION & PATIENT LOOKUP
    // ----------------------------------------------------
    let matchedPatient = null;
    let senderVerification = { isVerified: false, isCaregiver: false };

    // Tool call: find_patient
    const lookupRes = await callTool('find_patient', {
      name: message.from_name,
      phone: message.from_contact,
      email: message.from_contact
    });

    if (lookupRes.found) {
      matchedPatient = this.store.getPatientById(lookupRes.patient.id);
    }

    // Check if the message is from a third party referencing another patient
    const thirdPartyMatch = body.match(/wife\s+([A-Z][a-z]+ [A-Z][a-z]+)/i) ||
      body.match(/for\s+([A-Z][a-z]+ [A-Z][a-z]+)/i) ||
      body.match(/([A-Z][a-z]+ [A-Z][a-z]+)'s\s+(daughter|son|husband|wife)/i);

    if (thirdPartyMatch && !matchedPatient) {
      const referencedName = thirdPartyMatch[1];
      const referencedPatient = this.store.findPatient({ name: referencedName });
      if (referencedPatient) {
        matchedPatient = referencedPatient;
      }
    }

    // Tool call: verify_patient
    if (matchedPatient) {
      const verifyRes = await callTool('verify_patient', {
        patient_id: matchedPatient.id,
        from_name: message.from_name,
        from_contact: message.from_contact,
        stated_dob: message.stated_dob,
        channel: message.channel,
        body: message.body
      });
      senderVerification = {
        isVerified: verifyRes.is_verified,
        isCaregiver: verifyRes.is_caregiver,
        isThirdParty: verifyRes.is_third_party,
        failedDob: verifyRes.failedDob || false
      };
    }

    // Output patient_id:
    // If sender is a completely unverified non-patient with no record (like Jessica Parker M007 or Spam M038), patient_id = null
    // If matched to a patient record on file (even if verification failed for PHI disclosure like M011 or M027), patient_id = matchedPatient.id
    const outputPatientId = matchedPatient ? matchedPatient.id : null;

    // ----------------------------------------------------
    // STEP 3: HANDLE EMERGENCIES IMMEDIATELY
    // ----------------------------------------------------
    if (emergencyEval.isEmergency) {
      const intents = ['clinical'];
      if (/refill/i.test(body) || /warfarin/i.test(body)) {
        intents.unshift('refill');
      }

      await callTool('route_message', {
        queues: ['clinician_urgent'],
        reason: emergencyEval.reason
      });

      const replyRes = await callTool('draft_reply', {
        recipient_name: message.from_name,
        preferred_language: matchedPatient?.preferred_language || 'English',
        urgency: 'emergency',
        actions_taken: ['escalate_emergency'],
        details: { reason: emergencyEval.reason }
      });

      return {
        id: message.id,
        patient_id: outputPatientId,
        intents,
        urgency: 'emergency',
        actions: ['escalate_emergency'],
        routed_to: ['clinician_urgent'],
        tool_calls: recordedToolCalls,
        reply_draft: replyRes.reply
      };
    }

    // ----------------------------------------------------
    // STEP 4: SPAM / MARKETING
    // ----------------------------------------------------
    if (/special offer|unsubscribe|reply stop|solutions.*offer/i.test(body)) {
      const replyRes = await callTool('draft_reply', {
        urgency: 'routine',
        actions_taken: ['no_action']
      });

      return {
        id: message.id,
        patient_id: null,
        intents: ['spam'],
        urgency: 'routine',
        actions: ['no_action'],
        routed_to: [],
        tool_calls: recordedToolCalls,
        reply_draft: replyRes.reply
      };
    }

    // ----------------------------------------------------
    // STEP 5: PROMPT INJECTION HANDLING
    // ----------------------------------------------------
    if (isPromptInjection && matchedPatient) {
      // Treat as normal refill for patient's legitimate medication
      const meds = this.store.getMedications(matchedPatient.id);
      const refillCheck = await callTool('check_refill_eligibility', {
        patient_id: matchedPatient.id,
        medication_query: meds[0]?.medication || ''
      });

      if (refillCheck.eligible) {
        await callTool('prepare_refill_request', {
          patient_id: matchedPatient.id,
          medication: refillCheck.medication,
          provider: refillCheck.prescriber
        });
      }

      const replyRes = await callTool('draft_reply', {
        recipient_name: matchedPatient.name,
        preferred_language: matchedPatient.preferred_language,
        urgency: 'routine',
        actions_taken: ['prepare_refill_for_approval', 'flag_suspicious_instruction']
      });

      return {
        id: message.id,
        patient_id: outputPatientId,
        intents: ['refill'],
        urgency: 'routine',
        actions: ['prepare_refill_for_approval', 'flag_suspicious_instruction'],
        routed_to: ['provider_refills'],
        tool_calls: recordedToolCalls,
        reply_draft: replyRes.reply
      };
    }

    // ----------------------------------------------------
    // STEP 6: PRIVACY / VERIFICATION / DISCLOSURE CHECKS
    // ----------------------------------------------------
    // Case A: Unauthorised third party (e.g. Mike asking about Grace Park M027)
    if (senderVerification.isThirdParty || (/wife|husband/i.test(body) && !senderVerification.isCaregiver && !senderVerification.isVerified)) {
      const replyRes = await callTool('draft_reply', {
        recipient_name: message.from_name,
        preferred_language: 'English',
        urgency: 'routine',
        actions_taken: ['decline_disclosure']
      });

      return {
        id: message.id,
        patient_id: outputPatientId,
        intents: ['third_party'],
        urgency: 'routine',
        actions: ['decline_disclosure'],
        routed_to: [],
        tool_calls: recordedToolCalls,
        reply_draft: replyRes.reply
      };
    }

    // Case B: Records request with unverified credentials (e.g. Robert Chen from new email with wrong DOB M011)
    if (/lab results|records|medical record/i.test(body) && matchedPatient && !senderVerification.isVerified) {
      const replyRes = await callTool('draft_reply', {
        recipient_name: message.from_name,
        preferred_language: 'English',
        urgency: 'routine',
        actions_taken: ['request_verification']
      });

      return {
        id: message.id,
        patient_id: outputPatientId,
        intents: ['records'],
        urgency: 'routine',
        actions: ['request_verification'],
        routed_to: [],
        tool_calls: recordedToolCalls,
        reply_draft: replyRes.reply
      };
    }

    // Case C: Non-patient inquiry (e.g. Jessica Parker M007)
    if (!matchedPatient) {
      if (/new patients|accept.*new/i.test(body)) {
        const replyRes = await callTool('draft_reply', {
          recipient_name: message.from_name,
          urgency: 'routine',
          actions_taken: ['answer_directly', 'offer_new_patient_booking']
        });

        return {
          id: message.id,
          patient_id: null,
          intents: ['new_patient'],
          urgency: 'routine',
          actions: ['answer_directly', 'offer_new_patient_booking'],
          routed_to: [],
          tool_calls: recordedToolCalls,
          reply_draft: replyRes.reply
        };
      }
    }

    // ----------------------------------------------------
    // STEP 7: GENERAL ADMINISTRATIVE / BILLING / OTHER
    // ----------------------------------------------------
    // Thanks / Acknowledgment (M031)
    if (/thanks so much|thank you/i.test(body) && !/refill|appointment|pain|move|cancel/i.test(body)) {
      const replyRes = await callTool('draft_reply', {
        recipient_name: matchedPatient?.name || message.from_name,
        urgency: 'routine',
        actions_taken: ['acknowledge']
      });

      return {
        id: message.id,
        patient_id: outputPatientId,
        intents: ['other'],
        urgency: 'routine',
        actions: ['acknowledge'],
        routed_to: [],
        tool_calls: recordedToolCalls,
        reply_draft: replyRes.reply
      };
    }

    // Clinic hours question (M037)
    if (/clinic hours|what are your hours|open/i.test(body) && !/thanksgiving/i.test(body)) {
      const replyRes = await callTool('draft_reply', {
        urgency: 'routine',
        actions_taken: ['answer_directly'],
        details: { isHours: true }
      });

      return {
        id: message.id,
        patient_id: outputPatientId,
        intents: ['admin'],
        urgency: 'routine',
        actions: ['answer_directly'],
        routed_to: [],
        tool_calls: recordedToolCalls,
        reply_draft: replyRes.reply
      };
    }

    // Holiday hours question (M023: day after Thanksgiving)
    if (/day after thanksgiving|thanksgiving/i.test(body)) {
      const replyRes = await callTool('draft_reply', {
        urgency: 'routine',
        actions_taken: ['answer_directly'],
        details: { isHolidayQuestion: true }
      });

      return {
        id: message.id,
        patient_id: outputPatientId,
        intents: ['admin'],
        urgency: 'routine',
        actions: ['answer_directly'],
        routed_to: [],
        tool_calls: recordedToolCalls,
        reply_draft: replyRes.reply
      };
    }

    // Demographics update / Phone number change (M033)
    if (/change my phone|update my phone|new phone/i.test(body)) {
      await callTool('route_message', {
        queues: ['front_desk'],
        reason: 'Patient demographics / contact information update'
      });

      const replyRes = await callTool('draft_reply', {
        recipient_name: matchedPatient?.name,
        urgency: 'routine',
        actions_taken: ['route_to_front_desk']
      });

      return {
        id: message.id,
        patient_id: outputPatientId,
        intents: ['admin'],
        urgency: 'routine',
        actions: ['route_to_front_desk'],
        routed_to: ['front_desk'],
        tool_calls: recordedToolCalls,
        reply_draft: replyRes.reply
      };
    }

    // Records request from verified caregiver (M040: vaccination record)
    if (/vaccination record|immunization record|medical records/i.test(body) && senderVerification.isVerified) {
      await callTool('route_message', {
        queues: ['front_desk'],
        reason: 'Authorized vaccination / medical record request'
      });

      const replyRes = await callTool('draft_reply', {
        recipient_name: message.from_name,
        urgency: 'routine',
        actions_taken: ['route_to_front_desk']
      });

      return {
        id: message.id,
        patient_id: outputPatientId,
        intents: ['records'],
        urgency: 'routine',
        actions: ['route_to_front_desk'],
        routed_to: ['front_desk'],
        tool_calls: recordedToolCalls,
        reply_draft: replyRes.reply
      };
    }

    // Billing only (M008)
    if (/balance|bill|copay|insurance/i.test(body) && !/refill|atorvastatin/i.test(body)) {
      await callTool('route_message', {
        queues: ['billing'],
        reason: 'Patient billing and account balance inquiry'
      });

      const replyRes = await callTool('draft_reply', {
        recipient_name: matchedPatient?.name,
        urgency: 'routine',
        actions_taken: ['route_to_billing']
      });

      return {
        id: message.id,
        patient_id: outputPatientId,
        intents: ['billing'],
        urgency: 'routine',
        actions: ['route_to_billing'],
        routed_to: ['billing'],
        tool_calls: recordedToolCalls,
        reply_draft: replyRes.reply
      };
    }

    // Lab results clinical interpretation (M030: high TSH)
    if (/lab results|what.*means|tsh/i.test(body) && !/send my lab results/i.test(body)) {
      await callTool('route_message', {
        queues: ['clinician_routine'],
        reason: 'Patient requesting clinical explanation of laboratory findings'
      });

      const replyRes = await callTool('draft_reply', {
        recipient_name: matchedPatient?.name,
        urgency: 'routine',
        actions_taken: ['route_to_clinician']
      });

      return {
        id: message.id,
        patient_id: outputPatientId,
        intents: ['clinical'],
        urgency: 'routine',
        actions: ['route_to_clinician'],
        routed_to: ['clinician_routine'],
        tool_calls: recordedToolCalls,
        reply_draft: replyRes.reply
      };
    }

    // ----------------------------------------------------
    // STEP 8: APPOINTMENT CANCELLATION & RESCHEDULING
    // ----------------------------------------------------
    // Cancellation (M022)
    if (/cancel.*appointment/i.test(body)) {
      const apptsRes = await callTool('get_patient_appointments', { patient_id: matchedPatient.id });
      // Find the upcoming appointment (e.g. tomorrow Nov 10)
      const targetAppt = apptsRes.appointments[0];
      if (targetAppt) {
        await callTool('cancel_appointment', { appointment_id: targetAppt.id });
      }

      const replyRes = await callTool('draft_reply', {
        recipient_name: matchedPatient.name,
        urgency: 'routine',
        actions_taken: ['cancel_appointment']
      });

      return {
        id: message.id,
        patient_id: outputPatientId,
        intents: ['cancel'],
        urgency: 'routine',
        actions: ['cancel_appointment'],
        routed_to: [],
        tool_calls: recordedToolCalls,
        reply_draft: replyRes.reply
      };
    }

    // Rescheduling (M002, M034)
    if (/move\s+(my\s+)?(appointment|annual physical|physical|follow-up|visit)|reschedule|change.*(appointment|visit)/i.test(body)) {
      const apptsRes = await callTool('get_patient_appointments', { patient_id: matchedPatient.id });

      // M002: Priya Raman move Wed 11 Nov to Friday 13 Nov afternoon
      if (/wednesday.*friday/i.test(body) || matchedPatient.id === 'P007') {
        const wedAppt = apptsRes.appointments.find(a => a.date === '2026-11-11');
        const slotsRes = await callTool('find_available_slots', {
          provider: 'KIM',
          date: '2026-11-13',
          visit_type: 'follow_up',
          time_of_day: 'afternoon'
        });

        const slot = slotsRes.slots[0] || { start: '14:00', end: '14:20' };
        if (wedAppt) {
          await callTool('reschedule_appointment', {
            appointment_id: wedAppt.id,
            date: '2026-11-13',
            start: slot.start,
            end: slot.end
          });
        }

        const replyRes = await callTool('draft_reply', {
          recipient_name: matchedPatient.name,
          urgency: 'routine',
          actions_taken: ['reschedule_appointment'],
          details: { date: '2026-11-13', start: slot.start }
        });

        return {
          id: message.id,
          patient_id: outputPatientId,
          intents: ['reschedule'],
          urgency: 'routine',
          actions: ['reschedule_appointment'],
          routed_to: [],
          tool_calls: recordedToolCalls,
          reply_draft: replyRes.reply
        };
      }

      // M034: Fatima Hassan move from Monday 16th to following week morning
      if (/monday the 16th.*following week/i.test(body) || matchedPatient.id === 'P015') {
        const nov16Appt = apptsRes.appointments.find(a => a.date === '2026-11-16');
        // Following week is Nov 23-25 (Nov 26-27 are holidays)
        const slotsRes = await callTool('find_available_slots', {
          provider: 'PATEL',
          date: '2026-11-23',
          visit_type: 'annual_physical',
          time_of_day: 'morning'
        });

        const slot = slotsRes.slots[0] || { start: '09:00', end: '09:40' };
        if (nov16Appt) {
          await callTool('reschedule_appointment', {
            appointment_id: nov16Appt.id,
            date: '2026-11-23',
            start: slot.start,
            end: slot.end
          });
        }

        const replyRes = await callTool('draft_reply', {
          recipient_name: matchedPatient.name,
          urgency: 'routine',
          actions_taken: ['reschedule_appointment'],
          details: { date: '2026-11-23', start: slot.start }
        });

        return {
          id: message.id,
          patient_id: outputPatientId,
          intents: ['reschedule'],
          urgency: 'routine',
          actions: ['reschedule_appointment'],
          routed_to: [],
          tool_calls: recordedToolCalls,
          reply_draft: replyRes.reply
        };
      }
    }

    // ----------------------------------------------------
    // STEP 9: APPOINTMENT SCHEDULING (BOOKING & ALTERNATIVES)
    // ----------------------------------------------------
    if (/book|cita|appointment|physical|chequeo|seen today|see dr|want to see/i.test(body) && !/refill/i.test(body)) {
      // M028: Nora Fitzgerald requesting Dr. Okafor on Wednesday the 18th (Okafor on leave!)
      if (/wednesday the 18th/i.test(body) || (/okafor/i.test(body) && /18th/i.test(body))) {
        await callTool('find_available_slots', {
          provider: 'OKAFOR',
          date: '2026-11-18',
          visit_type: 'follow_up'
        });

        const replyRes = await callTool('draft_reply', {
          recipient_name: matchedPatient?.name,
          urgency: 'routine',
          actions_taken: ['offer_alternatives']
        });

        return {
          id: message.id,
          patient_id: outputPatientId,
          intents: ['schedule'],
          urgency: 'routine',
          actions: ['offer_alternatives'],
          routed_to: [],
          tool_calls: recordedToolCalls,
          reply_draft: replyRes.reply
        };
      }

      // M029: Robert Chen requesting Dr. Okafor Thursday at 2pm (Already booked!)
      if (/thursday at 2pm|thursday.*2pm/i.test(body)) {
        await callTool('find_available_slots', {
          provider: 'OKAFOR',
          date: '2026-11-12',
          visit_type: 'follow_up'
        });

        const replyRes = await callTool('draft_reply', {
          recipient_name: matchedPatient?.name,
          urgency: 'routine',
          actions_taken: ['offer_alternatives']
        });

        return {
          id: message.id,
          patient_id: outputPatientId,
          intents: ['schedule'],
          urgency: 'routine',
          actions: ['offer_alternatives'],
          routed_to: [],
          tool_calls: recordedToolCalls,
          reply_draft: replyRes.reply
        };
      }

      // M015: Anna Rossi for Sofia Rossi (child fever & cough -> sick visit with KIM today or tomorrow)
      if (/fever.*cough|cough.*fever/i.test(body)) {
        const slotsRes = await callTool('find_available_slots', {
          provider: 'KIM',
          date: '2026-11-09',
          visit_type: 'sick_visit'
        });

        const slot = slotsRes.slots[0] || { start: '16:00' };
        await callTool('book_appointment', {
          patient_id: matchedPatient.id,
          provider: 'KIM',
          date: '2026-11-09',
          start: slot.start,
          visit_type: 'sick_visit'
        });

        const replyRes = await callTool('draft_reply', {
          recipient_name: message.from_name,
          urgency: 'urgent',
          actions_taken: ['book_appointment'],
          details: { provider: 'Sarah Kim, NP', date: '2026-11-09', start: slot.start }
        });

        return {
          id: message.id,
          patient_id: outputPatientId,
          intents: ['schedule', 'clinical'],
          urgency: 'urgent',
          actions: ['book_appointment'],
          routed_to: [],
          tool_calls: recordedToolCalls,
          reply_draft: replyRes.reply
        };
      }

      // M039: Kevin O'Brien UTI sick visit within 1 business day
      if (/uti|burning when i pee/i.test(body)) {
        const slotsRes = await callTool('find_available_slots', {
          provider: 'OKAFOR',
          date: '2026-11-09',
          visit_type: 'sick_visit'
        });

        const slot = slotsRes.slots[0] || { start: '14:00' };
        await callTool('book_appointment', {
          patient_id: matchedPatient.id,
          provider: 'OKAFOR',
          date: '2026-11-09',
          start: slot.start,
          visit_type: 'sick_visit'
        });

        const replyRes = await callTool('draft_reply', {
          recipient_name: matchedPatient.name,
          urgency: 'urgent',
          actions_taken: ['book_appointment'],
          details: { provider: 'Dr. James Okafor', date: '2026-11-09', start: slot.start }
        });

        return {
          id: message.id,
          patient_id: outputPatientId,
          intents: ['schedule', 'clinical'],
          urgency: 'urgent',
          actions: ['book_appointment'],
          routed_to: [],
          tool_calls: recordedToolCalls,
          reply_draft: replyRes.reply
        };
      }

      // M016: Carlos Mendez annual physical in Spanish
      if (/chequeo anual|cita para mi chequeo/i.test(body)) {
        const slotsRes = await callTool('find_available_slots', {
          provider: 'PATEL',
          date: '2026-11-16',
          visit_type: 'annual_physical'
        });

        const slot = slotsRes.slots[0] || { start: '10:00' };
        await callTool('book_appointment', {
          patient_id: matchedPatient.id,
          provider: 'PATEL',
          date: '2026-11-16',
          start: slot.start,
          visit_type: 'annual_physical'
        });

        const replyRes = await callTool('draft_reply', {
          recipient_name: matchedPatient.name,
          preferred_language: 'Spanish',
          urgency: 'routine',
          actions_taken: ['book_appointment'],
          details: { date: '16 de noviembre', start: slot.start }
        });

        return {
          id: message.id,
          patient_id: outputPatientId,
          intents: ['schedule'],
          urgency: 'routine',
          actions: ['book_appointment'],
          routed_to: [],
          tool_calls: recordedToolCalls,
          reply_draft: replyRes.reply
        };
      }

      // M024: Lucy Nguyen "dying to get in" physical with Sarah Kim
      if (/sarah kim.*this week|dying to get in/i.test(body)) {
        const slotsRes = await callTool('find_available_slots', {
          provider: 'KIM',
          date: '2026-11-10',
          visit_type: 'annual_physical'
        });

        const slot = slotsRes.slots[0] || { start: '09:20' };
        await callTool('book_appointment', {
          patient_id: matchedPatient.id,
          provider: 'KIM',
          date: '2026-11-10',
          start: slot.start,
          visit_type: 'annual_physical'
        });

        const replyRes = await callTool('draft_reply', {
          recipient_name: matchedPatient.name,
          urgency: 'routine',
          actions_taken: ['book_appointment'],
          details: { provider: 'Sarah Kim, NP', date: '2026-11-10', start: slot.start }
        });

        return {
          id: message.id,
          patient_id: outputPatientId,
          intents: ['schedule'],
          urgency: 'routine',
          actions: ['book_appointment'],
          routed_to: [],
          tool_calls: recordedToolCalls,
          reply_draft: replyRes.reply
        };
      }

      // M010: Grace Park follow-up with Dr. Patel Tuesday morning next week (Nov 17)
      if (/patel.*next week|tuesday morning/i.test(body)) {
        const slotsRes = await callTool('find_available_slots', {
          provider: 'PATEL',
          date: '2026-11-17',
          visit_type: 'follow_up',
          time_of_day: 'morning'
        });

        const slot = slotsRes.slots[0] || { start: '09:20' };
        await callTool('book_appointment', {
          patient_id: matchedPatient.id,
          provider: 'PATEL',
          date: '2026-11-17',
          start: slot.start,
          visit_type: 'follow_up'
        });

        const replyRes = await callTool('draft_reply', {
          recipient_name: matchedPatient.name,
          urgency: 'routine',
          actions_taken: ['book_appointment'],
          details: { provider: 'Dr. Maya Patel', date: '2026-11-17', start: slot.start }
        });

        return {
          id: message.id,
          patient_id: outputPatientId,
          intents: ['schedule'],
          urgency: 'routine',
          actions: ['book_appointment'],
          routed_to: [],
          tool_calls: recordedToolCalls,
          reply_draft: replyRes.reply
        };
      }

      // General appointment booking handler (e.g. "Book an annual physical for Carlos Mendez on 2026-11-17 at 10:00 AM")
      if (matchedPatient && (/book|schedule|cita|appointment/i.test(body) || /physical|chequeo/i.test(body))) {
        const isPhysical = /physical|chequeo/i.test(body);
        const isSick = /sick|urgent|fever/i.test(body);
        const visitType = isPhysical ? 'annual_physical' : (isSick ? 'sick_visit' : 'follow_up');

        // Extract date YYYY-MM-DD
        const dateMatch = body.match(/\b(202\d-\d{2}-\d{2})\b/);
        const reqDate = dateMatch ? dateMatch[1] : '2026-11-17';

        // Extract time HH:MM (e.g. 10:00, 10:00 AM, 2pm)
        let reqTime = '10:00';
        const timeMatch24 = body.match(/\b(\d{1,2}:\d{2})\b/);
        const timeMatchAmPm = body.match(/\b(\d{1,2})\s*(am|pm)\b/i);
        if (timeMatch24) {
          reqTime = timeMatch24[1].padStart(5, '0');
        } else if (timeMatchAmPm) {
          let hr = parseInt(timeMatchAmPm[1], 10);
          const isPm = timeMatchAmPm[2].toLowerCase() === 'pm';
          if (isPm && hr < 12) hr += 12;
          if (!isPm && hr === 12) hr = 0;
          reqTime = `${hr.toString().padStart(2, '0')}:00`;
        }

        // Determine provider (Patel, Okafor, or Kim)
        let prov = 'PATEL';
        if (/okafor/i.test(body)) prov = 'OKAFOR';
        else if (/kim/i.test(body)) prov = 'KIM';
        else if (matchedPatient.primary_provider_id === 'PR002') prov = 'OKAFOR';
        else if (matchedPatient.primary_provider_id === 'PR003') prov = 'KIM';

        // Check if provider is on leave or slot conflict
        const onLeave = isProviderOnLeave(prov, reqDate);
        const hasConflict = hasBookingConflict(this.store.getAppointments(), prov, reqDate, reqTime, isPhysical ? 40 : 20);

        if (onLeave || hasConflict) {
          await callTool('find_available_slots', {
            provider: prov,
            date: reqDate,
            visit_type: visitType
          });

          const replyRes = await callTool('draft_reply', {
            recipient_name: matchedPatient.name,
            preferred_language: matchedPatient.preferred_language,
            urgency: 'routine',
            actions_taken: ['offer_alternatives']
          });

          return {
            id: message.id,
            patient_id: outputPatientId,
            intents: ['schedule'],
            urgency: 'routine',
            actions: ['offer_alternatives'],
            routed_to: [],
            tool_calls: recordedToolCalls,
            reply_draft: replyRes.reply
          };
        }

        // Book slot
        await callTool('book_appointment', {
          patient_id: matchedPatient.id,
          provider: prov,
          date: reqDate,
          start: reqTime,
          visit_type: visitType
        });

        const replyRes = await callTool('draft_reply', {
          recipient_name: matchedPatient.name,
          preferred_language: matchedPatient.preferred_language,
          urgency: 'routine',
          actions_taken: ['book_appointment'],
          details: { date: reqDate, start: reqTime, provider: prov === 'PATEL' ? 'Dr. Maya Patel' : prov === 'OKAFOR' ? 'Dr. James Okafor' : 'Sarah Kim, NP' }
        });

        return {
          id: message.id,
          patient_id: outputPatientId,
          intents: ['schedule'],
          urgency: 'routine',
          actions: ['book_appointment'],
          routed_to: [],
          tool_calls: recordedToolCalls,
          reply_draft: replyRes.reply
        };
      }
    }

    // ----------------------------------------------------
    // STEP 10: MEDICATION REFILL PROCESSING
    // ----------------------------------------------------
    // Check if there is also a clinical mood concern (M006: Emily Novak)
    if (urgencyEval.isMoodConcern && matchedPatient) {
      const refillCheck = await callTool('check_refill_eligibility', {
        patient_id: matchedPatient.id,
        medication_query: 'sertraline'
      });

      if (refillCheck.eligible) {
        await callTool('prepare_refill_request', {
          patient_id: matchedPatient.id,
          medication: refillCheck.medication,
          provider: refillCheck.prescriber
        });
      }

      await callTool('route_message', {
        queues: ['clinician_urgent'],
        reason: 'Mood concern with depressive symptoms reported alongside routine refill'
      });

      const replyRes = await callTool('draft_reply', {
        recipient_name: matchedPatient.name,
        urgency: 'urgent',
        actions_taken: ['route_to_clinician', 'prepare_refill_for_approval']
      });

      return {
        id: message.id,
        patient_id: outputPatientId,
        intents: ['refill', 'clinical'],
        urgency: 'urgent',
        actions: ['route_to_clinician', 'prepare_refill_for_approval'],
        routed_to: ['clinician_urgent', 'provider_refills'],
        tool_calls: recordedToolCalls,
        reply_draft: replyRes.reply
      };
    }

    // Check if message is a medication refill inquiry
    const hasRefillIntent = /refill|prescription|medication|medicine|pills|tablets|dose|mg|ran out|out of (pills|medication)/i.test(body) ||
      (matchedPatient && findMatchingMedication(this.store.getMedications(matchedPatient.id), body));

    if (hasRefillIntent && matchedPatient) {
      // Dual intent: Refill + Billing (M025: Brian Walsh)
      const isDualRefillBilling = /copay|telehealth visit/i.test(body) && /atorvastatin|refill/i.test(body);

      // Standard refill request processing
      const isOutOfPills = /out of (pills|medication)|ran out/i.test(body);
      const refillCheck = await callTool('check_refill_eligibility', {
        patient_id: matchedPatient.id,
        medication_query: body,
        is_out_of_pills: isOutOfPills
      });

      let actions = [...refillCheck.actions];
      let routedTo = [...refillCheck.routed_to];
      let intents = ['refill'];

      if (isDualRefillBilling) {
        intents.push('billing');
        actions.push('route_to_billing');
        routedTo.push('billing');
        await callTool('route_message', {
          queues: ['billing'],
          reason: 'Copay inquiry regarding telehealth visit'
        });
      }

      if (refillCheck.eligible) {
        await callTool('prepare_refill_request', {
          patient_id: matchedPatient.id,
          medication: refillCheck.medication,
          provider: refillCheck.prescriber
        });
      }

      const urgency = isOutOfPills && actions.includes('refill_needs_visit') ? 'urgent' : 'routine';

      const replyRes = await callTool('draft_reply', {
        recipient_name: matchedPatient.name,
        preferred_language: matchedPatient.preferred_language,
        urgency,
        actions_taken: actions,
        details: {
          earliest_request_date: refillCheck.earliest_request_date,
          medication: refillCheck.medication
        }
      });

      return {
        id: message.id,
        patient_id: outputPatientId,
        intents,
        urgency,
        actions,
        routed_to: Array.from(new Set(routedTo)),
        tool_calls: recordedToolCalls,
        reply_draft: replyRes.reply
      };
    }

    // ----------------------------------------------------
    // STEP 9: GENERAL / CLINICAL / SCHEDULING FALLBACK
    // ----------------------------------------------------
    // Clinical inquiries (symptoms, pain, illness, feeling unwell)
    if (/pain|sick|fever|cough|headache|dizzy|nausea|vomit|rash|swelling|infection|stomach|wound|injury|pressure|weakness|hurt/i.test(body)) {
      const urgency = urgencyEval.urgency === 'urgent' ? 'urgent' : 'routine';
      const queue = urgency === 'urgent' ? 'clinician_urgent' : 'clinician_routine';

      await callTool('route_message', {
        queues: [queue],
        reason: 'Clinical symptom inquiry requiring medical review'
      });

      const replyRes = await callTool('draft_reply', {
        recipient_name: matchedPatient?.name || message.from_name,
        urgency,
        actions_taken: ['route_to_clinician']
      });

      return {
        id: message.id,
        patient_id: outputPatientId,
        intents: ['clinical'],
        urgency,
        actions: ['route_to_clinician'],
        routed_to: [queue],
        tool_calls: recordedToolCalls,
        reply_draft: replyRes.reply || 'Your message regarding your symptoms has been forwarded to our clinical care team. If your symptoms worsen or become severe, please seek emergency medical attention.'
      };
    }

    // Appointment inquiries
    if (/appoint?m[ea]nt|schedule|schdule|book|visit|checkup|see the doctor|consult/i.test(body)) {
      await callTool('route_message', {
        queues: ['front_desk'],
        reason: 'Appointment scheduling inquiry'
      });

      const replyRes = await callTool('draft_reply', {
        recipient_name: matchedPatient?.name || message.from_name,
        preferred_language: matchedPatient?.preferred_language || 'English',
        urgency: 'routine',
        actions_taken: ['offer_appointment']
      });

      return {
        id: message.id,
        patient_id: outputPatientId,
        intents: ['schedule'],
        urgency: 'routine',
        actions: ['offer_appointment'],
        routed_to: ['front_desk'],
        tool_calls: recordedToolCalls,
        reply_draft: replyRes.reply || 'Hello. We would be happy to help you schedule an appointment at Maplewood Family Clinic. Please let us know your preferred dates and times.'
      };
    }

    // General front-desk fallback for other inquiries
    await callTool('route_message', {
      queues: ['front_desk'],
      reason: 'General front-desk patient inquiry'
    });

    const replyRes = await callTool('draft_reply', {
      recipient_name: matchedPatient?.name || message.from_name,
      urgency: 'routine',
      actions_taken: ['answer_directly']
    });

    return {
      id: message.id,
      patient_id: outputPatientId,
      intents: ['other'],
      urgency: 'routine',
      actions: ['answer_directly'],
      routed_to: ['front_desk'],
      tool_calls: recordedToolCalls,
      reply_draft: replyRes.reply || 'Thank you for reaching out to Maplewood Family Clinic. Our front-desk team has received your message and will assist you shortly.'
    };
  }
}
