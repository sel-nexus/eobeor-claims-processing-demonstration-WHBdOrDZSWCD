export const MASKING_POLICIES = Object.freeze({
  REDACT: 'REDACT',
  IDENTIFIER: 'IDENTIFIER',
  SSN: 'SSN',
  FINANCIAL: 'FINANCIAL',
  API_KEY: 'API_KEY',
  SESSION: 'SESSION',
  CREDENTIAL: 'CREDENTIAL',
  ADDRESS: 'ADDRESS',
  CONTACT: 'CONTACT',
  NAME: 'NAME',
  MEMBER_IDENTIFIER: 'MEMBER_IDENTIFIER',
  CLAIM_IDENTIFIER: 'CLAIM_IDENTIFIER',
  PROVIDER_IDENTIFIER: 'PROVIDER_IDENTIFIER',
  MEDICAL: 'MEDICAL',
  PRESERVE: 'PRESERVE',
});

export const REDACTED_VALUE = '[REDACTED]';
export const CIRCULAR_VALUE = '[REDACTED:CIRCULAR]';

const DEFAULT_VISIBLE_CHARACTERS = 4;
const DEFAULT_MAXIMUM_DEPTH = 10;
const MASK_CHARACTER = '*';

const BLOCKED_PROPERTY_NAMES = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

const SUPPORTED_ROLES = new Set([
  'MEMBER',
  'CSR',
  'BOS',
  'ITS',
  'ADMIN',
]);

const POLICY_VALUES = new Set(Object.values(MASKING_POLICIES));

const SAFE_METADATA_FIELDS = new Set([
  'active',
  'acknowledged',
  'allowed',
  'attempt',
  'authoritative',
  'available',
  'category',
  'code',
  'completedat',
  'createdat',
  'currency',
  'documentdate',
  'documenttype',
  'endedat',
  'fixtureversion',
  'kind',
  'label',
  'linenumber',
  'localonly',
  'mediatype',
  'networkenabled',
  'outcome',
  'priority',
  'representativeonly',
  'revision',
  'role',
  'rownumber',
  'schemaVersion',
  'schemaversion',
  'severity',
  'simulated',
  'startedat',
  'status',
  'type',
  'updatedat',
  'version',
]);

const SENSITIVE_CONTAINER_FIELDS = new Set([
  'account',
  'accounts',
  'address',
  'addresses',
  'authorization',
  'claim',
  'claims',
  'contact',
  'contacts',
  'credential',
  'credentials',
  'financial',
  'member',
  'members',
  'medical',
  'patient',
  'patients',
  'payment',
  'payments',
  'provider',
  'providers',
  'session',
  'sessions',
]);

const ALWAYS_MASKED_POLICIES = new Set([
  MASKING_POLICIES.SSN,
  MASKING_POLICIES.FINANCIAL,
  MASKING_POLICIES.API_KEY,
  MASKING_POLICIES.SESSION,
  MASKING_POLICIES.CREDENTIAL,
]);

const ROLE_VISIBLE_POLICIES = Object.freeze({
  ADMIN: new Set([
    MASKING_POLICIES.ADDRESS,
    MASKING_POLICIES.CONTACT,
    MASKING_POLICIES.NAME,
    MASKING_POLICIES.MEMBER_IDENTIFIER,
    MASKING_POLICIES.CLAIM_IDENTIFIER,
    MASKING_POLICIES.PROVIDER_IDENTIFIER,
    MASKING_POLICIES.MEDICAL,
  ]),
  BOS: new Set([
    MASKING_POLICIES.NAME,
    MASKING_POLICIES.MEMBER_IDENTIFIER,
    MASKING_POLICIES.CLAIM_IDENTIFIER,
    MASKING_POLICIES.PROVIDER_IDENTIFIER,
    MASKING_POLICIES.MEDICAL,
  ]),
  CSR: new Set([
    MASKING_POLICIES.NAME,
    MASKING_POLICIES.CLAIM_IDENTIFIER,
    MASKING_POLICIES.PROVIDER_IDENTIFIER,
  ]),
  ITS: new Set([]),
  MEMBER: new Set([]),
});

function normalizeFieldName(value) {
  return typeof value === 'string'
    ? value.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
    : '';
}

