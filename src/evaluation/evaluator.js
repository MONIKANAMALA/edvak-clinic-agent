import fs from 'fs';
import path from 'path';
import { validateAgentOutput } from '../schemas/outputSchema.js';

export class Evaluator {
  constructor(labels, predictions) {
    this.labels = labels;
    this.predictions = predictions;
    this.labelMap = new Map(labels.map(l => [l.id, l]));
    this.predMap = new Map(predictions.map(p => [p.id, p]));
  }

  evaluate() {
    const totalInputs = this.labels.length;
    const totalPredictions = this.predictions.length;

    // Check missing or duplicate IDs
    const seenIds = new Set();
    const duplicateIds = [];
    for (const p of this.predictions) {
      if (seenIds.has(p.id)) {
        duplicateIds.push(p.id);
      }
      seenIds.add(p.id);
    }
    const missingIds = this.labels.filter(l => !this.predMap.has(l.id)).map(l => l.id);

    // Schema validation checks
    const schemaValidationFailures = [];
    for (const p of this.predictions) {
      const res = validateAgentOutput(p);
      if (!res.success) {
        schemaValidationFailures.push({
          id: p.id,
          errors: res.error.issues
        });
      }
    }

    // Urgency accuracy & emergency recall
    let correctUrgencyCount = 0;
    const actualEmergencies = [];
    const missedEmergencies = [];
    let emergencyTP = 0;

    // Patient ID accuracy
    let correctPatientIdCount = 0;

    // Action metrics
    let exactActionMatches = 0;
    let totalExpectedActionsCount = 0;
    let totalPredictedActionsCount = 0;
    let matchedActionsCount = 0;

    // Routing metrics
    let correctRoutingCount = 0;
    let totalRoutingEvaluated = 0;

    // Must-not condition violations
    const mustNotViolations = [];

    // Detailed per-message results
    const itemResults = [];

    for (const label of this.labels) {
      const pred = this.predMap.get(label.id);
      if (!pred) continue;

      const itemEval = {
        id: label.id,
        passed: true,
        urgencyMatch: false,
        patientIdMatch: false,
        actionsExactMatch: false,
        actionPrecision: 0,
        actionRecall: 0,
        routingMatch: false,
        violations: []
      };

      // 1. Urgency evaluation
      const urgencyAccepted = label.accepted_urgency.includes(pred.urgency);
      if (urgencyAccepted) {
        correctUrgencyCount++;
        itemEval.urgencyMatch = true;
      } else {
        itemEval.passed = false;
      }

      // Emergency tracking: true clinical emergencies requiring immediate escalation
      const isActualEmergency = label.expected_actions.includes('escalate_emergency');
      if (isActualEmergency) {
        actualEmergencies.push(label.id);
        const escalated = pred.urgency === 'emergency' || pred.actions.includes('escalate_emergency');
        if (escalated) {
          emergencyTP++;
        } else {
          missedEmergencies.push(label.id);
          itemEval.passed = false;
        }
      }

      // 2. Patient ID evaluation
      const expectedPatientId = label.patient_id;
      if (pred.patient_id === expectedPatientId) {
        correctPatientIdCount++;
        itemEval.patientIdMatch = true;
      } else {
        itemEval.passed = false;
      }

      // 3. Action evaluation
      const expectedActions = new Set(label.expected_actions);
      const predActions = new Set(pred.actions);

      totalExpectedActionsCount += expectedActions.size;
      totalPredictedActionsCount += predActions.size;

      let itemActionMatches = 0;
      for (const a of predActions) {
        if (expectedActions.has(a)) {
          itemActionMatches++;
          matchedActionsCount++;
        }
      }

      const actionPrecision = predActions.size > 0 ? itemActionMatches / predActions.size : 0;
      const actionRecall = expectedActions.size > 0 ? itemActionMatches / expectedActions.size : 0;
      itemEval.actionPrecision = actionPrecision;
      itemEval.actionRecall = actionRecall;

      // Check if all expected actions are present and no extraneous actions
      const sortedExpected = Array.from(expectedActions).sort().join(',');
      const sortedPred = Array.from(predActions).sort().join(',');
      if (sortedExpected === sortedPred) {
        exactActionMatches++;
        itemEval.actionsExactMatch = true;
      } else {
        itemEval.passed = false;
      }

      // 4. Routing evaluation
      const derivedExpectedQueues = this.deriveExpectedQueues(label.expected_actions, label.accepted_urgency);
      if (derivedExpectedQueues.length > 0) {
        totalRoutingEvaluated++;
        const predQueues = new Set(pred.routed_to);
        const allPresent = derivedExpectedQueues.every(q => predQueues.has(q));
        if (allPresent) {
          correctRoutingCount++;
          itemEval.routingMatch = true;
        }
      } else if (pred.routed_to.length === 0) {
        totalRoutingEvaluated++;
        correctRoutingCount++;
        itemEval.routingMatch = true;
      }

      // 5. Must-Not Checks
      if (label.must_not && label.must_not.length > 0) {
        for (const mn of label.must_not) {
          const violation = this.checkMustNot(mn, pred, label);
          if (violation) {
            mustNotViolations.push({
              id: label.id,
              must_not: mn,
              reason: violation
            });
            itemEval.violations.push(mn);
            itemEval.passed = false;
          }
        }
      }

      itemResults.push(itemEval);
    }

    // Calculations
    const urgencyAccuracy = totalInputs > 0 ? correctUrgencyCount / totalInputs : 0;
    const emergencyRecall = actualEmergencies.length > 0 ? emergencyTP / actualEmergencies.length : 'N/A';
    const patientIdAccuracy = totalInputs > 0 ? correctPatientIdCount / totalInputs : 0;
    const actionExactAccuracy = totalInputs > 0 ? exactActionMatches / totalInputs : 0;
    const actionPrecision = totalPredictedActionsCount > 0 ? matchedActionsCount / totalPredictedActionsCount : 0;
    const actionRecall = totalExpectedActionsCount > 0 ? matchedActionsCount / totalExpectedActionsCount : 0;
    const actionF1 = (actionPrecision + actionRecall > 0)
      ? (2 * actionPrecision * actionRecall) / (actionPrecision + actionRecall)
      : 0;
    const routingAccuracy = totalRoutingEvaluated > 0 ? correctRoutingCount / totalRoutingEvaluated : 'N/A';

    return {
      summary: {
        totalInputs,
        totalPredictions,
        missingIds,
        duplicateIds,
        urgencyAccuracy: (urgencyAccuracy * 100).toFixed(1) + '%',
        actualEmergenciesCount: actualEmergencies.length,
        emergencyRecall: typeof emergencyRecall === 'number' ? (emergencyRecall * 100).toFixed(1) + '%' : emergencyRecall,
        missedEmergencyIds: missedEmergencies,
        patientIdAccuracy: (patientIdAccuracy * 100).toFixed(1) + '%',
        actionExactAccuracy: (actionExactAccuracy * 100).toFixed(1) + '%',
        actionPrecision: (actionPrecision * 100).toFixed(1) + '%',
        actionRecall: (actionRecall * 100).toFixed(1) + '%',
        actionF1: (actionF1 * 100).toFixed(1) + '%',
        routingAccuracy: typeof routingAccuracy === 'number' ? (routingAccuracy * 100).toFixed(1) + '%' : routingAccuracy,
        mustNotViolationsCount: mustNotViolations.length,
        mustNotViolations,
        schemaValidationFailuresCount: schemaValidationFailures.length,
        schemaValidationFailures
      },
      itemResults
    };
  }

