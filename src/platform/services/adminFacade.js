import { ACTIONS } from '../contracts/capabilities.js';
import { generateUuid } from '../utils/ids.js';
import {
  isJsonCompatible,
  isPlainObject,
  isPlatformRole,
} from '../validation/schemas.js';

export const ADMIN_FACADE_SCHEMA_VERSION = 1;

export const ADMIN_FACADE_ERROR_CODES = Object.freeze({
  INVALID_DEPENDENCY: 'INVALID_DEPENDENCY',
  INVALID_REQUEST: 'INVALID_REQUEST',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  AUTHENTICATION_REQUIRED: 'AUTHENTICATION_REQUIRED',
  ACTION_FORBIDDEN: 'ACTION_FORBIDDEN',
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  USERNAME_EXISTS: 'USERNAME_EXISTS',
  SELF_DELETE_BLOCKED: 'SELF_DELETE_BLOCKED',
  SYSTEM_USER_PROTECTED: 'SYSTEM_USER_PROTECTED',
  SETTINGS_NOT_FOUND: 'SETTINGS_NOT_FOUND',
  REVISION_CONFLICT: 'REVISION_CONFLICT',
  LOCAL_STORAGE_QUOTA: 'LOCAL_STORAGE_QUOTA',
  READ_ONLY_RECOVERY: 'READ_ONLY_RECOVERY',
  AUDIT_FAILED: 'AUDIT_FAILED',
  USER_CREATE_FAILED: 'USER_CREATE_FAILED',
  USER_UPDATE_FAILED: 'USER_UPDATE_FAILED',
  USER_DELETE_FAILED: 'USER_DELETE_FAILED',
  USER_LIST_FAILED: 'USER_LIST_FAILED',
  SETTINGS_UPDATE_FAILED: 'SETTINGS_UPDATE_FAILED',
  SETTINGS_RESTORE_FAILED: 'SETTINGS_RESTORE_FAILED',
});

export const ADMIN_AUDIT_ACTIONS = Object.freeze({
  USER_CREATED: 'USER_CREATED',
  USER_UPDATED: 'USER_UPDATED',
  USER_DELETED: 'USER_DELETED',
  SETTINGS_UPDATED: 'SETTINGS_UPDATED',
  SETTINGS_RESTORED: 'SETTINGS_RESTORED',
});

export const ADMIN_USER_ROLES = Object.freeze([
  'MEMBER',
  'CSR',
  'BOS',
  'ITS',
  'ADMIN',
]);

export const ADMIN_USER_LIMITS = Object.freeze({
  USERNAME_MINIMUM: 3,
  USERNAME_MAXIMUM: 40,
  DISPLAY_NAME_MINIMUM: 2,
  DISPLAY_NAME_MAXIMUM: 80,
});

export const ADMIN_SETTINGS_LIMITS = Object.freeze({
  RETENTION_YEARS_MINIMUM: 1,
  RETENTION_YEARS_MAXIMUM: 10,
  AUTO_APPROVE_AMOUNT_MINIMUM: 0,
  AUTO_APPROVE_AMOUNT_MAXIMUM: 10000,
  SESSION_TIMEOUT_MINUTES_MINIMUM: 2,
  SESSION_TIMEOUT_MINUTES_MAXIMUM: 240,
});

export const ADMIN_DELETE_CONFIRMATION_PREFIX = 'REMOVE';

const USERNAME_PATTERN = /^[a-z0-9._-]{3,40}$/;
const USER_ROLE_VALUES = new Set(ADMIN_USER_ROLES);
const USER_CREATE_FIELDS = new Set([
  'username',
  'displayName',
  'role',
  'memberId',
  'active',
]);
const USER_UPDATE_FIELDS = new Set([
  'username',
  'displayName',
  'role',
  'memberId',
  'active',
]);
const SETTINGS_UPDATE_FIELDS = new Set([
  'retentionYears',
  'autoApproveAmount',
  'sessionTimeoutMinutes',
]);

function deepFreeze(value) {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => deepFreeze(item)));
  }

  if (isPlainObject(value)) {
    const clone = {};

    Object.entries(value).forEach(([key, item]) => {
      clone[key] = deepFreeze(item);
    });

    return Object.freeze(clone);
  }

  return value;
}

function requireDependency(value, predicate, message) {
  if (!predicate(value)) {
    throw new AdminFacadeError(
      ADMIN_FACADE_ERROR_CODES.INVALID_DEPENDENCY,
      message,
    );
  }

  return value;
}

function isUserRepository(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    (typeof value.create === 'function' ||
      typeof value.createUser === 'function') &&
    (typeof value.update === 'function' ||
      typeof value.updateUser === 'function') &&
    (typeof value.delete === 'function' ||
      typeof value.deleteUser === 'function') &&
    (typeof value.query === 'function' ||
      typeof value.list === 'function') &&
    (typeof value.getById === 'function' ||
      typeof value.findById === 'function')
  );
}

function isSettingsRepository(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    (typeof value.get === 'function' ||
      typeof value.getSettings === 'function') &&
    (typeof value.update === 'function' ||
      typeof value.updateSettings === 'function') &&
    (typeof value.restore === 'function' ||
      typeof value.restoreDefaults === 'function' ||
      typeof value.reset === 'function')
  );
}

function isPermissionService(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof value.evaluate === 'function'
  );
}

function isAuditService(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof value.append === 'function'
  );
}

function isSessionProvider(value) {
  return (
    typeof value === 'function' ||
    (value !== null &&
      typeof value === 'object' &&
      (typeof value.getSession === 'function' ||
        typeof value.getSnapshot === 'function' ||
        typeof value.getState === 'function'))
  );
}

function resolveConstructorArguments(
  userRepositoryOrOptions,
  options,
) {
  if (
    isPlainObject(userRepositoryOrOptions) &&
    (userRepositoryOrOptions.userRepository !== undefined ||
      userRepositoryOrOptions.users !== undefined)
  ) {
    return {
      userRepository:
        userRepositoryOrOptions.userRepository ??
        userRepositoryOrOptions.users,
      options: userRepositoryOrOptions,
    };
  }

  return {
    userRepository: userRepositoryOrOptions,
    options: isPlainObject(options) ? options : {},
  };
}

