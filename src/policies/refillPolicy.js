/**
 * Medication Refill Policy
 */

/**
 * Add days to a YYYY-MM-DD string
 */
export function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

/**
 * Calculate difference in days between two YYYY-MM-DD dates (d2 - d1)
 */
export function diffDays(d1Str, d2Str) {
  const d1 = new Date(d1Str + 'T00:00:00Z');
  const d2 = new Date(d2Str + 'T00:00:00Z');
  const diffMs = d2.getTime() - d1.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Check if last visit was within the last 12 months (365 days)
 */
export function isSeenWithin12Months(lastVisitStr, todayStr) {
  if (!lastVisitStr) return false;
  const days = diffDays(lastVisitStr, todayStr);
  return days <= 365;
}

/**
 * Brand-to-generic name mapping for common medications in the dataset
 */
const BRAND_ALIASES = {
  'xanax': 'alprazolam',
  'adderall': 'amphetamine',
  'ambien': 'zolpidem',
  'zoloft': 'sertraline',
  'lexapro': 'escitalopram',
  'prilosec': 'omeprazole',
  'lipitor': 'atorvastatin',
  'prinivil': 'lisinopril',
  'zestril': 'lisinopril',
  'norvasc': 'amlodipine',
  'aricept': 'donepezil',
  'proventil': 'albuterol',
  'ventolin': 'albuterol',
  'proair': 'albuterol',
  'synthroid': 'levothyroxine',
  'glucophage': 'metformin',
  'zyrtec': 'cetirizine',
  'lantus': 'insulin glargine',
  'percocet': 'oxycodone',
  'roxicodone': 'oxycodone'
};

/**
 * Find matching medication for a patient from text mention
 */
export function findMatchingMedication(medications, queryText) {
  if (!medications || medications.length === 0) return null;
  const q = (queryText || '').toLowerCase();

  // Check direct name match
  for (const med of medications) {
    const medName = med.medication.toLowerCase();
    const coreMedName = medName.split(' ')[0]; // e.g. "metformin", "lisinopril"
    if (q.includes(coreMedName) || q.includes(medName)) {
      return med;
    }
  }

  // Check brand aliases
  for (const [brand, generic] of Object.entries(BRAND_ALIASES)) {
    if (q.includes(brand)) {
      const match = medications.find(m => m.medication.toLowerCase().includes(generic));
      if (match) return match;
    }
  }

  // If patient has only one medication, return it ONLY if the query explicitly mentions a refill or medication
  if (medications.length === 1 && /refill|medication|medicine|prescription|pills|tablets|dose|mg|ran out|out of/i.test(q)) {
    return medications[0];
  }

  return null;
}

/**
 * Evaluates refill eligibility based on Maplewood Clinic policy
 */
export function evaluateRefillEligibility({ patient, medication, today = '2026-11-09', isOutOfPills = false }) {
  if (!medication) {
    return {
      eligible: false,
      actions: ['route_to_provider'],
      routed_to: ['provider_refills'],
      reason: 'Medication not found on patient active medication list'
    };
  }

  // Rule 2: Controlled substances (Never prepared by agent; route to prescribing provider)
  if (medication.controlled_schedule) {
    return {
      eligible: false,
      isControlled: true,
      schedule: medication.controlled_schedule,
      actions: ['route_to_provider'],
      routed_to: ['provider_refills'],
      reason: `Controlled substance (${medication.controlled_schedule}). Per clinic policy, controlled substances cannot be prepared by the automated agent and must be routed directly to the prescribing provider.`
    };
  }

  // Rule 3: Seen within last 12 months
  const seenWithin12 = isSeenWithin12Months(patient.last_visit, today);
  if (!seenWithin12) {
    // If out of pills (especially psychiatric/critical meds like escitalopram), provider should know today as well
    const actions = ['refill_needs_visit', 'offer_appointment'];
    const routedTo = ['provider_refills'];
    if (isOutOfPills) {
      actions.push('route_to_provider');
    }
    return {
      eligible: false,
      needsVisit: true,
      lastVisit: patient.last_visit,
      actions,
      routed_to: routedTo,
      reason: `Patient last seen on ${patient.last_visit} (over 12 months ago). Clinic policy requires an office visit prior to authorizing further refills.`
    };
  }

  // Rule 4: Refills remaining > 0
  if (medication.refills_remaining <= 0) {
    return {
      eligible: false,
      zeroRefills: true,
      actions: ['route_to_provider'],
      routed_to: ['provider_refills'],
      reason: 'No refills remaining on current prescription. Request routed to provider for a new prescription authorization.'
    };
  }

  // Rule 5: 7-day runout window
  const supplyRunsOut = addDays(medication.last_filled, medication.days_supply);
  const earliestRequestDate = addDays(supplyRunsOut, -7);

  if (diffDays(today, earliestRequestDate) > 0) {
    // Today is before earliestRequestDate -> Too early!
    return {
      eligible: false,
      tooEarly: true,
      lastFilled: medication.last_filled,
      daysSupply: medication.days_supply,
      supplyRunsOut,
      earliestRequestDate,
      actions: ['refill_too_early'],
      routed_to: [],
      reason: `Refill request is too early. Current supply runs out on ${supplyRunsOut}. Earliest eligible request date is ${earliestRequestDate} (7 days before supply depletion).`
    };
  }

  // All criteria satisfied!
  return {
    eligible: true,
    medication: medication.medication,
    prescriber: medication.prescriber,
    refillsRemaining: medication.refills_remaining,
    supplyRunsOut,
    actions: ['prepare_refill_for_approval'],
    routed_to: ['provider_refills'],
    reason: 'Medication is active, non-controlled, patient seen within 12 months, refills remaining, and within the 7-day refill window.'
  };
}
