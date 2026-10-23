import { ALLOWED_ROUTING_QUEUES } from '../policies/types.js';

export function createRoutingTools() {
  return {
    route_message: {
      name: 'route_message',
      description: 'Routes a patient message to one or more clinic staff queues according to triage policy.',
      parameters: {
        type: 'object',
        properties: {
          queues: {
            type: 'array',
            items: {
              type: 'string',
              enum: ALLOWED_ROUTING_QUEUES
            },
            description: 'Destination queue names: clinician_urgent, clinician_routine, provider_refills, front_desk, billing'
          },
          reason: { type: 'string', description: 'Clinical or operational reason for routing' }
        },
        required: ['queues']
      },
      handler: async (args) => {
        const validQueues = args.queues.filter(q => ALLOWED_ROUTING_QUEUES.includes(q));
        return {
          success: true,
          routed_to: validQueues,
          reason: args.reason || 'Routed per clinic triage guidelines'
        };
      }
    }
  };
}