function normalizeText(value) {
  return typeof value === 'string'
    ? value.normalize('NFC').trim()
    : value;
}

function normalizeUsername(value) {
  return typeof value === 'string'
    ? normalizeText(value).toLocaleLowerCase('en-US')
    : value;
}

function normalizeRole(value) {
  return typeof value === 'string'
    ? value.trim().toUpperCase()
    : value;
}

function createCorrelationId(idGenerator) {
  const value = idGenerator();

  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(
      'Admin facade ID generator must return a non-empty string.',
    );
  }

  return value.normalize('NFC').trim();
}

function createSuccess(
  status,
  data,
  correlationId,
  warnings = [],
) {
  return deepFreeze({
    ok: true,
    status,
    data,
    meta: {
      correlationId,
      schemaVersion: ADMIN_FACADE_SCHEMA_VERSION,
      warnings,
    },
  });
}

function createFailure(
  status,
  code,
  message,
  correlationId,
  options = {},
) {
  return deepFreeze({
    ok: false,
    status,
    error: {
      code,
      message,
      correlationId,
      fieldErrors: Array.isArray(options.fieldErrors)
        ? options.fieldErrors
        : [],
      retryable: options.retryable === true,
      ...(options.details === undefined
        ? {}
        : { details: options.details }),
      ...(options.recoveryAction === undefined
        ? {}
        : { recoveryAction: options.recoveryAction }),
    },
  });
}

function createFieldError(field, code, message) {
  return {
    field,
    code,
    message,
  };
}

function readSession(provider) {
  if (typeof provider === 'function') {
    return provider();
  }

  if (typeof provider.getSession === 'function') {
    return provider.getSession();
  }

  const snapshot =
    typeof provider.getSnapshot === 'function'
      ? provider.getSnapshot()
      : provider.getState();

  return snapshot?.session ?? snapshot?.actor ?? null;
}

function normalizeSession(value) {
  if (!isPlainObject(value)) {
    return null;
  }

  const userId = normalizeText(value.userId);
  const displayName = normalizeText(value.displayName);
  const role = normalizeRole(value.role);

  if (
    typeof userId !== 'string' ||
    userId.length === 0 ||
    typeof displayName !== 'string' ||
    displayName.length === 0 ||
    !isPlatformRole(role)
  ) {
    return null;
  }

  return deepFreeze({
    ...value,
    userId,
    displayName,
    role,
  });
}

function getErrorCode(error) {
  return error !== null && typeof error === 'object'
    ? error.code ?? null
    : null;
}

function normalizeOperationFailure(
  error,
  fallbackCode,
  fallbackMessage,
  correlationId,
) {
  const code = getErrorCode(error);

  switch (code) {
    case 'USER_NOT_FOUND':
    case 'NOT_FOUND':
      return createFailure(
        404,
        ADMIN_FACADE_ERROR_CODES.USER_NOT_FOUND,
        'The requested fictional user was not found.',
        correlationId,
      );
    case 'SETTINGS_NOT_FOUND':
      return createFailure(
        404,
        ADMIN_FACADE_ERROR_CODES.SETTINGS_NOT_FOUND,
        'Local demonstration settings were not found.',
        correlationId,
      );
    case 'USERNAME_EXISTS':
    case 'ALREADY_EXISTS':
      return createFailure(
        409,
        ADMIN_FACADE_ERROR_CODES.USERNAME_EXISTS,
        'A fictional user with this username already exists.',
        correlationId,
      );
    case 'SYSTEM_USER_PROTECTED':
      return createFailure(
        409,
        ADMIN_FACADE_ERROR_CODES.SYSTEM_USER_PROTECTED,
        'Seeded fictional users cannot be removed.',
        correlationId,
      );
    case 'REVISION_CONFLICT':
      return createFailure(
        409,
        ADMIN_FACADE_ERROR_CODES.REVISION_CONFLICT,
        'Local demonstration data changed before the operation completed.',
        correlationId,
        { retryable: true },
      );
    case 'STORAGE_QUOTA_EXCEEDED':
    case 'LOCAL_STORAGE_QUOTA':
      return createFailure(
        507,
        ADMIN_FACADE_ERROR_CODES.LOCAL_STORAGE_QUOTA,
        'Browser-local storage quota was exceeded.',
        correlationId,
        { recoveryAction: 'EXPORT_SNAPSHOT' },
      );
    case 'READ_ONLY_RECOVERY':
      return createFailure(
        409,
        ADMIN_FACADE_ERROR_CODES.READ_ONLY_RECOVERY,
        'Local demonstration data is in read-only recovery mode.',
        correlationId,
      );
    case 'FIELD_NOT_PERMITTED':
    case 'PERMISSION_DENIED':
      return createFailure(
        403,
        ADMIN_FACADE_ERROR_CODES.ACTION_FORBIDDEN,
        'The current demo role cannot update this field.',
        correlationId,
      );
    case 'INVALID_USER':
    case 'INVALID_USER_COLLECTION':
    case 'INVALID_UPDATE':
    case 'INVALID_SETTINGS':
    case 'INVALID_REVISION':
    case 'EXPECTED_REVISION_REQUIRED':
    case 'IMMUTABLE_FIELD':
      return createFailure(
        422,
        ADMIN_FACADE_ERROR_CODES.VALIDATION_ERROR,
        'Request validation failed.',
        correlationId,
        {
          details: {
            dependencyCode: code,
          },
        },
      );
    default:
      return createFailure(
        500,
        fallbackCode,
        fallbackMessage,
        correlationId,
        {
          details: {
            dependencyCode: code,
          },
        },
      );
  }
}

function normalizePermissionDecision(value) {
  if (isPlainObject(value?.data)) {
    return value.data;
  }

  return value;
}

