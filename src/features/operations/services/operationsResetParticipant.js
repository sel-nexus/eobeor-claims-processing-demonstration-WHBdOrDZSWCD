import {
  createOperationsEnvelope,
  isOperationsEnvelope,
} from '../domain/operationsSchemas.js';
import {
  CURRENT_OPERATIONS_SCHEMA_VERSION,
  migrateOperationsEnvelope,
} from '../repositories/operationsMigrations.js';
import { registerParticipant } from '../../../platform/services/snapshotParticipantRegistry.js';
import {
  isJsonCompatible,
  isPlainObject,
} from '../../../platform/validation/schemas.js';

export const OPERATIONS_RESET_PARTICIPANT_ID = 'operations';

const OPERATIONS_SNAPSHOT_ERROR_CODES = Object.freeze({
  INVALID_SNAPSHOT: 'INVALID_OPERATIONS_SNAPSHOT',
  INVALID_ENVELOPE: 'INVALID_OPERATIONS_ENVELOPE',
  INVALID_REFERENCE: 'INVALID_OPERATIONS_REFERENCE',
  REPOSITORY_UNAVAILABLE: 'OPERATIONS_REPOSITORY_UNAVAILABLE',
});

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

function hasOwn(value, property) {
  return (
    isPlainObject(value) &&
    Object.prototype.hasOwnProperty.call(value, property)
  );
}

function isSnapshotContainer(value) {
  return (
    isPlainObject(value) &&
    (hasOwn(value, 'slices') ||
      hasOwn(value, 'data') ||
      hasOwn(value, 'formatVersion') ||
      hasOwn(value, 'notice'))
  );
}

function resolveOperationsValue(value) {
  if (!isPlainObject(value)) {
    return {
      declared: value !== null && value !== undefined,
      path: '$',
      value,
    };
  }

  if (
    value.participantId === OPERATIONS_RESET_PARTICIPANT_ID &&
    typeof value.present === 'boolean'
  ) {
    return {
      declared: value.present,
      path: value.path ?? '$',
      value: value.envelope ?? null,
    };
  }

  const slices = isPlainObject(value.slices)
    ? value.slices
    : isPlainObject(value.data)
      ? value.data
      : null;

  if (slices !== null) {
    if (hasOwn(slices, 'operationsEnvelope')) {
      return {
        declared: true,
        path: 'slices.operationsEnvelope',
        value: slices.operationsEnvelope,
      };
    }

    if (hasOwn(slices, 'operations')) {
      const operations = slices.operations;

      return {
        declared: true,
        path: 'slices.operations',
        value:
          isPlainObject(operations) &&
          hasOwn(operations, 'initialEnvelope')
            ? operations.initialEnvelope
            : operations,
      };
    }

    return {
      declared: false,
      path: 'slices.operationsEnvelope',
      value: null,
    };
  }

  if (hasOwn(value, 'operationsEnvelope')) {
    return {
      declared: true,
      path: 'operationsEnvelope',
      value: value.operationsEnvelope,
    };
  }

  if (hasOwn(value, 'operations')) {
    const operations = value.operations;

    return {
      declared: true,
      path: 'operations',
      value:
        isPlainObject(operations) &&
        hasOwn(operations, 'initialEnvelope')
          ? operations.initialEnvelope
          : operations,
    };
  }

  if (isSnapshotContainer(value)) {
    return {
      declared: false,
      path: 'slices.operationsEnvelope',
      value: null,
    };
  }

  return {
    declared: true,
    path: '$',
    value,
  };
}

function createIssue(code, message, path, details) {
  return deepFreeze({
    code,
    message,
    path,
    ...(details === undefined ? {} : { details }),
  });
}