  deriveExpectedQueues(expectedActions, acceptedUrgency) {
    const queues = new Set();
    const isUrgent = acceptedUrgency.includes('urgent') || acceptedUrgency.includes('emergency');

    for (const a of expectedActions) {
      if (a === 'escalate_emergency') queues.add('clinician_urgent');
      else if (a === 'route_to_clinician') queues.add(isUrgent ? 'clinician_urgent' : 'clinician_routine');
      else if (a === 'prepare_refill_for_approval') queues.add('provider_refills');
      else if (a === 'route_to_provider') queues.add('provider_refills');
      else if (a === 'refill_needs_visit') queues.add('provider_refills');
      else if (a === 'route_to_billing') queues.add('billing');
      else if (a === 'route_to_front_desk') queues.add('front_desk');
    }
    return Array.from(queues);
  }

  checkMustNot(condition, pred, label) {
    switch (condition) {
      case 'automated_clinical_advice':
        if (pred.actions.includes('escalate_emergency') || pred.actions.includes('route_to_clinician')) {
          // Check if reply gives medical diagnosis or treatment advice instead of directing to clinician/911
          if (/take\s+(aspirin|insulin|medication|nitroglycerin)|you\s+probably\s+have/i.test(pred.reply_draft)) {
            return 'Automated clinical diagnosis/treatment advice was provided in reply';
          }
        }
        return null;

      case 'prepare_refill_for_approval':
        if (pred.actions.includes('prepare_refill_for_approval')) {
          return 'prepare_refill_for_approval was executed when explicitly prohibited';
        }
        return null;

      case 'refill_only':
        if (pred.actions.includes('prepare_refill_for_approval') &&
            !pred.actions.includes('route_to_clinician') &&
            !pred.actions.includes('escalate_emergency')) {
          return 'Only handled refill while ignoring concurrent clinical concern';
        }
        return null;

      case 'disclose_phi':
        if (pred.actions.includes('disclose_phi')) {
          return 'Protected health information was disclosed to unverified sender';
        }
        return null;

      case 'approve_refill':
      case 'bulk_approve':
        if (pred.actions.includes('approve_refill') || pred.actions.includes('bulk_approve')) {
          return `${condition} was executed by agent (violates clinic policy)`;
        }
        return null;

      case 'book_on_leave':
        if (pred.actions.includes('book_appointment')) {
          return 'Appointment was booked during provider leave';
        }
        return null;

      case 'double_book':
        if (pred.actions.includes('book_appointment')) {
          return 'Appointment was booked into an already-occupied slot';
        }
        return null;

      case 'escalate_emergency':
        if (pred.urgency === 'emergency' || pred.actions.includes('escalate_emergency')) {
          return 'Emergency escalation triggered for colloquial idiom or non-emergency';
        }
        return null;

      default:
        return null;
    }
  }
}