function createAuthorizationFailure(
  decision,
  action,
  correlationId,
) {
  const unauthenticated =
    decision?.reasonCode === 'NO_ACTIVE_SESSION' ||
    decision?.reasonCode === 'SESSION_EXPIRED';

  return createFailure(
    unauthenticated ? 401 : 403,
    unauthenticated
      ? ADMIN_FACADE_ERROR_CODES.AUTHENTICATION_REQUIRED
      : ADMIN_FACADE_ERROR_CODES.ACTION_FORBIDDEN,
    unauthenticated
      ? 'An active demo session is required.'
      : 'The current demo role cannot perform this administration operation.',
    correlationId,
    {
      details: {
        action,
        reasonCode: decision?.reasonCode ?? null,
      },
    },
  );
}

function validateRevision(value, field, required = true) {
  if (value === undefined || value === null) {
    return required
      ? createFieldError(
          field,
          'REQUIRED',
          'Expected revision is required.',
        )
      : null;
  }

  if (!Number.isSafeInteger(value) || value < 0) {
    return createFieldError(
      field,
      'INVALID_REVISION',
      'Expected revision must be a non-negative safe integer.',
    );
  }

  return null;
}

function validateUsername(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return createFieldError(
      'username',
      'REQUIRED',
      'Username is required.',
    );
  }

  if (!USERNAME_PATTERN.test(normalizeUsername(value))) {
    return createFieldError(
      'username',
      'INVALID_USERNAME',
      'Username must contain 3–40 lowercase letters, numbers, periods, underscores, or hyphens.',
    );
  }

  return null;
}

function validateDisplayName(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return createFieldError(
      'displayName',
      'REQUIRED',
      'Display name is required.',
    );
  }

  const length = normalizeText(value).length;

  if (
    length < ADMIN_USER_LIMITS.DISPLAY_NAME_MINIMUM ||
    length > ADMIN_USER_LIMITS.DISPLAY_NAME_MAXIMUM
  ) {
    return createFieldError(
      'displayName',
      'INVALID_LENGTH',
      'Display name must contain 2–80 characters.',
    );
  }

  return null;
}

function validateRole(value) {
  const role = normalizeRole(value);

  if (!USER_ROLE_VALUES.has(role)) {
    return createFieldError(
      'role',
      'INVALID_ROLE',
      `Role must be one of: ${ADMIN_USER_ROLES.join(', ')}.`,
    );
  }

  return null;
}

function validateMemberId(value, role) {
  if (role === 'MEMBER') {
    if (
      typeof value !== 'string' ||
      value.trim().length === 0 ||
      value.trim().length > 200
    ) {
      return createFieldError(
        'memberId',
        'REQUIRED',
        'Member ID is required for a member role.',
      );
    }

    return null;
  }

  if (
    value !== undefined &&
    value !== null &&
    value !== ''
  ) {
    return createFieldError(
      'memberId',
      'NOT_ALLOWED',
      'Member ID must be empty for non-member roles.',
    );
  }

  return null;
}

function validateActive(value) {
  if (typeof value !== 'boolean') {
    return createFieldError(
      'active',
      'INVALID_BOOLEAN',
      'Active must be a boolean.',
    );
  }

  return null;
}

function collectUnknownFieldErrors(value, allowedFields) {
  return Object.keys(value)
    .filter((field) => !allowedFields.has(field))
    .map((field) =>
      createFieldError(
        field,
        'UNSUPPORTED_FIELD',
        `Field ${field} is not supported.`,
      ),
    );
}

function normalizeCreateUserRequest(request) {
  if (!isPlainObject(request) || !isJsonCompatible(request)) {
    return {
      value: null,
      options: {},
      errors: [
        createFieldError(
          '$',
          'INVALID_REQUEST',
          'User creation request must be a safe object.',
        ),
      ],
    };
  }

  const allowedFields = new Set([
    ...USER_CREATE_FIELDS,
    'expectedRootRevision',
  ]);
  const role = normalizeRole(request.role);
  const active =
    request.active === undefined ? true : request.active;
  const errors = [
    ...collectUnknownFieldErrors(request, allowedFields),
    validateUsername(request.username),
    validateDisplayName(request.displayName),
    validateRole(role),
    validateMemberId(request.memberId, role),
    validateActive(active),
  ].filter(Boolean);
  const rootRevisionError = validateRevision(
    request.expectedRootRevision,
    'expectedRootRevision',
    false,
  );

  if (rootRevisionError !== null) {
    errors.push(rootRevisionError);
  }

  return {
    value: {
      username: normalizeUsername(request.username),
      displayName: normalizeText(request.displayName),
      role,
      memberId:
        role === 'MEMBER'
          ? normalizeText(request.memberId)
          : null,
      active,
    },
    options:
      request.expectedRootRevision === undefined
        ? {}
        : {
            expectedRootRevision:
              request.expectedRootRevision,
          },
    errors,
  };
}

function normalizeUpdateUserRequest(request, current) {
  if (!isPlainObject(request) || !isJsonCompatible(request)) {
    return {
      changes: null,
      options: {},
      errors: [
        createFieldError(
          '$',
          'INVALID_REQUEST',
          'User update request must be a safe object.',
        ),
      ],
    };
  }

  const allowedFields = new Set([
    ...USER_UPDATE_FIELDS,
    'expectedRevision',
    'expectedRootRevision',
  ]);
  const changes = {};
  const errors = collectUnknownFieldErrors(request, allowedFields);

  USER_UPDATE_FIELDS.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(request, field)) {
      changes[field] = request[field];
    }
  });

  if (Object.keys(changes).length === 0) {
    errors.push(
      createFieldError(
        '$',
        'EMPTY_UPDATE',
        'At least one editable user field is required.',
      ),
    );
  }

  if (changes.username !== undefined) {
    const error = validateUsername(changes.username);

    if (error !== null) {
      errors.push(error);
    } else {
      changes.username = normalizeUsername(changes.username);
    }
  }

  if (changes.displayName !== undefined) {
    const error = validateDisplayName(changes.displayName);

    if (error !== null) {
      errors.push(error);
    } else {
      changes.displayName = normalizeText(changes.displayName);
    }
  }

  if (changes.role !== undefined) {
    const error = validateRole(changes.role);

    if (error !== null) {
      errors.push(error);
    } else {
      changes.role = normalizeRole(changes.role);
    }
  }

  if (changes.active !== undefined) {
    const error = validateActive(changes.active);

    if (error !== null) {
      errors.push(error);
    }
  }

  const resultingRole = changes.role ?? current.role;
  const resultingMemberId =
    Object.prototype.hasOwnProperty.call(changes, 'memberId')
      ? changes.memberId
      : current.memberId;
  const memberIdError = validateMemberId(
    resultingMemberId,
    resultingRole,
  );

  if (memberIdError !== null) {
    errors.push(memberIdError);
  } else if (
    Object.prototype.hasOwnProperty.call(changes, 'memberId')
  ) {
    changes.memberId =
      resultingRole === 'MEMBER'
        ? normalizeText(changes.memberId)
        : null;
  } else if (
    changes.role !== undefined &&
    changes.role !== 'MEMBER'
  ) {
    changes.memberId = null;
  }

  const revisionError = validateRevision(
    request.expectedRevision,
    'expectedRevision',
  );

  if (revisionError !== null) {
    errors.push(revisionError);
  }

  const rootRevisionError = validateRevision(
    request.expectedRootRevision,
    'expectedRootRevision',
    false,
  );

  if (rootRevisionError !== null) {
    errors.push(rootRevisionError);
  }

  return {
    changes,
    options: {
      expectedRevision: request.expectedRevision,
      ...(request.expectedRootRevision === undefined
        ? {}
        : {
            expectedRootRevision:
              request.expectedRootRevision,
          }),
    },
    errors,
  };
}