function resolveOptions(options) {
  return options !== null &&
    typeof options === 'object' &&
    !Array.isArray(options)
    ? options
    : {};
}

function resolvePolicy(policy) {
  if (typeof policy !== 'string') {
    return MASKING_POLICIES.IDENTIFIER;
  }

  const normalized = policy
    .trim()
    .replace(/[\s-]+/g, '_')
    .toUpperCase();

  return POLICY_VALUES.has(normalized)
    ? normalized
    : MASKING_POLICIES.IDENTIFIER;
}

function resolveVisibleCharacters(value) {
  return Number.isInteger(value) && value >= 0 && value <= 16
    ? value
    : DEFAULT_VISIBLE_CHARACTERS;
}

function resolveMaximumDepth(value) {
  return Number.isInteger(value) && value >= 1 && value <= 50
    ? value
    : DEFAULT_MAXIMUM_DEPTH;
}

function maskTrailingCharacters(value, visibleCharacters) {
  const text = String(value);
  const visibleCount = resolveVisibleCharacters(visibleCharacters);

  if (text.length === 0) {
    return REDACTED_VALUE;
  }

  if (visibleCount === 0) {
    return MASK_CHARACTER.repeat(Math.max(text.length, 4));
  }

  if (text.length <= visibleCount) {
    return MASK_CHARACTER.repeat(text.length);
  }

  return `${MASK_CHARACTER.repeat(
    text.length - visibleCount,
  )}${text.slice(-visibleCount)}`;
}

function maskSsn(value) {
  const digits = String(value).replace(/\D/g, '');

  if (digits.length < 4) {
    return REDACTED_VALUE;
  }

  return `***-**-${digits.slice(-4)}`;
}

function createInitials(value) {
  const words = String(value)
    .trim()
    .split(/[\s,.-]+/)
    .filter(Boolean);

  if (words.length === 0) {
    return REDACTED_VALUE;
  }

  return words
    .slice(0, 3)
    .map((word) => `${word.charAt(0).toUpperCase()}.`)
    .join(' ');
}

function isSensitiveContainer(fieldName) {
  const normalized = normalizeFieldName(fieldName);

  return (
    SENSITIVE_CONTAINER_FIELDS.has(normalized) ||
    normalized.endsWith('account') ||
    normalized.endsWith('address') ||
    normalized.endsWith('claim') ||
    normalized.endsWith('contact') ||
    normalized.endsWith('credential') ||
    normalized.endsWith('member') ||
    normalized.endsWith('patient') ||
    normalized.endsWith('payment') ||
    normalized.endsWith('provider') ||
    normalized.endsWith('session')
  );
}

