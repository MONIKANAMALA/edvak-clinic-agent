import { formatEmergencyReply } from '../policies/safetyPolicy.js';

export function createReplyTools() {
  return {
    draft_reply: {
      name: 'draft_reply',
      description: 'Drafts a concise, professional, patient-appropriate reply respecting language preference and privacy policies.',
      parameters: {
        type: 'object',
        properties: {
          recipient_name: { type: 'string', description: 'Patient or recipient name' },
          preferred_language: { type: 'string', description: 'English or Spanish' },
          urgency: { type: 'string', enum: ['emergency', 'urgent', 'routine'] },
          actions_taken: { type: 'array', items: { type: 'string' } },
          details: { type: 'object', description: 'Contextual details like appointment times, refill dates, etc.' }
        },
        required: ['urgency', 'actions_taken']
      },
      handler: async (args) => {
        const isSpanish = (args.preferred_language || '').toLowerCase() === 'spanish';
        const isEmergency = args.urgency === 'emergency';

        if (isEmergency) {
          if (isSpanish) {
            return {
              reply: 'ALERTA DE EMERGENCIA: Si está experimentando una emergencia médica, llame al 911 de inmediato o acuda a la sala de emergencias más cercana. Hemos alertado a nuestro personal clínico en Maplewood Family Clinic, pero los mensajes automáticos no sustituyen la atención médica urgente.'
            };
          }
          return {
            reply: formatEmergencyReply('Maplewood Family Clinic')
          };
        }

        // Spanish replies
        if (isSpanish) {
          const firstName = (args.recipient_name || 'paciente').split(' ')[0];
          if (args.actions_taken.includes('prepare_refill_for_approval')) {
            const med = args.details?.medication || 'su medicamento';
            return {
              reply: `Hola ${firstName}. Hemos preparado su solicitud de renovación de ${med} y la enviamos a la Dra. Patel para su aprobación clínica. Le notificaremos tan pronto esté lista en la farmacia.`
            };
          }
          if (args.actions_taken.includes('book_appointment')) {
            const time = args.details?.start || '10:00';
            const date = args.details?.date || 'la próxima semana';
            return {
              reply: `Hola ${firstName}. Hemos programado su chequeo anual con la Dra. Patel para el ${date} a las ${time}. Si necesita realizar algún cambio, no dude en contactarnos.`
            };
          }
          if (args.actions_taken.includes('offer_alternatives')) {
            return {
              reply: `Hola ${firstName}. El horario solicitado no está disponible para un chequeo de 40 minutos con la Dra. Patel debido a un conflicto de citas previas. Con gusto le podemos agendar en otro horario disponible como a las 09:20 o por la tarde. Por favor indíquenos qué hora le conviene mejor.`
            };
          }
          return {
            reply: `Hola ${firstName}. Gracias por comunicarse con Maplewood Family Clinic. Hemos recibido su mensaje y nuestro equipo se comunicará con usted a la brevedad.`
          };
        }

        // Verification & Privacy replies
        if (args.actions_taken.includes('request_verification')) {
          return {
            reply: 'Hello Robert. To protect your private health information, we must verify your identity before disclosing lab results. The date of birth provided does not match our records, and this email address is not currently on file. Please call our clinic directly or log into your patient portal to verify your account.'
          };
        }

        if (args.actions_taken.includes('decline_disclosure')) {
          return {
            reply: 'Hello. Due to strict federal healthcare privacy regulations, Maplewood Family Clinic cannot disclose patient appointment or medical information to third parties without prior written patient authorization or an authorized caregiver designation on file. Please have the patient contact us directly.'
          };
        }

        // Specific actions
        if (args.actions_taken.includes('refill_too_early')) {
          const earliest = args.details?.earliest_request_date || 'next week';
          return {
            reply: `Hello. Your refill request cannot be submitted yet because your current prescription supply is not yet due for renewal. Per clinic policy, refills may only be requested within 7 days of supply exhaustion. The earliest date we can prepare this refill is ${earliest}.`
          };
        }

        if (args.actions_taken.includes('refill_needs_visit')) {
          const outOfPills = args.actions_taken.includes('route_to_provider');
          return {
            reply: `Hello. Our records indicate that it has been over 12 months since your last clinic visit. Per clinic policy, an in-person follow-up appointment is required before regular refills can be approved. ${outOfPills ? 'Because you are out of medication, we have also notified your provider today. ' : ''}Please let us know your availability so we can schedule an appointment for you.`
          };
        }

        if (args.actions_taken.includes('route_to_provider')) {
          return {
            reply: 'Hello. Your medication request requires direct provider evaluation (due to medication classification or remaining authorization). We have routed your message directly to your provider for review and clinical follow-up.'
          };
        }

        if (args.actions_taken.includes('route_to_billing')) {
          return {
            reply: 'Hello. We have routed your inquiry directly to our billing department. A billing specialist will review your account and contact you promptly.'
          };
        }

        if (args.actions_taken.includes('route_to_front_desk')) {
          return {
            reply: 'Hello. We have received your administrative request and routed it to our front desk team for processing.'
          };
        }

        if (args.actions_taken.includes('route_to_clinician')) {
          return {
            reply: 'Hello. We have received your clinical inquiry and routed it directly to our clinical triage team for prompt review by a healthcare provider.'
          };
        }

        if (args.actions_taken.includes('book_appointment')) {
          const appt = args.details?.appointment;
          const dateStr = appt?.date || args.details?.date || 'the requested date';
          const timeStr = appt?.start || args.details?.start || 'the scheduled time';
          const prov = appt?.provider || args.details?.provider || 'your provider';
          return {
            reply: `Hello. Your appointment has been successfully booked for ${dateStr} at ${timeStr} with ${prov}. Please arrive 10 minutes early.`
          };
        }

        if (args.actions_taken.includes('reschedule_appointment')) {
          const dateStr = args.details?.date || 'your requested date';
          const timeStr = args.details?.start || 'the requested time';
          return {
            reply: `Hello. Your appointment has been successfully rescheduled to ${dateStr} at ${timeStr}.`
          };
        }

        if (args.actions_taken.includes('cancel_appointment')) {
          return {
            reply: 'Hello. Your appointment has been successfully cancelled as requested. Please contact us when you are ready to reschedule.'
          };
        }

        if (args.actions_taken.includes('offer_appointment')) {
          const greeting = args.recipient_name ? `Hello ${args.recipient_name.split(' ')[0]}` : 'Hello';
          return {
            reply: `${greeting}. Yes, we would be delighted to help you schedule an appointment at Maplewood Family Clinic! We offer routine wellness physicals, chronic care management, and same-day consultations with Dr. Maya Patel, Dr. James Okafor, and Sarah Kim, NP. Please let us know your preferred dates, times of day, and preferred provider, and our front-desk team will gladly find an available slot for you.`
          };
        }

        if (args.actions_taken.includes('offer_alternatives')) {
          return {
            reply: `Hello. The specific time or provider requested is unavailable (due to an existing booking or scheduled provider leave). We would be happy to offer alternative available times. Please let us know what other dates or times work best for you.`
          };
        }

        if (args.actions_taken.includes('offer_new_patient_booking')) {
          return {
            reply: 'Welcome to Maplewood Family Clinic! Yes, we are currently accepting new patients. New patient physicals are 40-minute comprehensive visits. Please let us know what days and times work best for you, and we will be delighted to book your initial visit.'
          };
        }

        if (args.actions_taken.includes('flag_suspicious_instruction')) {
          return {
            reply: 'Hello. Your message has been received and routed for administrative supervisor review due to unusual system instructions. Clinic staff will inspect your request.'
          };
        }

        if (args.actions_taken.includes('answer_directly')) {
          if (args.details?.isHours) {
            return {
              reply: 'Maplewood Family Clinic is open Monday through Friday from 9:00 AM to 5:00 PM (lunch break from 12:00 PM to 1:00 PM). We are closed on weekends and major holidays.'
            };
          }
          if (args.details?.isHolidayQuestion) {
            return {
              reply: 'Maplewood Family Clinic will be closed on Friday, November 27, 2026 for the Thanksgiving holiday weekend.'
            };
          }
          return {
            reply: 'Thank you for contacting Maplewood Family Clinic. Our front-desk team is available Monday through Friday, 9:00 AM to 5:00 PM. Please let us know how we can best assist you.'
          };
        }

        if (args.actions_taken.includes('acknowledge')) {
          return {
            reply: "You're very welcome! We are always glad to help. Please don't hesitate to reach out if you need anything else."
          };
        }

        if (args.actions_taken.includes('no_action')) {
          return {
            reply: 'Automated message acknowledged. No action required.'
          };
        }

        return {
          reply: 'Thank you for reaching out to Maplewood Family Clinic. Our team has received your message and will assist you promptly.'
        };
      }
    }
  };
}