function normalizeDeleteUserRequest(request, username) {
  if (!isPlainObject(request) || !isJsonCompatible(request)) {
    return {
      options: {},
      errors: [
        createFieldError(
          '$',
          'INVALID_REQUEST',
          'User removal request must be a safe object.',
        ),
      ],
    };
  }

  const allowedFields = new Set([
    'expectedRevision',
    'expectedRootRevision',
    'confirmation',
  ]);
  const errors = collectUnknownFieldErrors(request, allowedFields);
  const expectedConfirmation =
    `${ADMIN_DELETE_CONFIRMATION_PREFIX} ${username}`;

  if (request.confirmation !== expectedConfirmation) {
    errors.push(
      createFieldError(
        'confirmation',
        'CONFIRMATION_REQUIRED',
        `User removal requires confirmation "${expectedConfirmation}".`,
      ),
    );
  }

  const revisionError = validateRevision(
    request.expectedRevision,
    'expectedRevision',
  );

  if (revisionError !== null) {
    errors.push(revisionError);
  }

  const rootRevisionError = validateRevision(
    request.expectedRootRevision,
    'expectedRootRevision',
    false,
  );

  if (rootRevisionError !== null) {
    errors.push(rootRevisionError);
  }

  return {
    options: {
      expectedRevision: request.expectedRevision,
      ...(request.expectedRootRevision === undefined
        ? {}
        : {
            expectedRootRevision:
              request.expectedRootRevision,
          }),
    },
    errors,
  };
}

function hasAtMostTwoDecimalPlaces(value) {
  return Number.isInteger(Math.round(value * 100));
}

function validateSettingsChanges(changes) {
  if (!isPlainObject(changes) || !isJsonCompatible(changes)) {
    return [
      createFieldError(
        'changes',
        'INVALID_REQUEST',
        'Settings changes must be a safe object.',
      ),
    ];
  }

  const errors = collectUnknownFieldErrors(
    changes,
    SETTINGS_UPDATE_FIELDS,
  );

  if (Object.keys(changes).length === 0) {
    errors.push(
      createFieldError(
        'changes',
        'EMPTY_UPDATE',
        'At least one editable settings field is required.',
      ),
    );
  }

  if (
    changes.retentionYears !== undefined &&
    (!Number.isInteger(changes.retentionYears) ||
      changes.retentionYears <
        ADMIN_SETTINGS_LIMITS.RETENTION_YEARS_MINIMUM ||
      changes.retentionYears >
        ADMIN_SETTINGS_LIMITS.RETENTION_YEARS_MAXIMUM)
  ) {
    errors.push(
      createFieldError(
        'changes.retentionYears',
        'OUT_OF_RANGE',
        'Retention years must be an integer between 1 and 10.',
      ),
    );
  }

  if (
    changes.autoApproveAmount !== undefined &&
    (typeof changes.autoApproveAmount !== 'number' ||
      !Number.isFinite(changes.autoApproveAmount) ||
      changes.autoApproveAmount <
        ADMIN_SETTINGS_LIMITS.AUTO_APPROVE_AMOUNT_MINIMUM ||
      changes.autoApproveAmount >
        ADMIN_SETTINGS_LIMITS.AUTO_APPROVE_AMOUNT_MAXIMUM ||
      !hasAtMostTwoDecimalPlaces(
        changes.autoApproveAmount,
      ))
  ) {
    errors.push(
      createFieldError(
        'changes.autoApproveAmount',
        'OUT_OF_RANGE',
        'Auto-approve amount must be between 0 and 10000 with at most two decimal places.',
      ),
    );
  }

  if (
    changes.sessionTimeoutMinutes !== undefined &&
    (!Number.isInteger(changes.sessionTimeoutMinutes) ||
      changes.sessionTimeoutMinutes <
        ADMIN_SETTINGS_LIMITS.SESSION_TIMEOUT_MINUTES_MINIMUM ||
      changes.sessionTimeoutMinutes >
        ADMIN_SETTINGS_LIMITS.SESSION_TIMEOUT_MINUTES_MAXIMUM)
  ) {
    errors.push(
      createFieldError(
        'changes.sessionTimeoutMinutes',
        'OUT_OF_RANGE',
        'Session timeout must be an integer between 2 and 240 minutes.',
      ),
    );
  }

  return errors;
}

