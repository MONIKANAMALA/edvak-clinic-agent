import { z } from 'zod';
import {
  ALLOWED_ACTIONS,
  ALLOWED_URGENCIES,
  ALLOWED_ROUTING_QUEUES,
  ALLOWED_INTENTS
} from '../policies/types.js';

/**
 * Output schema as required by Section 8 of the prompt:
 * {
 *   "id": "M001",
 *   "patient_id": "P002", // or null
 *   "intents": ["refill"],
 *   "urgency": "routine",
 *   "actions": ["prepare_refill_for_approval"],
 *   "routed_to": ["provider_refills"],
 *   "tool_calls": ["find_patient", "check_refill_eligibility"],
 *   "reply_draft": "Example reply"
 * }
 */
export const AgentOutputSchema = z.object({
  id: z.string().min(1, 'Message ID is required'),
  patient_id: z.string().nullable(),
  intents: z.array(z.string()).min(1, 'At least one intent is required'),
  urgency: z.enum(['emergency', 'urgent', 'routine']),
  actions: z.array(z.enum(ALLOWED_ACTIONS)).min(1, 'At least one action is required'),
  routed_to: z.array(z.enum(ALLOWED_ROUTING_QUEUES)),
  tool_calls: z.array(z.string()),
  reply_draft: z.string().min(1, 'A reply draft is required')
});

export const InputMessageSchema = z.object({
  id: z.string(),
  received_at: z.string(),
  channel: z.enum(['sms', 'portal', 'email']),
  from_name: z.string(),
  from_contact: z.string(),
  body: z.string(),
  stated_dob: z.string().optional()
});

export function validateAgentOutput(output) {
  return AgentOutputSchema.safeParse(output);
}