function classifyField(fieldName, fieldPolicies) {
  const normalized = normalizeFieldName(fieldName);

  if (fieldPolicies !== null && typeof fieldPolicies === 'object') {
    const explicitPolicy =
      fieldPolicies[fieldName] ?? fieldPolicies[normalized];

    if (explicitPolicy !== undefined) {
      return resolvePolicy(explicitPolicy);
    }
  }

  if (SAFE_METADATA_FIELDS.has(normalized)) {
    return MASKING_POLICIES.PRESERVE;
  }

  if (
    normalized === 'password' ||
    normalized.includes('password') ||
    normalized === 'passcode' ||
    normalized === 'pin' ||
    normalized === 'mfacode' ||
    normalized === 'otp' ||
    normalized === 'secret' ||
    normalized.endsWith('secret')
  ) {
    return MASKING_POLICIES.CREDENTIAL;
  }

  if (
    normalized === 'ssn' ||
    normalized.includes('socialsecurity') ||
    normalized.includes('taxpayeridentification')
  ) {
    return MASKING_POLICIES.SSN;
  }

  if (
    normalized.includes('apikey') ||
    normalized.includes('accesstoken') ||
    normalized.includes('refreshtoken') ||
    normalized.includes('bearertoken') ||
    normalized === 'authorization' ||
    normalized === 'cookie'
  ) {
    return MASKING_POLICIES.API_KEY;
  }

  if (
    normalized.includes('sessionid') ||
    normalized.includes('validationtoken') ||
    normalized.includes('downloadtoken')
  ) {
    return MASKING_POLICIES.SESSION;
  }

  if (
    normalized.includes('accountnumber') ||
    normalized.includes('routingnumber') ||
    normalized.includes('cardnumber') ||
    normalized.includes('paymentreference') ||
    normalized.includes('paymenttoken') ||
    normalized.includes('checknumber') ||
    normalized.includes('eftreference') ||
    normalized.includes('bankaccount') ||
    normalized.includes('financialaccount') ||
    normalized.includes('transactionreference')
  ) {
    return MASKING_POLICIES.FINANCIAL;
  }

  if (
    normalized === 'email' ||
    normalized.endsWith('email') ||
    normalized === 'phone' ||
    normalized.endsWith('phone') ||
    normalized.includes('phonenumber') ||
    normalized.includes('faxnumber')
  ) {
    return MASKING_POLICIES.CONTACT;
  }

  if (
    normalized === 'address' ||
    normalized.endsWith('address') ||
    normalized === 'line1' ||
    normalized === 'line2' ||
    normalized === 'street' ||
    normalized === 'street1' ||
    normalized === 'street2' ||
    normalized === 'postalcode' ||
    normalized === 'zipcode'
  ) {
    return MASKING_POLICIES.ADDRESS;
  }

  if (
    normalized === 'name' ||
    normalized.endsWith('name') ||
    normalized === 'firstname' ||
    normalized === 'lastname' ||
    normalized === 'middlename'
  ) {
    return MASKING_POLICIES.NAME;
  }

  if (
    normalized === 'memberid' ||
    normalized.includes('memberidentifier') ||
    normalized.includes('subscriberid') ||
    normalized.includes('beneficiaryid') ||
    normalized.includes('patientid')
  ) {
    return MASKING_POLICIES.MEMBER_IDENTIFIER;
  }

  if (
    normalized === 'claimnumber' ||
    normalized === 'claimid' ||
    normalized.includes('claimidentifier')
  ) {
    return MASKING_POLICIES.CLAIM_IDENTIFIER;
  }

  if (
    normalized === 'providerid' ||
    normalized === 'npi' ||
    normalized.includes('provideridentifier') ||
    normalized.includes('providernumber') ||
    normalized.includes('taxid')
  ) {
    return MASKING_POLICIES.PROVIDER_IDENTIFIER;
  }

  if (
    normalized === 'dateofbirth' ||
    normalized === 'dob' ||
    normalized.includes('diagnosis') ||
    normalized.includes('procedurecode') ||
    normalized.includes('medicalrecord') ||
    normalized.includes('healthrecord') ||
    normalized.includes('clinical') ||
    normalized.includes('treatment')
  ) {
    return MASKING_POLICIES.MEDICAL;
  }

  if (
    normalized === 'id' ||
    normalized.endsWith('identifier') ||
    normalized.endsWith('reference')
  ) {
    return MASKING_POLICIES.IDENTIFIER;
  }

  return MASKING_POLICIES.PRESERVE;
}

function clonePreservedValue(value, state, depth) {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  return walkValue(value, state, depth, false);
}

function applyPolicy(value, policy, options) {
  if (value === null || value === undefined) {
    return value;
  }

  switch (policy) {
    case MASKING_POLICIES.PRESERVE:
      return value;
    case MASKING_POLICIES.SSN:
      return maskSsn(value);
    case MASKING_POLICIES.NAME:
      return createInitials(value);
    case MASKING_POLICIES.IDENTIFIER:
    case MASKING_POLICIES.FINANCIAL:
    case MASKING_POLICIES.API_KEY:
    case MASKING_POLICIES.SESSION:
    case MASKING_POLICIES.MEMBER_IDENTIFIER:
    case MASKING_POLICIES.CLAIM_IDENTIFIER:
    case MASKING_POLICIES.PROVIDER_IDENTIFIER:
      return maskTrailingCharacters(
        value,
        options.visibleCharacters,
      );
    case MASKING_POLICIES.CREDENTIAL:
    case MASKING_POLICIES.ADDRESS:
    case MASKING_POLICIES.CONTACT:
    case MASKING_POLICIES.MEDICAL:
    case MASKING_POLICIES.REDACT:
    default:
      return REDACTED_VALUE;
  }
}