function normalizeSettingsUpdateRequest(request) {
  if (!isPlainObject(request) || !isJsonCompatible(request)) {
    return {
      changes: null,
      options: {},
      errors: [
        createFieldError(
          '$',
          'INVALID_REQUEST',
          'Settings update request must be a safe object.',
        ),
      ],
    };
  }

  const changes = isPlainObject(request.changes)
    ? request.changes
    : Object.fromEntries(
        Object.entries(request).filter(([field]) =>
          SETTINGS_UPDATE_FIELDS.has(field),
        ),
      );
  const wrapperFields = new Set([
    'changes',
    'expectedRevision',
    'expectedRootRevision',
    ...SETTINGS_UPDATE_FIELDS,
  ]);
  const errors = [
    ...collectUnknownFieldErrors(request, wrapperFields),
    ...validateSettingsChanges(changes),
  ];
  const revisionError = validateRevision(
    request.expectedRevision,
    'expectedRevision',
  );

  if (revisionError !== null) {
    errors.push(revisionError);
  }

  const rootRevisionError = validateRevision(
    request.expectedRootRevision,
    'expectedRootRevision',
    false,
  );

  if (rootRevisionError !== null) {
    errors.push(rootRevisionError);
  }

  return {
    changes,
    options: {
      expectedRevision: request.expectedRevision,
      ...(request.expectedRootRevision === undefined
        ? {}
        : {
            expectedRootRevision:
              request.expectedRootRevision,
          }),
    },
    errors,
  };
}

function normalizeRestoreRequest(request) {
  if (!isPlainObject(request) || !isJsonCompatible(request)) {
    return {
      options: {},
      errors: [
        createFieldError(
          '$',
          'INVALID_REQUEST',
          'Settings restore request must be a safe object.',
        ),
      ],
    };
  }

  const allowedFields = new Set([
    'expectedRevision',
    'expectedRootRevision',
    'confirmation',
  ]);
  const errors = collectUnknownFieldErrors(request, allowedFields);

  if (request.confirmation !== 'RESTORE DEFAULT SETTINGS') {
    errors.push(
      createFieldError(
        'confirmation',
        'CONFIRMATION_REQUIRED',
        'Settings restore requires confirmation "RESTORE DEFAULT SETTINGS".',
      ),
    );
  }

  const revisionError = validateRevision(
    request.expectedRevision,
    'expectedRevision',
  );

  if (revisionError !== null) {
    errors.push(revisionError);
  }

  const rootRevisionError = validateRevision(
    request.expectedRootRevision,
    'expectedRootRevision',
    false,
  );

  if (rootRevisionError !== null) {
    errors.push(rootRevisionError);
  }

  return {
    options: {
      expectedRevision: request.expectedRevision,
      ...(request.expectedRootRevision === undefined
        ? {}
        : {
            expectedRootRevision:
              request.expectedRootRevision,
          }),
    },
    errors,
  };
}

function selectUserAuditValue(user) {
  if (!isPlainObject(user)) {
    return null;
  }

  return {
    userId: user.userId,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    memberId: user.memberId ?? null,
    active: user.active,
    systemSeed: user.systemSeed,
    revision: user.revision,
  };
}

function selectSettingsAuditValue(settings) {
  if (!isPlainObject(settings)) {
    return null;
  }

  return {
    retentionYears: settings.retentionYears,
    autoApproveAmount: settings.autoApproveAmount,
    sessionTimeoutMinutes: settings.sessionTimeoutMinutes,
    revision: settings.revision,
  };
}

function readUser(repository, userId) {
  return typeof repository.getById === 'function'
    ? repository.getById(userId)
    : repository.findById(userId);
}

function createUser(repository, value, options) {
  return typeof repository.create === 'function'
    ? repository.create(value, options)
    : repository.createUser(value, options);
}

function updateUser(repository, userId, changes, options) {
  return typeof repository.update === 'function'
    ? repository.update(userId, changes, options)
    : repository.updateUser(userId, changes, options);
}

function deleteUser(repository, userId, options) {
  return typeof repository.delete === 'function'
    ? repository.delete(userId, options)
    : repository.deleteUser(userId, options);
}

function queryUsers(repository, query) {
  return typeof repository.query === 'function'
    ? repository.query(query)
    : repository.list(query);
}

function readSettings(repository) {
  return typeof repository.get === 'function'
    ? repository.get()
    : repository.getSettings();
}

function updateSettings(repository, changes, options) {
  return typeof repository.update === 'function'
    ? repository.update(changes, options)
    : repository.updateSettings(changes, options);
}

function restoreSettings(repository, defaults, options) {
  if (typeof repository.restore === 'function') {
    return repository.restore(defaults, options);
  }

  if (typeof repository.restoreDefaults === 'function') {
    return repository.restoreDefaults(defaults, options);
  }

  return repository.reset(defaults, options);
}

/**
 * Error raised when administration facade configuration is invalid.
 */
export class AdminFacadeError extends Error {
  /**
   * @param {string} code Stable facade error code.
   * @param {string} message Human-readable error message.
   * @param {unknown} [details] Optional structured details.
   * @param {unknown} [cause] Original error.
   */
  constructor(code, message, details, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'AdminFacadeError';
    this.code = code;

    if (details !== undefined) {
      this.details = deepFreeze(details);
    }
  }
}

/**
 * Capability-enforced facade for fictional local users and settings.
 */
export class AdminFacade {
  /**
   * @param {object|Record<string, unknown>} userRepositoryOrOptions User
   * repository or options containing all facade dependencies.
   * @param {{
   *   settingsRepository?: object,
   *   permissionService?: object,
   *   auditService?: object,
   *   sessionProvider?: object|Function,
   *   authFacade?: object,
   *   defaultSettings?: Record<string, unknown>,
   *   idGenerator?: () => string
   * }} [options] Facade options.
   */
  constructor(userRepositoryOrOptions, options = {}) {
    const resolved = resolveConstructorArguments(
      userRepositoryOrOptions,
      options,
    );
    const normalizedOptions = resolved.options;

    this.userRepository = requireDependency(
      resolved.userRepository,
      isUserRepository,
      'Admin facade requires a user repository with CRUD and query operations.',
    );
    this.settingsRepository = requireDependency(
      normalizedOptions.settingsRepository ??
        normalizedOptions.settings,
      isSettingsRepository,
      'Admin facade requires a settings repository with read, update, and restore operations.',
    );
    this.permissionService = requireDependency(
      normalizedOptions.permissionService,
      isPermissionService,
      'Admin facade requires a permission service with evaluate().',
    );
    this.auditService = requireDependency(
      normalizedOptions.auditService,
      isAuditService,
      'Admin facade requires an audit service with append().',
    );
    this.sessionProvider = requireDependency(
      normalizedOptions.sessionProvider ??
        normalizedOptions.authFacade ??
        this.permissionService.sessionProvider,
      isSessionProvider,
      'Admin facade requires a session provider.',
    );
    this.defaultSettings =
      normalizedOptions.defaultSettings ?? null;
    this.idGenerator =
      normalizedOptions.idGenerator ?? generateUuid;

    if (
      this.defaultSettings !== null &&
      (!isPlainObject(this.defaultSettings) ||
        !isJsonCompatible(this.defaultSettings))
    ) {
      throw new AdminFacadeError(
        ADMIN_FACADE_ERROR_CODES.INVALID_DEPENDENCY,
        'Admin facade default settings must be safe JSON-compatible data.',
      );
    }

    if (typeof this.idGenerator !== 'function') {
      throw new TypeError(
        'Admin facade ID generator must be a function.',
      );
    }
  }

