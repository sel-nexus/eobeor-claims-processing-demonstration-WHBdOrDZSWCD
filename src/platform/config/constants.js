export const APP_NAMESPACE = 'eob-eor-claims-demo';
export const APP_VERSION = import.meta.env.VITE_APP_VERSION || '1.0.0';
export const REFERENCE_DATE =
  import.meta.env.VITE_REFERENCE_DATE || '2024-01-22';
export const FIXTURE_VERSION =
  import.meta.env.VITE_FIXTURE_VERSION || '1';
export const SCHEMA_VERSION = '1.0.0';

export const DOCUMENT_NOTICE = 'This is not a bill.';
export const SIMULATION_STATUS_PHRASE =
  'Processed for demonstration only';
export const SIMULATION_STATUS = SIMULATION_STATUS_PHRASE;

export const REQUIRED_DISCLOSURES = Object.freeze([
  'This prepackaged sample uses fictional data and is not an authoritative claim document.',
  'No coverage, payment, or benefit decision is represented by this artifact.',
  'FICTIONAL DEMO DATA - DO NOT USE FOR HEALTHCARE OR PAYMENT DECISIONS',
]);

export const TIMING_DEFAULTS = Object.freeze({
  simulatedDelayMs: 400,
  searchDebounceMs: 250,
  notificationDurationMs: 5000,
  transitionDurationMs: 200,
});

export const DISPLAY_CONSTANTS = Object.freeze({
  locale: 'en-US',
  currency: 'USD',
  currencyDecimalPlaces: 2,
  defaultPageSize: 10,
  dateFormat: Object.freeze({
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }),
  chartColors: Object.freeze({
    billed: '#2563eb',
    discount: '#d97706',
    planPaid: '#059669',
    memberResponsibility: '#dc2626',
  }),
});

export const APP_CONFIG = Object.freeze({
  namespace: APP_NAMESPACE,
  version: APP_VERSION,
  referenceDate: REFERENCE_DATE,
  fixtureVersion: FIXTURE_VERSION,
  schemaVersion: SCHEMA_VERSION,
  documentNotice: DOCUMENT_NOTICE,
  simulationStatus: SIMULATION_STATUS_PHRASE,
  requiredDisclosures: REQUIRED_DISCLOSURES,
  timing: TIMING_DEFAULTS,
  display: DISPLAY_CONSTANTS,
});