function walkValue(value, state, depth, sensitiveContext) {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return sensitiveContext && state.redactUnknownSensitiveValues
      ? REDACTED_VALUE
      : value;
  }

  if (
    value === undefined ||
    typeof value === 'function' ||
    typeof value === 'symbol' ||
    typeof value === 'bigint'
  ) {
    return REDACTED_VALUE;
  }

  if (depth >= state.maximumDepth) {
    return REDACTED_VALUE;
  }

  if (state.ancestors.has(value)) {
    return CIRCULAR_VALUE;
  }

  state.ancestors.add(value);

  let result;

  if (Array.isArray(value)) {
    result = value.map((item) =>
      walkValue(item, state, depth + 1, sensitiveContext),
    );
  } else {
    result = {};

    Object.entries(value).forEach(([key, item]) => {
      if (BLOCKED_PROPERTY_NAMES.has(key)) {
        return;
      }

      const policy = classifyField(key, state.fieldPolicies);
      const childSensitiveContext =
        sensitiveContext || isSensitiveContainer(key);

      if (policy === MASKING_POLICIES.PRESERVE) {
        result[key] =
          childSensitiveContext &&
          state.redactUnknownSensitiveValues &&
          (item === null || typeof item !== 'object')
            ? REDACTED_VALUE
            : clonePreservedValue(item, state, depth + 1);
        return;
      }

      if (item !== null && typeof item === 'object') {
        result[key] =
          policy === MASKING_POLICIES.REDACT ||
          policy === MASKING_POLICIES.CREDENTIAL ||
          policy === MASKING_POLICIES.ADDRESS ||
          policy === MASKING_POLICIES.CONTACT ||
          policy === MASKING_POLICIES.MEDICAL
            ? REDACTED_VALUE
            : walkValue(item, state, depth + 1, true);
        return;
      }

      result[key] = applyPolicy(item, policy, state);
    });
  }

  state.ancestors.delete(value);
  return Object.freeze(result);
}

function shouldPreserveForRole(policy, role, options) {
  if (policy === MASKING_POLICIES.PRESERVE) {
    return true;
  }

  if (ALWAYS_MASKED_POLICIES.has(policy)) {
    return false;
  }

  if (
    role === 'MEMBER' &&
    options.owned === true &&
    policy !== MASKING_POLICIES.PROVIDER_IDENTIFIER
  ) {
    return true;
  }

  return ROLE_VISIBLE_POLICIES[role]?.has(policy) === true;
}

function walkForRole(value, role, state, depth, sensitiveContext) {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return sensitiveContext && state.redactUnknownSensitiveValues
      ? REDACTED_VALUE
      : value;
  }

  if (
    value === undefined ||
    typeof value === 'function' ||
    typeof value === 'symbol' ||
    typeof value === 'bigint'
  ) {
    return REDACTED_VALUE;
  }

  if (depth >= state.maximumDepth) {
    return REDACTED_VALUE;
  }

  if (state.ancestors.has(value)) {
    return CIRCULAR_VALUE;
  }

  state.ancestors.add(value);

  let result;

  if (Array.isArray(value)) {
    result = value.map((item) =>
      walkForRole(item, role, state, depth + 1, sensitiveContext),
    );
  } else {
    result = {};

    Object.entries(value).forEach(([key, item]) => {
      if (BLOCKED_PROPERTY_NAMES.has(key)) {
        return;
      }

      const policy = classifyField(key, state.fieldPolicies);
      const childSensitiveContext =
        sensitiveContext || isSensitiveContainer(key);

      if (shouldPreserveForRole(policy, role, state)) {
        result[key] =
          item !== null && typeof item === 'object'
            ? walkForRole(
                item,
                role,
                state,
                depth + 1,
                childSensitiveContext,
              )
            : item;
        return;
      }

      if (item !== null && typeof item === 'object') {
        result[key] =
          policy === MASKING_POLICIES.PRESERVE
            ? walkForRole(
                item,
                role,
                state,
                depth + 1,
                childSensitiveContext,
              )
            : REDACTED_VALUE;
        return;
      }

      result[key] = applyPolicy(item, policy, state);
    });
  }

  state.ancestors.delete(value);
  return Object.freeze(result);
}

/**
 * Masks an identifier while retaining at most a limited number of trailing
 * characters.
 *
 * @param {unknown} value Identifier to mask.
 * @param {{visibleCharacters?: number}} [options] Masking options.
 * @returns {unknown} Masked identifier, or the original nullish value.
 */
