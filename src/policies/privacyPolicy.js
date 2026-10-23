/**
 * Privacy Policy: Patient Verification and Authorised Caregiver Rules
 * 
 * Clinic Policy:
 * "Never disclose health information or appointment details unless the sender is verified
 * as the patient or an authorised caregiver on file. Verification = name + date of birth match,
 * or the message comes from the phone/email on file."
 */

export function verifySender(patient, message) {
  if (!patient) {
    return {
      isVerified: false,
      isCaregiver: false,
      reason: 'No matching patient record found on file'
    };
  }

  const cleanPhone = (s) => (s || '').replace(/\D/g, '');
  const cleanEmail = (s) => (s || '').trim().toLowerCase();
  const cleanName = (s) => (s || '').trim().toLowerCase();

  const msgContact = message.from_contact || '';
  const msgName = message.from_name || '';
  const statedDob = message.stated_dob || null;

  const patientPhone = cleanPhone(patient.phone);
  const patientEmail = cleanEmail(patient.email);
  const patientDob = patient.dob;
  const caregiver = patient.authorised_caregiver || null;

  // Check 1: Check if sender is an authorised caregiver on file
  if (caregiver) {
    const isCaregiverNameMatch = msgName && cleanName(msgName) === cleanName(caregiver.name);
    const isCaregiverPhoneMatch = caregiver.phone && cleanPhone(msgContact) === cleanPhone(caregiver.phone);

    if (isCaregiverNameMatch && (isCaregiverPhoneMatch || message.channel === 'portal' || !caregiver.phone)) {
      return {
        isVerified: true,
        isCaregiver: true,
        caregiverName: caregiver.name,
        relationship: caregiver.relationship,
        verifiedVia: isCaregiverPhoneMatch ? 'caregiver_phone' : 'caregiver_name',
        reason: `Sender is verified authorised caregiver (${caregiver.relationship}) on file`
      };
    }

    if (isCaregiverPhoneMatch && !cleanName(msgName).includes(cleanName(patient.name))) {
      return {
        isVerified: true,
        isCaregiver: true,
        caregiverName: caregiver.name,
        relationship: caregiver.relationship,
        verifiedVia: 'caregiver_phone',
        reason: `Sender is authorised caregiver (${caregiver.relationship}) matching phone on file`
      };
    }
  }

  // Check 2: Message comes from patient phone on file
  if (msgContact && cleanPhone(msgContact) === patientPhone && patientPhone.length > 0) {
    return {
      isVerified: true,
      isCaregiver: false,
      verifiedVia: 'phone',
      reason: 'Sender phone matches patient record on file'
    };
  }

  // Check 3: Message comes from patient email on file
  if (msgContact && cleanEmail(msgContact) === patientEmail && patientEmail.length > 0) {
    return {
      isVerified: true,
      isCaregiver: false,
      verifiedVia: 'email',
      reason: 'Sender email matches patient record on file'
    };
  }

  // Check 4: Sender is authorised caregiver with matching name
  if (caregiver && caregiver.name && cleanName(msgName) === cleanName(caregiver.name)) {
    // If phone also matches or in portal
    if (!caregiver.phone || cleanPhone(msgContact) === cleanPhone(caregiver.phone) || message.channel === 'portal') {
      return {
        isVerified: true,
        isCaregiver: true,
        caregiverName: caregiver.name,
        relationship: caregiver.relationship,
        verifiedVia: 'caregiver_name',
        reason: `Sender verified as authorised caregiver (${caregiver.relationship}) on file`
      };
    }
  }

  // Check 5: Name + Date of Birth match
  if (cleanName(msgName) === cleanName(patient.name) && statedDob) {
    if (statedDob === patientDob) {
      return {
        isVerified: true,
        isCaregiver: false,
        verifiedVia: 'dob',
        reason: 'Sender name and stated date of birth match patient record on file'
      };
    } else {
      return {
        isVerified: false,
        isCaregiver: false,
        failedDob: true,
        reason: `Stated date of birth (${statedDob}) does not match patient record`
      };
    }
  }

  // Check 6: Unauthorised third party (e.g. spouse, acquaintance not on file)
  const isThirdParty = /wife|husband|spouse|friend|partner|colleague|daughter|son/i.test(message.body || '');
  if (isThirdParty && !caregiver) {
    return {
      isVerified: false,
      isCaregiver: false,
      isThirdParty: true,
      reason: 'Sender claims relationship to patient but is not an authorised caregiver on file'
    };
  }

  return {
    isVerified: false,
    isCaregiver: false,
    reason: 'Sender contact does not match record and valid identity verification was not supplied'
  };
}