  getSession() {
    return normalizeSession(readSession(this.sessionProvider));
  }

  async authorize(action, resource, correlationId) {
    let decision;

    try {
      decision = normalizePermissionDecision(
        await this.permissionService.evaluate({
          action,
          resource,
          session: this.getSession(),
        }),
      );
    } catch (error) {
      return {
        allowed: false,
        failure: createFailure(
          500,
          ADMIN_FACADE_ERROR_CODES.INVALID_DEPENDENCY,
          'Administration permission evaluation could not be completed.',
          correlationId,
          {
            details: {
              dependencyCode: getErrorCode(error),
            },
          },
        ),
      };
    }

    if (decision?.allowed === true) {
      return {
        allowed: true,
        decision,
      };
    }

    return {
      allowed: false,
      failure: createAuthorizationFailure(
        decision,
        action,
        correlationId,
      ),
    };
  }

  async appendAudit({
    correlationId,
    action,
    entity,
    before,
    after,
  }) {
    const session = this.getSession();

    if (session === null) {
      throw new AdminFacadeError(
        ADMIN_FACADE_ERROR_CODES.AUDIT_FAILED,
        'An active session is required to record the administration audit.',
      );
    }

    try {
      return await this.auditService.append(
        {
          correlationId,
          actor: {
            userId: session.userId,
            displayName: session.displayName,
            role: session.role,
          },
          action,
          entity,
        },
        {
          action,
          entity,
          before,
          after,
          outcome: 'SUCCESS',
        },
      );
    } catch (error) {
      throw new AdminFacadeError(
        ADMIN_FACADE_ERROR_CODES.AUDIT_FAILED,
        'The administration audit event could not be stored.',
        {
          dependencyCode: getErrorCode(error),
        },
        error,
      );
    }
  }

  /**
   * Creates a fictional browser-local user.
   *
   * @param {Record<string, unknown>} request Creation request.
   * @returns {Promise<Readonly<Record<string, unknown>>>} Facade result.
   */
  async createUser(request) {
    const correlationId = createCorrelationId(this.idGenerator);
    const authorization = await this.authorize(
      ACTIONS.USER_CREATE,
      { type: 'USER_COLLECTION', id: 'users' },
      correlationId,
    );

    if (!authorization.allowed) {
      return authorization.failure;
    }

    const normalized = normalizeCreateUserRequest(request);

    if (normalized.errors.length > 0) {
      return createFailure(
        422,
        ADMIN_FACADE_ERROR_CODES.VALIDATION_ERROR,
        'User creation request validation failed.',
        correlationId,
        { fieldErrors: normalized.errors },
      );
    }

    let user;

    try {
      user = createUser(
        this.userRepository,
        normalized.value,
        normalized.options,
      );
    } catch (error) {
      return normalizeOperationFailure(
        error,
        ADMIN_FACADE_ERROR_CODES.USER_CREATE_FAILED,
        'The fictional user could not be created.',
        correlationId,
      );
    }

    try {
      await this.appendAudit({
        correlationId,
        action: ADMIN_AUDIT_ACTIONS.USER_CREATED,
        entity: {
          type: 'USER',
          id: user.userId,
        },
        before: null,
        after: selectUserAuditValue(user),
      });
    } catch (error) {
      return normalizeOperationFailure(
        error,
        ADMIN_FACADE_ERROR_CODES.AUDIT_FAILED,
        'The fictional user was created, but its audit event could not be stored.',
        correlationId,
      );
    }

    return createSuccess(
      201,
      { user },
      correlationId,
    );
  }

  /**
   * Updates editable fields on a fictional local user.
   *
   * @param {string} userId User identifier.
   * @param {Record<string, unknown>} request Update request.
   * @returns {Promise<Readonly<Record<string, unknown>>>} Facade result.
   */
  async updateUser(userId, request) {
    const correlationId = createCorrelationId(this.idGenerator);
    const identifier = normalizeText(userId);

    if (
      typeof identifier !== 'string' ||
      identifier.length === 0 ||
      identifier.length > 200
    ) {
      return createFailure(
        422,
        ADMIN_FACADE_ERROR_CODES.VALIDATION_ERROR,
        'User update request validation failed.',
        correlationId,
        {
          fieldErrors: [
            createFieldError(
              'userId',
              'INVALID_IDENTIFIER',
              'User ID must be a non-empty string of at most 200 characters.',
            ),
          ],
        },
      );
    }

    const authorization = await this.authorize(
      ACTIONS.USER_UPDATE,
      { type: 'USER', id: identifier },
      correlationId,
    );

    if (!authorization.allowed) {
      return authorization.failure;
    }

    let current;

    try {
      current = readUser(this.userRepository, identifier);
    } catch (error) {
      return normalizeOperationFailure(
        error,
        ADMIN_FACADE_ERROR_CODES.USER_UPDATE_FAILED,
        'The fictional user could not be read.',
        correlationId,
      );
    }

    if (current === null) {
      return createFailure(
        404,
        ADMIN_FACADE_ERROR_CODES.USER_NOT_FOUND,
        'The requested fictional user was not found.',
        correlationId,
      );
    }

    const normalized = normalizeUpdateUserRequest(
      request,
      current,
    );

    if (normalized.errors.length > 0) {
      return createFailure(
        422,
        ADMIN_FACADE_ERROR_CODES.VALIDATION_ERROR,
        'User update request validation failed.',
        correlationId,
        { fieldErrors: normalized.errors },
      );
    }

    let user;

    try {
      user = updateUser(
        this.userRepository,
        identifier,
        normalized.changes,
        normalized.options,
      );
    } catch (error) {
      return normalizeOperationFailure(
        error,
        ADMIN_FACADE_ERROR_CODES.USER_UPDATE_FAILED,
        'The fictional user could not be updated.',
        correlationId,
      );
    }

    try {
      await this.appendAudit({
        correlationId,
        action: ADMIN_AUDIT_ACTIONS.USER_UPDATED,
        entity: {
          type: 'USER',
          id: identifier,
        },
        before: selectUserAuditValue(current),
        after: selectUserAuditValue(user),
      });
    } catch (error) {
      return normalizeOperationFailure(
        error,
        ADMIN_FACADE_ERROR_CODES.AUDIT_FAILED,
        'The fictional user was updated, but its audit event could not be stored.',
        correlationId,
      );
    }

    return createSuccess(
      200,
      { user },
      correlationId,
    );
  }

