import { verifySender } from '../policies/privacyPolicy.js';

export function createPatientTools(dataStore) {
  return {
    find_patient: {
      name: 'find_patient',
      description: 'Look up a patient record by identifier (name, phone, email, or patient ID). Returns patient record or null.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Patient or caregiver name' },
          phone: { type: 'string', description: 'Phone number' },
          email: { type: 'string', description: 'Email address' },
          patient_id: { type: 'string', description: 'Patient ID (e.g. P001)' }
        }
      },
      handler: async (args) => {
        const patient = dataStore.findPatient(args);
        if (!patient) {
          return {
            found: false,
            patient: null,
            message: 'No patient record matching the provided criteria was found'
          };
        }
        return {
          found: true,
          patient: {
            id: patient.id,
            name: patient.name,
            dob: patient.dob,
            phone: patient.phone,
            email: patient.email,
            primary_provider: patient.primary_provider,
            last_visit: patient.last_visit,
            preferred_language: patient.preferred_language,
            authorised_caregiver: patient.authorised_caregiver || null
          }
        };
      }
    },

    verify_patient: {
      name: 'verify_patient',
      description: 'Verifies whether the message sender is authenticated as the patient or an authorised caregiver according to clinic privacy policy.',
      parameters: {
        type: 'object',
        properties: {
          patient_id: { type: 'string', description: 'Patient ID' },
          from_name: { type: 'string', description: 'Sender name' },
          from_contact: { type: 'string', description: 'Sender phone or email' },
          stated_dob: { type: 'string', description: 'Sender stated DOB if provided' },
          channel: { type: 'string', description: 'Message channel (sms, portal, email)' },
          body: { type: 'string', description: 'Message body' }
        },
        required: ['patient_id']
      },
      handler: async (args) => {
        const patient = dataStore.getPatientById(args.patient_id);
        if (!patient) {
          return {
            is_verified: false,
            patient_id: null,
            reason: 'Patient ID not found'
          };
        }

        const verification = verifySender(patient, {
          from_name: args.from_name,
          from_contact: args.from_contact,
          stated_dob: args.stated_dob,
          channel: args.channel,
          body: args.body
        });

        return {
          patient_id: patient.id,
          patient_name: patient.name,
          preferred_language: patient.preferred_language,
          is_verified: verification.isVerified,
          is_caregiver: verification.isCaregiver || false,
          verified_via: verification.verifiedVia || null,
          is_third_party: verification.isThirdParty || false,
          reason: verification.reason
        };
      }
    }
  };
}
