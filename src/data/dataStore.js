import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Standard data directory relative to project root
const DEFAULT_DATA_DIR = path.resolve(__dirname, '../../edvak_forge_data');

export class DataStore {
  constructor(dataDir = DEFAULT_DATA_DIR) {
    this.dataDir = dataDir;
    this.clinic = null;
    this.patients = [];
    this.medications = [];
    this.initialAppointments = [];
    this.appointments = [];
    this.loadData();
  }

  loadData() {
    try {
      const clinicPath = path.join(this.dataDir, 'clinic.json');
      const patientsPath = path.join(this.dataDir, 'patients.json');
      const medicationsPath = path.join(this.dataDir, 'medications.json');
      const appointmentsPath = path.join(this.dataDir, 'appointments.json');

      this.clinic = JSON.parse(fs.readFileSync(clinicPath, 'utf8'));
      this.patients = JSON.parse(fs.readFileSync(patientsPath, 'utf8'));
      this.medications = JSON.parse(fs.readFileSync(medicationsPath, 'utf8'));
      this.initialAppointments = JSON.parse(fs.readFileSync(appointmentsPath, 'utf8'));

      // In-memory clone for active mutations
      this.resetAppointments();
    } catch (err) {
      throw new Error(`Failed to load clinic data from ${this.dataDir}: ${err.message}`);
    }
  }

  /**
   * Reset in-memory appointments back to the baseline JSON data
   */
  resetAppointments() {
    this.appointments = JSON.parse(JSON.stringify(this.initialAppointments));
  }

  getClinic() {
    return this.clinic;
  }

  getToday() {
    return process.env.CLINIC_TODAY || (this.clinic && this.clinic.today) || '2026-11-09';
  }

  getPatients() {
    return this.patients;
  }

  getPatientById(patientId) {
    if (!patientId) return null;
    return this.patients.find(p => p.id === patientId) || null;
  }

  /**
   * Search for a patient by name, phone, email, or exact ID
   */
  findPatient({ name, phone, email, patientId }) {
    if (patientId) {
      const match = this.getPatientById(patientId);
      if (match) return match;
    }

    const clean = (s) => (s || '').trim().toLowerCase();

    // 1. Direct phone match on patient or caregiver
    if (phone) {
      const cleanPhone = phone.replace(/\D/g, '');
      const match = this.patients.find(p => {
        const pPhone = (p.phone || '').replace(/\D/g, '');
        const cPhone = p.authorised_caregiver?.phone ? p.authorised_caregiver.phone.replace(/\D/g, '') : null;
        return (pPhone && pPhone === cleanPhone) || (cPhone && cPhone === cleanPhone);
      });
      if (match) return match;
    }

    // 2. Direct email match
    if (email) {
      const match = this.patients.find(p => clean(p.email) === clean(email));
      if (match) return match;
    }

    // 3. Name match (case-insensitive)
    if (name) {
      const searchName = clean(name);
      // Direct patient name match
      let match = this.patients.find(p => clean(p.name) === searchName);
      if (match) return match;

      // Caregiver name match
      match = this.patients.find(p => clean(p.authorised_caregiver?.name) === searchName);
      if (match) return match;

      // Partial name match (e.g. first + last matching)
      match = this.patients.find(p => clean(p.name).includes(searchName) || searchName.includes(clean(p.name)));
      if (match) return match;
    }

    return null;
  }

  getMedications(patientId) {
    if (!patientId) return [];
    return this.medications.filter(m => m.patient_id === patientId);
  }

  getAppointments(filters = {}) {
    let result = [...this.appointments];

    if (filters.patient_id) {
      result = result.filter(a => a.patient_id === filters.patient_id);
    }
    if (filters.provider) {
      result = result.filter(a => a.provider === filters.provider);
    }
    if (filters.date) {
      result = result.filter(a => a.date === filters.date);
    }
    if (filters.status) {
      result = result.filter(a => a.status === filters.status);
    } else {
      // Default to active booked appointments unless specified
      result = result.filter(a => a.status === 'booked');
    }

    return result;
  }

  getAppointmentById(appointmentId) {
    return this.appointments.find(a => a.id === appointmentId) || null;
  }

  bookAppointment({ patient_id, provider, date, start, end, visit_type }) {
    const nextNum = this.appointments.length + 1;
    const newId = `A${String(nextNum).padStart(3, '0')}`;
    const newAppt = {
      id: newId,
      patient_id,
      provider,
      date,
      start,
      end,
      visit_type,
      status: 'booked'
    };
    this.appointments.push(newAppt);
    return newAppt;
  }

  rescheduleAppointment(appointmentId, { date, start, end }) {
    const appt = this.appointments.find(a => a.id === appointmentId);
    if (!appt) {
      throw new Error(`Appointment ${appointmentId} not found`);
    }
    appt.date = date;
    appt.start = start;
    appt.end = end;
    appt.status = 'booked';
    return appt;
  }

  cancelAppointment(appointmentId) {
    const appt = this.appointments.find(a => a.id === appointmentId);
    if (!appt) {
      throw new Error(`Appointment ${appointmentId} not found`);
    }
    appt.status = 'cancelled';
    return appt;
  }
}

// Export singleton instance
export const dataStore = new DataStore();