export function maskIdentifier(value, options = {}) {
  if (value === null || value === undefined) {
    return value;
  }

  const normalizedOptions = resolveOptions(options);

  return maskTrailingCharacters(
    value,
    normalizedOptions.visibleCharacters,
  );
}

/**
 * Masks a scalar value according to a named masking policy.
 *
 * @param {unknown} value Value to mask.
 * @param {string|Record<string, unknown>} [policy] Policy name or options.
 * @param {{visibleCharacters?: number}} [options] Masking options.
 * @returns {unknown} Masked value.
 */
export function maskValue(
  value,
  policy = MASKING_POLICIES.IDENTIFIER,
  options = {},
) {
  const policyIsOptions =
    policy !== null &&
    typeof policy === 'object' &&
    !Array.isArray(policy);
  const normalizedOptions = resolveOptions(
    policyIsOptions ? policy : options,
  );
  const resolvedPolicy = resolvePolicy(
    policyIsOptions ? normalizedOptions.policy : policy,
  );

  if (value !== null && typeof value === 'object') {
    return maskObject(value, normalizedOptions);
  }

  return applyPolicy(value, resolvedPolicy, normalizedOptions);
}

/**
 * Creates a deeply frozen, audit-safe copy of an object or array.
 *
 * Recognized PII, PHI, credential, session, payment, and identifier fields are
 * masked by field name. Unknown scalar fields nested beneath sensitive
 * entities are redacted by default.
 *
 * @param {unknown} value Value to mask.
 * @param {{
 *   visibleCharacters?: number,
 *   maximumDepth?: number,
 *   redactUnknownSensitiveValues?: boolean,
 *   fieldPolicies?: Record<string, string>
 * }} [options] Masking options.
 * @returns {unknown} Deeply frozen masked copy.
 */
export function maskObject(value, options = {}) {
  const normalizedOptions = resolveOptions(options);
  const state = {
    ancestors: new Set(),
    maximumDepth: resolveMaximumDepth(
      normalizedOptions.maximumDepth,
    ),
    visibleCharacters: resolveVisibleCharacters(
      normalizedOptions.visibleCharacters,
    ),
    redactUnknownSensitiveValues:
      normalizedOptions.redactUnknownSensitiveValues !== false,
    fieldPolicies: resolveOptions(normalizedOptions.fieldPolicies),
  };

  return walkValue(value, state, 0, false);
}

/**
 * Produces a role-filtered, deeply frozen copy of presentation data.
 *
 * Unknown roles receive the most restrictive treatment. Credentials, SSNs,
 * session values, API keys, and financial account references are always
 * masked, including for privileged demo roles.
 *
 * @param {unknown} value Value to redact.
 * @param {string} role Platform role.
 * @param {{
 *   owned?: boolean,
 *   visibleCharacters?: number,
 *   maximumDepth?: number,
 *   redactUnknownSensitiveValues?: boolean,
 *   fieldPolicies?: Record<string, string>
 * }} [options] Role-redaction options.
 * @returns {unknown} Deeply frozen role-filtered copy.
 */
export function redactForRole(value, role, options = {}) {
  const normalizedRole =
    typeof role === 'string' && SUPPORTED_ROLES.has(role.toUpperCase())
      ? role.toUpperCase()
      : 'ITS';
  const normalizedOptions = resolveOptions(options);
  const state = {
    ancestors: new Set(),
    maximumDepth: resolveMaximumDepth(
      normalizedOptions.maximumDepth,
    ),
    visibleCharacters: resolveVisibleCharacters(
      normalizedOptions.visibleCharacters,
    ),
    redactUnknownSensitiveValues:
      normalizedOptions.redactUnknownSensitiveValues !== false,
    fieldPolicies: resolveOptions(normalizedOptions.fieldPolicies),
    owned: normalizedOptions.owned === true,
  };

  return walkForRole(value, normalizedRole, state, 0, false);
}

export const maskSensitiveValue = maskValue;
export const maskSensitiveObject = maskObject;
export const redactSensitiveDataForRole = redactForRole;

export default Object.freeze({
  maskValue,
  maskObject,
  maskIdentifier,
  redactForRole,
});