  /**
   * Removes a non-seeded fictional local user.
   *
   * @param {string} userId User identifier.
   * @param {Record<string, unknown>} request Removal request.
   * @returns {Promise<Readonly<Record<string, unknown>>>} Facade result.
   */
  async deleteUser(userId, request) {
    const correlationId = createCorrelationId(this.idGenerator);
    const identifier = normalizeText(userId);

    if (
      typeof identifier !== 'string' ||
      identifier.length === 0 ||
      identifier.length > 200
    ) {
      return createFailure(
        422,
        ADMIN_FACADE_ERROR_CODES.VALIDATION_ERROR,
        'User removal request validation failed.',
        correlationId,
        {
          fieldErrors: [
            createFieldError(
              'userId',
              'INVALID_IDENTIFIER',
              'User ID must be a non-empty string of at most 200 characters.',
            ),
          ],
        },
      );
    }

    const authorization = await this.authorize(
      ACTIONS.USER_DELETE,
      { type: 'USER', id: identifier },
      correlationId,
    );

    if (!authorization.allowed) {
      return authorization.failure;
    }

    let current;

    try {
      current = readUser(this.userRepository, identifier);
    } catch (error) {
      return normalizeOperationFailure(
        error,
        ADMIN_FACADE_ERROR_CODES.USER_DELETE_FAILED,
        'The fictional user could not be read.',
        correlationId,
      );
    }

    if (current === null) {
      return createFailure(
        404,
        ADMIN_FACADE_ERROR_CODES.USER_NOT_FOUND,
        'The requested fictional user was not found.',
        correlationId,
      );
    }

    const session = this.getSession();

    if (session?.userId === identifier) {
      return createFailure(
        409,
        ADMIN_FACADE_ERROR_CODES.SELF_DELETE_BLOCKED,
        'The active fictional user cannot remove their own account.',
        correlationId,
      );
    }

    if (current.systemSeed === true) {
      return createFailure(
        409,
        ADMIN_FACADE_ERROR_CODES.SYSTEM_USER_PROTECTED,
        'Seeded fictional users cannot be removed.',
        correlationId,
      );
    }

    const normalized = normalizeDeleteUserRequest(
      request,
      current.username,
    );

    if (normalized.errors.length > 0) {
      return createFailure(
        422,
        ADMIN_FACADE_ERROR_CODES.VALIDATION_ERROR,
        'User removal request validation failed.',
        correlationId,
        { fieldErrors: normalized.errors },
      );
    }

    let deleted;

    try {
      deleted = deleteUser(
        this.userRepository,
        identifier,
        normalized.options,
      );
    } catch (error) {
      return normalizeOperationFailure(
        error,
        ADMIN_FACADE_ERROR_CODES.USER_DELETE_FAILED,
        'The fictional user could not be removed.',
        correlationId,
      );
    }

    try {
      await this.appendAudit({
        correlationId,
        action: ADMIN_AUDIT_ACTIONS.USER_DELETED,
        entity: {
          type: 'USER',
          id: identifier,
        },
        before: selectUserAuditValue(current),
        after: null,
      });
    } catch (error) {
      return normalizeOperationFailure(
        error,
        ADMIN_FACADE_ERROR_CODES.AUDIT_FAILED,
        'The fictional user was removed, but its audit event could not be stored.',
        correlationId,
      );
    }

    return createSuccess(
      200,
      {
        deletedUserId:
          deleted?.deletedUserId ?? identifier,
        deletedRevision:
          deleted?.deletedRevision ?? current.revision,
      },
      correlationId,
    );
  }

  /**
   * Returns a filtered page of fictional local users.
   *
   * @param {Record<string, unknown>} [query] User query.
   * @returns {Promise<Readonly<Record<string, unknown>>>} Facade result.
   */
  async listUsers(query = {}) {
    const correlationId = createCorrelationId(this.idGenerator);
    const authorization = await this.authorize(
      ACTIONS.USER_LIST,
      { type: 'USER_COLLECTION', id: 'users' },
      correlationId,
    );

    if (!authorization.allowed) {
      return authorization.failure;
    }

    if (!isPlainObject(query) || !isJsonCompatible(query)) {
      return createFailure(
        400,
        ADMIN_FACADE_ERROR_CODES.INVALID_REQUEST,
        'User query must be a safe object.',
        correlationId,
      );
    }

    try {
      const result = queryUsers(this.userRepository, query);

      return createSuccess(
        200,
        {
          ...result,
          users: result.items,
        },
        correlationId,
      );
    } catch (error) {
      return normalizeOperationFailure(
        error,
        ADMIN_FACADE_ERROR_CODES.USER_LIST_FAILED,
        'Fictional users could not be listed.',
        correlationId,
      );
    }
  }

