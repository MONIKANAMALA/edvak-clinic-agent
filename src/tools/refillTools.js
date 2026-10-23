import { findMatchingMedication, evaluateRefillEligibility } from '../policies/refillPolicy.js';

export function createRefillTools(dataStore) {
  return {
    check_refill_eligibility: {
      name: 'check_refill_eligibility',
      description: 'Checks patient active medications against clinic refill policies. Returns eligibility, restrictions, and required actions.',
      parameters: {
        type: 'object',
        properties: {
          patient_id: { type: 'string', description: 'Patient ID' },
          medication_query: { type: 'string', description: 'Medication name or keyword' },
          is_out_of_pills: { type: 'boolean', description: 'Whether the patient states they are out of pills' }
        },
        required: ['patient_id']
      },
      handler: async (args) => {
        const patient = dataStore.getPatientById(args.patient_id);
        if (!patient) {
          return { error: 'Patient not found' };
        }

        const medications = dataStore.getMedications(args.patient_id);
        const matchedMed = findMatchingMedication(medications, args.medication_query);

        if (!matchedMed) {
          return {
            eligible: false,
            found_medication: false,
            actions: ['route_to_provider'],
            routed_to: ['provider_refills'],
            reason: `Requested medication "${args.medication_query}" is not on patient active medication list.`
          };
        }

        const today = dataStore.getToday();
        const evaluation = evaluateRefillEligibility({
          patient,
          medication: matchedMed,
          today,
          isOutOfPills: !!args.is_out_of_pills
        });

        return {
          found_medication: true,
          medication: matchedMed.medication,
          prescriber: matchedMed.prescriber,
          controlled_schedule: matchedMed.controlled_schedule,
          refills_remaining: matchedMed.refills_remaining,
          last_filled: matchedMed.last_filled,
          days_supply: matchedMed.days_supply,
          eligible: evaluation.eligible,
          actions: evaluation.actions,
          routed_to: evaluation.routed_to,
          earliest_request_date: evaluation.earliestRequestDate || null,
          supply_runs_out: evaluation.supplyRunsOut || null,
          reason: evaluation.reason
        };
      }
    },

    prepare_refill_request: {
      name: 'prepare_refill_request',
      description: 'Prepares an eligible medication refill request for provider approval. Never approves or sends prescription directly.',
      parameters: {
        type: 'object',
        properties: {
          patient_id: { type: 'string', description: 'Patient ID' },
          medication: { type: 'string', description: 'Medication name' },
          provider: { type: 'string', description: 'Prescribing provider ID' },
          notes: { type: 'string', description: 'Additional clinical notes or context' }
        },
        required: ['patient_id', 'medication']
      },
      handler: async (args) => {
        // Enforce safety invariant: agent never approves directly
        return {
          status: 'prepared_for_provider_approval',
          patient_id: args.patient_id,
          medication: args.medication,
          provider: args.provider,
          routed_queue: 'provider_refills',
          message: 'Refill request successfully prepared and routed to provider for clinical approval.'
        };
      }
    }
  };
}