function collectReferenceIssues(envelope, path) {
  const issues = [];
  const requestIds = new Set(Object.keys(envelope.requests));
  const documentIds = new Set(Object.keys(envelope.documents));
  const errorReportIds = new Set(
    Object.keys(envelope.errorReports),
  );

  Object.entries(envelope.pipelineRuns).forEach(([runId, run]) => {
    if (!requestIds.has(run.requestId)) {
      issues.push(
        createIssue(
          OPERATIONS_SNAPSHOT_ERROR_CODES.INVALID_REFERENCE,
          'Pipeline run references an unknown request.',
          `${path}.pipelineRuns.${runId}.requestId`,
          { requestId: run.requestId },
        ),
      );
    }
  });

  Object.entries(envelope.documents).forEach(
    ([documentId, document]) => {
      if (!requestIds.has(document.requestId)) {
        issues.push(
          createIssue(
            OPERATIONS_SNAPSHOT_ERROR_CODES.INVALID_REFERENCE,
            'Document references an unknown request.',
            `${path}.documents.${documentId}.requestId`,
            { requestId: document.requestId },
          ),
        );
      }
    },
  );

  Object.entries(envelope.reviews).forEach(
    ([reviewId, review]) => {
      if (!requestIds.has(review.requestId)) {
        issues.push(
          createIssue(
            OPERATIONS_SNAPSHOT_ERROR_CODES.INVALID_REFERENCE,
            'Manual review references an unknown request.',
            `${path}.reviews.${reviewId}.requestId`,
            { requestId: review.requestId },
          ),
        );
      }
    },
  );

  Object.entries(envelope.errorReports).forEach(
    ([errorReportId, report]) => {
      if (
        report.requestId !== null &&
        !requestIds.has(report.requestId)
      ) {
        issues.push(
          createIssue(
            OPERATIONS_SNAPSHOT_ERROR_CODES.INVALID_REFERENCE,
            'Error report references an unknown request.',
            `${path}.errorReports.${errorReportId}.requestId`,
            { requestId: report.requestId },
          ),
        );
      }
    },
  );

  Object.entries(envelope.outboundRecords).forEach(
    ([outboundId, record]) => {
      if (!documentIds.has(record.documentId)) {
        issues.push(
          createIssue(
            OPERATIONS_SNAPSHOT_ERROR_CODES.INVALID_REFERENCE,
            'Outbound record references an unknown document.',
            `${path}.outboundRecords.${outboundId}.documentId`,
            { documentId: record.documentId },
          ),
        );
      }
    },
  );

  Object.entries(envelope.requests).forEach(
    ([requestId, request]) => {
      request.documentReferences.forEach((documentId) => {
        if (!documentIds.has(documentId)) {
          issues.push(
            createIssue(
              OPERATIONS_SNAPSHOT_ERROR_CODES.INVALID_REFERENCE,
              'Request references an unknown document.',
              `${path}.requests.${requestId}.documentReferences`,
              { documentId },
            ),
          );
        }
      });

      if (
        request.errorReportId !== null &&
        !errorReportIds.has(request.errorReportId)
      ) {
        issues.push(
          createIssue(
            OPERATIONS_SNAPSHOT_ERROR_CODES.INVALID_REFERENCE,
            'Request references an unknown error report.',
            `${path}.requests.${requestId}.errorReportId`,
            { errorReportId: request.errorReportId },
          ),
        );
      }
    },
  );

  return issues;
}

function resolveRepository(context) {
  if (!isPlainObject(context)) {
    return null;
  }

  return (
    context.operationsRepository ??
    context.repository ??
    context.repositories?.operations ??
    context.services?.operationsRepository ??
    null
  );
}

function isRepository(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    (typeof value.replace === 'function' ||
      typeof value.replaceAll === 'function' ||
      typeof value.commit === 'function')
  );
}

function getRepositoryRevision(repository) {
  if (typeof repository.getRevision === 'function') {
    return repository.getRevision();
  }

  const snapshot =
    typeof repository.getSnapshot === 'function'
      ? repository.getSnapshot()
      : typeof repository.read === 'function'
        ? repository.read()
        : typeof repository.load === 'function'
          ? repository.load()
          : null;

  if (
    snapshot !== null &&
    typeof snapshot === 'object' &&
    Number.isSafeInteger(snapshot.revision)
  ) {
    return snapshot.revision;
  }

  throw new TypeError(
    'Operations repository must expose its current revision.',
  );
}

function createMutationOptions(repository, context) {
  const expectedRevision =
    isPlainObject(context) &&
    Number.isSafeInteger(context.expectedOperationsRevision)
      ? context.expectedOperationsRevision
      : getRepositoryRevision(repository);
  const options = {
    expectedRevision,
  };

  if (
    isPlainObject(context) &&
    Number.isSafeInteger(context.expectedRootRevision)
  ) {
    options.expectedRootRevision = context.expectedRootRevision;
  }

  return options;
}

/**
 * Returns the operations persistence schema version.
 *
 * @returns {number} Current operations schema version.
 */
export function getOperationsSchemaVersion() {
  return CURRENT_OPERATIONS_SCHEMA_VERSION;
}

/**
 * Validates and normalizes an operations snapshot without mutating it.
 *
 * Snapshots without an operations slice are valid and produce null data so
 * other registered snapshot participants can restore independently.
 *
 * @param {unknown} snapshot Candidate snapshot or operations envelope.
 * @returns {Readonly<Record<string, unknown>>} Validation report.
 */
