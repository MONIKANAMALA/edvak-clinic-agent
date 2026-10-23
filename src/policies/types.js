/**
 * Allowed action vocabulary, urgency levels, routing queues, and intents
 * as specified in the assignment.
 */

export const ALLOWED_ACTIONS = [
  'escalate_emergency',
  'route_to_clinician',
  'route_to_provider',
  'route_to_billing',
  'route_to_front_desk',
  'prepare_refill_for_approval',
  'refill_needs_visit',
  'refill_too_early',
  'book_appointment',
  'reschedule_appointment',
  'cancel_appointment',
  'offer_appointment',
  'offer_alternatives',
  'offer_new_patient_booking',
  'request_verification',
  'decline_disclosure',
  'flag_suspicious_instruction',
  'answer_directly',
  'acknowledge',
  'no_action'
];

export const ALLOWED_URGENCIES = [
  'emergency',
  'urgent',
  'routine'
];

export const ALLOWED_ROUTING_QUEUES = [
  'clinician_urgent',
  'clinician_routine',
  'provider_refills',
  'front_desk',
  'billing'
];

export const ALLOWED_INTENTS = [
  'refill',
  'schedule',
  'reschedule',
  'cancel',
  'clinical',
  'billing',
  'records',
  'admin',
  'new_patient',
  'third_party',
  'other',
  'spam'
];