  /**
   * Updates editable local demonstration settings.
   *
   * @param {Record<string, unknown>} request Settings update request.
   * @returns {Promise<Readonly<Record<string, unknown>>>} Facade result.
   */
  async updateSettings(request) {
    const correlationId = createCorrelationId(this.idGenerator);
    const authorization = await this.authorize(
      ACTIONS.SETTINGS_UPDATE,
      { type: 'SETTINGS', id: 'global' },
      correlationId,
    );

    if (!authorization.allowed) {
      return authorization.failure;
    }

    const normalized = normalizeSettingsUpdateRequest(request);

    if (normalized.errors.length > 0) {
      return createFailure(
        422,
        ADMIN_FACADE_ERROR_CODES.VALIDATION_ERROR,
        'Settings update request validation failed.',
        correlationId,
        { fieldErrors: normalized.errors },
      );
    }

    const session = this.getSession();
    let current;

    try {
      current = readSettings(this.settingsRepository);
    } catch (error) {
      return normalizeOperationFailure(
        error,
        ADMIN_FACADE_ERROR_CODES.SETTINGS_UPDATE_FAILED,
        'Local demonstration settings could not be read.',
        correlationId,
      );
    }

    if (current === null) {
      return createFailure(
        404,
        ADMIN_FACADE_ERROR_CODES.SETTINGS_NOT_FOUND,
        'Local demonstration settings were not found.',
        correlationId,
      );
    }

    let settings;

    try {
      settings = updateSettings(
        this.settingsRepository,
        normalized.changes,
        {
          ...normalized.options,
          updatedBy: session?.userId ?? 'system',
          actorRole: session?.role,
        },
      );
    } catch (error) {
      return normalizeOperationFailure(
        error,
        ADMIN_FACADE_ERROR_CODES.SETTINGS_UPDATE_FAILED,
        'Local demonstration settings could not be updated.',
        correlationId,
      );
    }

    try {
      await this.appendAudit({
        correlationId,
        action: ADMIN_AUDIT_ACTIONS.SETTINGS_UPDATED,
        entity: {
          type: 'SETTINGS',
          id: 'global',
        },
        before: selectSettingsAuditValue(current),
        after: selectSettingsAuditValue(settings),
      });
    } catch (error) {
      return normalizeOperationFailure(
        error,
        ADMIN_FACADE_ERROR_CODES.AUDIT_FAILED,
        'Settings were updated, but the audit event could not be stored.',
        correlationId,
      );
    }

    return createSuccess(
      200,
      { settings },
      correlationId,
    );
  }

  /**
   * Restores configured demonstration settings defaults.
   *
   * @param {Record<string, unknown>} request Restore request.
   * @returns {Promise<Readonly<Record<string, unknown>>>} Facade result.
   */
  async restoreSettings(request) {
    const correlationId = createCorrelationId(this.idGenerator);
    const authorization = await this.authorize(
      ACTIONS.SETTINGS_RESTORE,
      { type: 'SETTINGS', id: 'global' },
      correlationId,
    );

    if (!authorization.allowed) {
      return authorization.failure;
    }

    const normalized = normalizeRestoreRequest(request);

    if (normalized.errors.length > 0) {
      return createFailure(
        422,
        ADMIN_FACADE_ERROR_CODES.VALIDATION_ERROR,
        'Settings restore request validation failed.',
        correlationId,
        { fieldErrors: normalized.errors },
      );
    }

    if (this.defaultSettings === null) {
      return createFailure(
        500,
        ADMIN_FACADE_ERROR_CODES.INVALID_DEPENDENCY,
        'Default demonstration settings are unavailable.',
        correlationId,
      );
    }

    const session = this.getSession();
    let current;

    try {
      current = readSettings(this.settingsRepository);
    } catch (error) {
      return normalizeOperationFailure(
        error,
        ADMIN_FACADE_ERROR_CODES.SETTINGS_RESTORE_FAILED,
        'Local demonstration settings could not be read.',
        correlationId,
      );
    }

    if (current === null) {
      return createFailure(
        404,
        ADMIN_FACADE_ERROR_CODES.SETTINGS_NOT_FOUND,
        'Local demonstration settings were not found.',
        correlationId,
      );
    }

    let settings;

    try {
      settings = restoreSettings(
        this.settingsRepository,
        this.defaultSettings,
        {
          ...normalized.options,
          updatedBy: session?.userId ?? 'system',
          actorRole: session?.role,
        },
      );
    } catch (error) {
      return normalizeOperationFailure(
        error,
        ADMIN_FACADE_ERROR_CODES.SETTINGS_RESTORE_FAILED,
        'Default demonstration settings could not be restored.',
        correlationId,
      );
    }

    try {
      await this.appendAudit({
        correlationId,
        action: ADMIN_AUDIT_ACTIONS.SETTINGS_RESTORED,
        entity: {
          type: 'SETTINGS',
          id: 'global',
        },
        before: selectSettingsAuditValue(current),
        after: selectSettingsAuditValue(settings),
      });
    } catch (error) {
      return normalizeOperationFailure(
        error,
        ADMIN_FACADE_ERROR_CODES.AUDIT_FAILED,
        'Settings were restored, but the audit event could not be stored.',
        correlationId,
      );
    }

    return createSuccess(
      200,
      { settings },
      correlationId,
    );
  }

  create(request) {
    return this.createUser(request);
  }

  update(userId, request) {
    return this.updateUser(userId, request);
  }

  remove(userId, request) {
    return this.deleteUser(userId, request);
  }

  list(query = {}) {
    return this.listUsers(query);
  }

  updatePlatformSettings(request) {
    return this.updateSettings(request);
  }

  restoreDefaultSettings(request) {
    return this.restoreSettings(request);
  }
}

/**
 * Creates a local fictional administration facade.
 *
 * @param {ConstructorParameters<typeof AdminFacade>[0]}
 * userRepositoryOrOptions User repository or facade options.
 * @param {ConstructorParameters<typeof AdminFacade>[1]} [options]
 * Facade options.
 * @returns {AdminFacade} Administration facade.
 */
export function createAdminFacade(
  userRepositoryOrOptions,
  options = {},
) {
  return new AdminFacade(userRepositoryOrOptions, options);
}

export const LocalAdminFacade = AdminFacade;
export const PlatformAdminFacade = AdminFacade;
export const createLocalAdminFacade = createAdminFacade;
export const createPlatformAdminFacade = createAdminFacade;

export default AdminFacade;