/**
 * Safety Policy: Emergency Detection, Triage, and Escalation Invariants
 */

// Explicit idioms that contain emergency-sounding words but are colloquial expressions
const IDIOMS = [
  /dying to get in/i,
  /dying to see/i,
  /killing me/i,
  /to die for/i
];

// Severe emergency symptoms requiring immediate 911 escalation
const EMERGENCY_PATTERNS = [
  // Cardiac / Heart Attack / Chest pain
  {
    regex: /(heart\s*attack|cardiac\s*arrest|myocardial\s*infarction)/i,
    reason: 'Reported heart attack or cardiac arrest'
  },
  {
    regex: /(crushing|severe|radiating|pressure)\s+chest\s+pain/i,
    reason: 'Crushing or radiating chest pain suggestive of acute coronary syndrome'
  },
  {
    regex: /chest\s+(pain|pressure|tightness|heaviness)/i,
    reason: 'Acute chest pain or pressure suggestive of cardiac event'
  },
  {
    regex: /pain\s+in\s+(my\s+)?chest/i,
    reason: 'Acute chest pain suggestive of cardiac event'
  },
  {
    regex: /chest\s+pain.*(arm|jaw|neck|back|sweat|dizzy)/i,
    reason: 'Chest pain associated with radiation, diaphoresis, or dizziness'
  },
  // Head injury with neurological deficit / confusion
  {
    regex: /(hit|struck|fell.*hit)\s+(her|his|my)?\s*head.*(confus|dazed|unconscious|blackout)/i,
    reason: 'Head trauma accompanied by acute confusion or altered mental status'
  },
  // Severe respiratory distress
  {
    regex: /(wheezing|gasping|cannot\s+breathe|can't\s+breathe|can't\s+finish\s+sentences|struggling\s+to\s+breathe|shortness\s+of\s+breath|suffocating)/i,
    reason: 'Severe respiratory distress or acute asthma exacerbation'
  },
  // Severe hypoglycemia
  {
    regex: /blood\s+sugar.*(under\s*50|4\d|3\d|2\d).*shak(y|ing)/i,
    reason: 'Severe symptomatic hypoglycemia'
  },
  {
    regex: /(reading\s+was\s+45|sugar.*45).*(shaky|sweaty|confused)/i,
    reason: 'Critical hypoglycemia reading with neuroglycopenic symptoms'
  },
  // Anticoagulant hemorrhage
  {
    regex: /(warfarin|coumadin|eliquis|xarelto).*bleeding.*(dark\s+stool|black\s+stool|melena|vomit)/i,
    reason: 'Gastrointestinal hemorrhage or significant bleeding on anticoagulant therapy'
  },
  {
    regex: /(bleeding\s+a\s+lot|dark\s+stools).*(warfarin|blood\s+thinner)/i,
    reason: 'Bleeding complications on anticoagulant therapy'
  },
  // Stroke / Neurological deficit / Unconscious
  {
    regex: /(facial\s+droop|slurred\s+speech|sudden\s+weakness|paralysis|one-sided\s+weakness|stroke)/i,
    reason: 'Focal neurological deficits suggestive of acute stroke'
  },
  {
    regex: /(unresponsive|passed\s+out|unconscious|loss\s+of\s+consciousness)/i,
    reason: 'Loss of consciousness or altered responsiveness'
  },
  // Severe anaphylaxis
  {
    regex: /(throat\s+closing|lip\s+swelling|tongue\s+swelling|anaphylax)/i,
    reason: 'Signs of anaphylaxis or airway compromise'
  },
  // Acute suicide / Overdose
  {
    regex: /(kill\s+myself|end\s+my\s+life|commit\s+suicide|overdosed)/i,
    reason: 'Acute self-harm emergency or overdose'
  }
];

// Urgent mood / mental health concerns requiring same-day clinician evaluation
const URGENT_MOOD_PATTERNS = [
  {
    regex: /(don't\s+see\s+the\s+point\s+of\s+anything|feeling\s+really\s+low|suicid|harm\s+myself|want\s+to\s+die|end\s+it\s+all)/i,
    reason: 'Depressive symptoms or passive suicidal ideation requiring same-day clinical evaluation'
  }
];

// Urgent clinical conditions (UTI, fever in children, etc.) requiring timely care
const URGENT_CLINICAL_PATTERNS = [
  {
    regex: /(fever.*cough|cough.*fever)/i,
    reason: 'Pediatric fever and respiratory illness'
  },
  {
    regex: /(uti|burning\s+when\s+i\s+pee|painful\s+urination)/i,
    reason: 'Symptomatic urinary tract infection'
  }
];

export function assessEmergency(messageBody) {
  const text = (messageBody || '').trim();

  // Check for idioms first
  for (const idiom of IDIOMS) {
    if (idiom.test(text)) {
      return {
        isEmergency: false,
        reason: 'Colloquial idiom detected; not a medical emergency'
      };
    }
  }

  // Check emergency patterns
  for (const pattern of EMERGENCY_PATTERNS) {
    if (pattern.regex.test(text)) {
      return {
        isEmergency: true,
        urgency: 'emergency',
        action: 'escalate_emergency',
        reason: pattern.reason
      };
    }
  }

  return {
    isEmergency: false
  };
}

export function assessUrgency(messageBody, intents = []) {
  const text = (messageBody || '').trim();

  // First: Emergency check
  const emergencyCheck = assessEmergency(text);
  if (emergencyCheck.isEmergency) {
    return {
      urgency: 'emergency',
      actions: ['escalate_emergency'],
      routed_to: ['clinician_urgent'],
      reason: emergencyCheck.reason
    };
  }

  // Second: Urgent mood concern
  for (const pattern of URGENT_MOOD_PATTERNS) {
    if (pattern.regex.test(text)) {
      return {
        urgency: 'urgent',
        actions: ['route_to_clinician'],
        routed_to: ['clinician_urgent'],
        reason: pattern.reason,
        isMoodConcern: true
      };
    }
  }

  // Third: Urgent clinical symptom
  for (const pattern of URGENT_CLINICAL_PATTERNS) {
    if (pattern.regex.test(text)) {
      return {
        urgency: 'urgent',
        actions: ['route_to_clinician'],
        routed_to: ['clinician_urgent'],
        reason: pattern.reason,
        isUrgentSymptom: true
      };
    }
  }

  // Routine
  return {
    urgency: 'routine',
    actions: [],
    routed_to: [],
    reason: 'Standard non-urgent inquiry'
  };
}

export function formatEmergencyReply(clinicName = 'Maplewood Family Clinic') {
  return `EMERGENCY ALERT: If you are experiencing a life-threatening medical emergency, please call 911 immediately or proceed to the nearest emergency room. We have alerted our clinical staff at ${clinicName}, but automated messages are not a substitute for urgent clinical care.`;
}