export function validateOperationsSnapshot(snapshot) {
  const resolved = resolveOperationsValue(snapshot);

  if (!resolved.declared) {
    return deepFreeze({
      participantId: OPERATIONS_RESET_PARTICIPANT_ID,
      valid: true,
      present: false,
      schemaVersion: getOperationsSchemaVersion(),
      errors: [],
      warnings: [],
      data: null,
    });
  }

  if (
    !isPlainObject(resolved.value) ||
    !isJsonCompatible(resolved.value)
  ) {
    return deepFreeze({
      participantId: OPERATIONS_RESET_PARTICIPANT_ID,
      valid: false,
      present: true,
      schemaVersion: getOperationsSchemaVersion(),
      errors: [
        createIssue(
          OPERATIONS_SNAPSHOT_ERROR_CODES.INVALID_SNAPSHOT,
          'Operations snapshot must be a safe JSON-compatible object.',
          resolved.path,
        ),
      ],
      warnings: [],
      data: null,
    });
  }

  let envelope;

  try {
    envelope = migrateOperationsEnvelope(resolved.value);
  } catch (error) {
    return deepFreeze({
      participantId: OPERATIONS_RESET_PARTICIPANT_ID,
      valid: false,
      present: true,
      schemaVersion: getOperationsSchemaVersion(),
      errors: [
        createIssue(
          OPERATIONS_SNAPSHOT_ERROR_CODES.INVALID_ENVELOPE,
          'Operations snapshot could not be migrated.',
          resolved.path,
          {
            migrationCode:
              error !== null && typeof error === 'object'
                ? error.code ?? null
                : null,
          },
        ),
      ],
      warnings: [],
      data: null,
    });
  }

  if (!isOperationsEnvelope(envelope)) {
    return deepFreeze({
      participantId: OPERATIONS_RESET_PARTICIPANT_ID,
      valid: false,
      present: true,
      schemaVersion: getOperationsSchemaVersion(),
      errors: [
        createIssue(
          OPERATIONS_SNAPSHOT_ERROR_CODES.INVALID_ENVELOPE,
          'Operations snapshot does not satisfy the current schema.',
          resolved.path,
        ),
      ],
      warnings: [],
      data: null,
    });
  }

  const errors = collectReferenceIssues(envelope, resolved.path);

  return deepFreeze({
    participantId: OPERATIONS_RESET_PARTICIPANT_ID,
    valid: errors.length === 0,
    present: true,
    schemaVersion: getOperationsSchemaVersion(),
    errors,
    warnings: [],
    data:
      errors.length === 0
        ? createOperationsEnvelope(envelope)
        : null,
  });
}

/**
 * Replaces persisted operations state with a validated snapshot.
 *
 * Supports `replaceOperationsSnapshot(snapshot, context)` and
 * `replaceOperationsSnapshot(repository, snapshot, context)`.
 *
 * @param {unknown} snapshotOrRepository Snapshot or operations repository.
 * @param {unknown} [contextOrSnapshot] Context or snapshot.
 * @param {Record<string, unknown>} [options] Replacement context.
 * @returns {unknown} Stored operations envelope, or null when absent.
 */
export function replaceOperationsSnapshot(
  snapshotOrRepository,
  contextOrSnapshot = {},
  options = {},
) {
  const repositoryFirst = isRepository(snapshotOrRepository);
  const snapshot = repositoryFirst
    ? contextOrSnapshot
    : snapshotOrRepository;
  const context = repositoryFirst
    ? {
        ...(isPlainObject(options) ? options : {}),
        operationsRepository: snapshotOrRepository,
      }
    : isPlainObject(contextOrSnapshot)
      ? contextOrSnapshot
      : {};
  const validation = validateOperationsSnapshot(snapshot);

  if (!validation.valid) {
    const error = new TypeError(
      'Operations snapshot does not satisfy the restore schema.',
    );

    error.code =
      OPERATIONS_SNAPSHOT_ERROR_CODES.INVALID_ENVELOPE;
    error.details = validation.errors;
    throw error;
  }

  if (!validation.present) {
    return null;
  }

  const repository = resolveRepository(context);

  if (!isRepository(repository)) {
    const error = new TypeError(
      'Operations snapshot replacement requires an operations repository.',
    );

    error.code =
      OPERATIONS_SNAPSHOT_ERROR_CODES.REPOSITORY_UNAVAILABLE;
    throw error;
  }

  const mutationOptions = createMutationOptions(
    repository,
    context,
  );

  if (typeof repository.replace === 'function') {
    return repository.replace(validation.data, mutationOptions);
  }

  if (typeof repository.replaceAll === 'function') {
    return repository.replaceAll(
      validation.data,
      mutationOptions,
    );
  }

  return repository.commit(
    mutationOptions.expectedRevision,
    validation.data,
    mutationOptions,
  );
}

export const operationsResetParticipant = Object.freeze({
  participantId: OPERATIONS_RESET_PARTICIPANT_ID,
  validateSnapshot: validateOperationsSnapshot,
  stageRestore(snapshot, _context, validation) {
    const report =
      isPlainObject(validation) &&
      validation.participantId ===
        OPERATIONS_RESET_PARTICIPANT_ID
        ? validation
        : validateOperationsSnapshot(snapshot);

    if (!report.valid) {
      const error = new TypeError(
        'Operations snapshot cannot be staged.',
      );

      error.code =
        OPERATIONS_SNAPSHOT_ERROR_CODES.INVALID_ENVELOPE;
      error.details = report.errors;
      throw error;
    }

    return deepFreeze({
      participantId: OPERATIONS_RESET_PARTICIPANT_ID,
      present: report.present === true,
      path: 'slices.operationsEnvelope',
      envelope: report.data,
    });
  },
  commitRestore(stagedSnapshot, context) {
    return replaceOperationsSnapshot(stagedSnapshot, context);
  },
});

export const unregisterOperationsResetParticipant =
  registerParticipant(operationsResetParticipant);

export default operationsResetParticipant;