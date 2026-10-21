import {
  isJsonCompatible,
  isPlainObject,
} from '../validation/schemas.js';

export const SNAPSHOT_PARTICIPANT_REGISTRY_SCHEMA_VERSION = 1;

export const SNAPSHOT_PARTICIPANT_REGISTRY_ERROR_CODES = Object.freeze({
  INVALID_PARTICIPANT: 'INVALID_PARTICIPANT',
  INVALID_PARTICIPANT_ID: 'INVALID_PARTICIPANT_ID',
  PARTICIPANT_ALREADY_REGISTERED: 'PARTICIPANT_ALREADY_REGISTERED',
  PARTICIPANT_NOT_REGISTERED: 'PARTICIPANT_NOT_REGISTERED',
  INVALID_SNAPSHOT: 'INVALID_SNAPSHOT',
  INVALID_CONTEXT: 'INVALID_CONTEXT',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  STAGING_FAILED: 'STAGING_FAILED',
  INVALID_STAGE: 'INVALID_STAGE',
  STAGE_ALREADY_COMMITTED: 'STAGE_ALREADY_COMMITTED',
  COMMIT_FAILED: 'COMMIT_FAILED',
});

export const SNAPSHOT_RESTORE_STAGE_STATUSES = Object.freeze({
  STAGED: 'STAGED',
  COMMITTING: 'COMMITTING',
  COMMITTED: 'COMMITTED',
  FAILED: 'FAILED',
});

const PARTICIPANT_ID_PATTERN = /^[A-Za-z][A-Za-z0-9._-]{0,99}$/;

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

function requireParticipantId(value) {
  if (
    typeof value !== 'string' ||
    !PARTICIPANT_ID_PATTERN.test(value.trim())
  ) {
    throw new SnapshotParticipantRegistryError(
      SNAPSHOT_PARTICIPANT_REGISTRY_ERROR_CODES.INVALID_PARTICIPANT_ID,
      'Snapshot participant ID must begin with a letter and contain at most 100 letters, numbers, periods, underscores, or hyphens.',
      { participantId: value },
    );
  }

  return value.trim();
}

function requireContext(value) {
  if (value === undefined || value === null) {
    return Object.freeze({});
  }

  if (!isPlainObject(value)) {
    throw new SnapshotParticipantRegistryError(
      SNAPSHOT_PARTICIPANT_REGISTRY_ERROR_CODES.INVALID_CONTEXT,
      'Snapshot participant context must be a plain object.',
    );
  }

  return value;
}

function requireSnapshot(value) {
  if (!isPlainObject(value) || !isJsonCompatible(value)) {
    throw new SnapshotParticipantRegistryError(
      SNAPSHOT_PARTICIPANT_REGISTRY_ERROR_CODES.INVALID_SNAPSHOT,
      'Snapshot participant input must be a safe JSON-compatible object.',
    );
  }

  return value;
}

function resolveMethod(participant, methodNames) {
  const methodName = methodNames.find(
    (name) => typeof participant[name] === 'function',
  );

  if (methodName === undefined) {
    return null;
  }

  return participant[methodName].bind(participant);
}

function normalizeParticipant(idOrParticipant, participantValue) {
  const participant =
    participantValue === undefined
      ? idOrParticipant
      : participantValue;

  if (
    participant === null ||
    typeof participant !== 'object' ||
    Array.isArray(participant)
  ) {
    throw new SnapshotParticipantRegistryError(
      SNAPSHOT_PARTICIPANT_REGISTRY_ERROR_CODES.INVALID_PARTICIPANT,
      'Snapshot participant must be an object.',
    );
  }

  const participantId = requireParticipantId(
    participantValue === undefined
      ? participant.participantId ?? participant.id ?? participant.name
      : idOrParticipant,
  );
  const validate = resolveMethod(participant, [
    'validateSnapshot',
    'validateRestore',
    'validate',
  ]);
  const stage = resolveMethod(participant, [
    'stageRestore',
    'stageSnapshot',
    'stage',
  ]);
  const commit = resolveMethod(participant, [
    'commitRestore',
    'commitSnapshot',
    'commit',
  ]);
  const rollback = resolveMethod(participant, [
    'rollbackRestore',
    'rollbackSnapshot',
    'rollback',
  ]);

  if (validate === null || stage === null || commit === null) {
    throw new SnapshotParticipantRegistryError(
      SNAPSHOT_PARTICIPANT_REGISTRY_ERROR_CODES.INVALID_PARTICIPANT,
      'Snapshot participant must provide validation, staging, and commit operations.',
      {
        participantId,
        missingOperations: [
          ...(validate === null ? ['validate'] : []),
          ...(stage === null ? ['stageRestore'] : []),
          ...(commit === null ? ['commitRestore'] : []),
        ],
      },
    );
  }

  return Object.freeze({
    participantId,
    participant,
    validate,
    stage,
    commit,
    rollback,
  });
}

function normalizeIssue(value, participantId, fallbackMessage) {
  if (typeof value === 'string' && value.trim().length > 0) {
    return deepFreeze({
      participantId,
      code: 'PARTICIPANT_VALIDATION_ERROR',
      message: value.trim(),
    });
  }

  if (isPlainObject(value)) {
    return deepFreeze({
      participantId,
      code:
        typeof value.code === 'string' && value.code.trim().length > 0
          ? value.code.trim()
          : 'PARTICIPANT_VALIDATION_ERROR',
      message:
        typeof value.message === 'string' &&
        value.message.trim().length > 0
          ? value.message.trim()
          : fallbackMessage,
      ...(typeof value.path === 'string' &&
      value.path.trim().length > 0
        ? { path: value.path.trim() }
        : {}),
    });
  }

  return deepFreeze({
    participantId,
    code: 'PARTICIPANT_VALIDATION_ERROR',
    message: fallbackMessage,
  });
}

function normalizeValidationResult(participantId, value) {
  if (value === undefined || value === true) {
    return deepFreeze({
      participantId,
      valid: true,
      errors: [],
      warnings: [],
      data: null,
    });
  }

  if (value === false) {
    return deepFreeze({
      participantId,
      valid: false,
      errors: [
        normalizeIssue(
          null,
          participantId,
          'Snapshot validation was rejected by a participant.',
        ),
      ],
      warnings: [],
      data: null,
    });
  }

  if (!isPlainObject(value)) {
    throw new SnapshotParticipantRegistryError(
      SNAPSHOT_PARTICIPANT_REGISTRY_ERROR_CODES.VALIDATION_FAILED,
      'Snapshot participant returned an invalid validation result.',
      { participantId },
    );
  }

  const errors = Array.isArray(value.errors)
    ? value.errors.map((issue) =>
        normalizeIssue(
          issue,
          participantId,
          'Snapshot validation failed.',
        ),
      )
    : [];
  const warnings = Array.isArray(value.warnings)
    ? value.warnings.map((issue) =>
        normalizeIssue(
          issue,
          participantId,
          'Snapshot validation produced a warning.',
        ),
      )
    : [];
  const valid =
    value.valid === undefined
      ? errors.length === 0
      : value.valid === true;

  return deepFreeze({
    participantId,
    valid: valid && errors.length === 0,
    errors,
    warnings,
    data:
      value.data ??
      value.value ??
      value.normalizedSnapshot ??
      null,
  });
}

function normalizeParticipantFailure(error, code, message, participantId) {
  if (error instanceof SnapshotParticipantRegistryError) {
    return error;
  }

  return new SnapshotParticipantRegistryError(
    code,
    message,
    {
      participantId,
      participantCode:
        error !== null && typeof error === 'object'
          ? error.code ?? null
          : null,
    },
    error,
  );
}

async function rollbackEntries(entries, context, descriptor) {
  const failures = [];

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];

    if (entry.registration.rollback === null) {
      continue;
    }

    try {
      await entry.registration.rollback(
        entry.stagedValue,
        context,
        descriptor,
      );
    } catch (error) {
      failures.push(
        deepFreeze({
          participantId: entry.registration.participantId,
          code:
            error !== null && typeof error === 'object'
              ? error.code ?? 'ROLLBACK_FAILED'
              : 'ROLLBACK_FAILED',
        }),
      );
    }
  }

  return Object.freeze(failures);
}

/**
 * Error raised when snapshot participant coordination fails.
 */
export class SnapshotParticipantRegistryError extends Error {
  /**
   * @param {string} code Stable registry error code.
   * @param {string} message Human-readable error message.
   * @param {unknown} [details] Optional structured details.
   * @param {unknown} [cause] Original error.
   */
  constructor(code, message, details, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'SnapshotParticipantRegistryError';
    this.code = code;

    if (details !== undefined) {
      this.details = deepFreeze(details);
    }
  }
}

/**
 * Coordinates validation, staging, and commit operations across snapshot
 * participants without clearing the browser storage namespace.
 */
export class SnapshotParticipantRegistry {
  constructor() {
    this.participants = new Map();
    this.stagedRestores = new WeakMap();
    this.stageSequence = 0;
  }

  /**
   * Registers a snapshot participant.
   *
   * Supports `registerParticipant(participant)` and
   * `registerParticipant(participantId, participant)`.
   *
   * @param {string|Record<string, unknown>} idOrParticipant Participant ID or
   * participant.
   * @param {Record<string, unknown>} [participantValue] Participant.
   * @returns {() => boolean} Unregister function.
   */
  registerParticipant(idOrParticipant, participantValue) {
    const registration = normalizeParticipant(
      idOrParticipant,
      participantValue,
    );

    if (this.participants.has(registration.participantId)) {
      throw new SnapshotParticipantRegistryError(
        SNAPSHOT_PARTICIPANT_REGISTRY_ERROR_CODES.PARTICIPANT_ALREADY_REGISTERED,
        'Snapshot participant is already registered.',
        { participantId: registration.participantId },
      );
    }

    this.participants.set(
      registration.participantId,
      registration,
    );

    let registered = true;

    return () => {
      if (!registered) {
        return false;
      }

      registered = false;
      return this.participants.delete(
        registration.participantId,
      );
    };
  }

  /**
   * Removes a registered snapshot participant.
   *
   * @param {string} participantId Participant identifier.
   * @returns {boolean} Whether a participant was removed.
   */
  unregisterParticipant(participantId) {
    return this.participants.delete(
      requireParticipantId(participantId),
    );
  }

  /**
   * Returns registered participant identifiers in registration order.
   *
   * @returns {readonly string[]} Participant identifiers.
   */
  getParticipantIds() {
    return Object.freeze([...this.participants.keys()]);
  }

  /**
   * Validates a snapshot with every registered participant.
   *
   * @param {Record<string, unknown>} snapshot Candidate snapshot.
   * @param {Record<string, unknown>} [context] Validation context.
   * @returns {Promise<Readonly<Record<string, unknown>>>} Validation report.
   */
  async validateAll(snapshot, context = {}) {
    const candidate = requireSnapshot(snapshot);
    const normalizedContext = requireContext(context);
    const results = [];

    for (const registration of this.participants.values()) {
      let value;

      try {
        value = await registration.validate(
          candidate,
          normalizedContext,
        );
      } catch (error) {
        throw normalizeParticipantFailure(
          error,
          SNAPSHOT_PARTICIPANT_REGISTRY_ERROR_CODES.VALIDATION_FAILED,
          'Snapshot participant validation could not be completed.',
          registration.participantId,
        );
      }

      results.push(
        normalizeValidationResult(
          registration.participantId,
          value,
        ),
      );
    }

    const errors = results.flatMap((result) => result.errors);
    const warnings = results.flatMap(
      (result) => result.warnings,
    );

    return deepFreeze({
      schemaVersion: SNAPSHOT_PARTICIPANT_REGISTRY_SCHEMA_VERSION,
      valid: errors.length === 0,
      participantCount: results.length,
      participantIds: results.map(
        (result) => result.participantId,
      ),
      results,
      errors,
      warnings,
    });
  }

  /**
   * Validates and stages a snapshot with every participant.
   *
   * If staging fails, already staged participants are rolled back in reverse
   * order when they expose a rollback operation.
   *
   * @param {Record<string, unknown>} snapshot Candidate snapshot.
   * @param {Record<string, unknown>} [context] Restore context.
   * @returns {Promise<Readonly<Record<string, unknown>>>} Opaque restore stage.
   */
  async stageRestore(snapshot, context = {}) {
    const candidate = requireSnapshot(snapshot);
    const normalizedContext = requireContext(context);
    const validation = await this.validateAll(
      candidate,
      normalizedContext,
    );

    if (!validation.valid) {
      throw new SnapshotParticipantRegistryError(
        SNAPSHOT_PARTICIPANT_REGISTRY_ERROR_CODES.VALIDATION_FAILED,
        'Snapshot restore cannot be staged because participant validation failed.',
        {
          errors: validation.errors,
          participantIds: validation.participantIds,
        },
      );
    }

    this.stageSequence += 1;

    const descriptor = Object.freeze({
      schemaVersion: SNAPSHOT_PARTICIPANT_REGISTRY_SCHEMA_VERSION,
      stageId: `snapshot-stage-${this.stageSequence}`,
      status: SNAPSHOT_RESTORE_STAGE_STATUSES.STAGED,
      participantIds: validation.participantIds,
      validation,
    });
    const entries = [];

    for (const registration of this.participants.values()) {
      const participantValidation = validation.results.find(
        (result) =>
          result.participantId === registration.participantId,
      );

      try {
        const stagedValue = await registration.stage(
          candidate,
          normalizedContext,
          participantValidation,
        );

        entries.push({
          registration,
          stagedValue,
        });
      } catch (error) {
        const rollbackFailures = await rollbackEntries(
          entries,
          normalizedContext,
          descriptor,
        );

        throw new SnapshotParticipantRegistryError(
          SNAPSHOT_PARTICIPANT_REGISTRY_ERROR_CODES.STAGING_FAILED,
          'Snapshot restore staging could not be completed.',
          {
            participantId: registration.participantId,
            participantCode:
              error !== null && typeof error === 'object'
                ? error.code ?? null
                : null,
            rollbackFailures,
          },
          error,
        );
      }
    }

    this.stagedRestores.set(descriptor, {
      status: SNAPSHOT_RESTORE_STAGE_STATUSES.STAGED,
      entries,
      context: normalizedContext,
    });

    return descriptor;
  }

  /**
   * Commits a previously staged restore with every participant.
   *
   * A stage is single-use. On failure, rollback-capable participants are
   * invoked in reverse staging order.
   *
   * @param {Readonly<Record<string, unknown>>} stagedRestore Restore stage.
   * @param {Record<string, unknown>} [context] Commit context.
   * @returns {Promise<Readonly<Record<string, unknown>>>} Commit report.
   */
  async commitRestore(stagedRestore, context = {}) {
    if (
      stagedRestore === null ||
      typeof stagedRestore !== 'object' ||
      Array.isArray(stagedRestore)
    ) {
      throw new SnapshotParticipantRegistryError(
        SNAPSHOT_PARTICIPANT_REGISTRY_ERROR_CODES.INVALID_STAGE,
        'Snapshot restore stage is invalid or was not created by this registry.',
      );
    }

    const record = this.stagedRestores.get(stagedRestore);

    if (record === undefined) {
      throw new SnapshotParticipantRegistryError(
        SNAPSHOT_PARTICIPANT_REGISTRY_ERROR_CODES.INVALID_STAGE,
        'Snapshot restore stage is invalid or is no longer available.',
      );
    }

    if (record.status !== SNAPSHOT_RESTORE_STAGE_STATUSES.STAGED) {
      throw new SnapshotParticipantRegistryError(
        SNAPSHOT_PARTICIPANT_REGISTRY_ERROR_CODES.STAGE_ALREADY_COMMITTED,
        'Snapshot restore stage has already been committed or failed.',
        {
          stageId: stagedRestore.stageId,
          status: record.status,
        },
      );
    }

    const normalizedContext = requireContext(context);
    const commitContext = Object.freeze({
      ...record.context,
      ...normalizedContext,
    });
    const results = [];

    record.status = SNAPSHOT_RESTORE_STAGE_STATUSES.COMMITTING;

    for (const entry of record.entries) {
      try {
        const value = await entry.registration.commit(
          entry.stagedValue,
          commitContext,
          stagedRestore,
        );

        results.push(
          Object.freeze({
            participantId: entry.registration.participantId,
            value,
          }),
        );
      } catch (error) {
        record.status = SNAPSHOT_RESTORE_STAGE_STATUSES.FAILED;

        const rollbackFailures = await rollbackEntries(
          record.entries,
          commitContext,
          stagedRestore,
        );

        throw new SnapshotParticipantRegistryError(
          SNAPSHOT_PARTICIPANT_REGISTRY_ERROR_CODES.COMMIT_FAILED,
          'Snapshot restore commit could not be completed.',
          {
            stageId: stagedRestore.stageId,
            participantId: entry.registration.participantId,
            committedParticipantIds: results.map(
              (result) => result.participantId,
            ),
            participantCode:
              error !== null && typeof error === 'object'
                ? error.code ?? null
                : null,
            rollbackFailures,
          },
          error,
        );
      }
    }

    record.status = SNAPSHOT_RESTORE_STAGE_STATUSES.COMMITTED;

    return deepFreeze({
      schemaVersion: SNAPSHOT_PARTICIPANT_REGISTRY_SCHEMA_VERSION,
      stageId: stagedRestore.stageId,
      status: SNAPSHOT_RESTORE_STAGE_STATUSES.COMMITTED,
      participantCount: results.length,
      participantIds: results.map(
        (result) => result.participantId,
      ),
      results,
    });
  }
}

/**
 * Creates an isolated snapshot participant registry.
 *
 * @returns {SnapshotParticipantRegistry} Registry instance.
 */
export function createSnapshotParticipantRegistry() {
  return new SnapshotParticipantRegistry();
}

export const snapshotParticipantRegistry =
  createSnapshotParticipantRegistry();

/**
 * Registers a participant with the shared registry.
 *
 * @param {string|Record<string, unknown>} idOrParticipant Participant ID or
 * participant.
 * @param {Record<string, unknown>} [participant] Participant.
 * @returns {() => boolean} Unregister function.
 */
export function registerParticipant(
  idOrParticipant,
  participant,
) {
  return snapshotParticipantRegistry.registerParticipant(
    idOrParticipant,
    participant,
  );
}

/**
 * Validates a snapshot through the shared registry.
 *
 * @param {Record<string, unknown>} snapshot Candidate snapshot.
 * @param {Record<string, unknown>} [context] Validation context.
 * @returns {Promise<Readonly<Record<string, unknown>>>} Validation report.
 */
export function validateAll(snapshot, context = {}) {
  return snapshotParticipantRegistry.validateAll(snapshot, context);
}

/**
 * Stages a snapshot restore through the shared registry.
 *
 * @param {Record<string, unknown>} snapshot Candidate snapshot.
 * @param {Record<string, unknown>} [context] Restore context.
 * @returns {Promise<Readonly<Record<string, unknown>>>} Restore stage.
 */
export function stageRestore(snapshot, context = {}) {
  return snapshotParticipantRegistry.stageRestore(snapshot, context);
}

/**
 * Commits a staged restore through the shared registry.
 *
 * @param {Readonly<Record<string, unknown>>} stagedRestore Restore stage.
 * @param {Record<string, unknown>} [context] Commit context.
 * @returns {Promise<Readonly<Record<string, unknown>>>} Commit report.
 */
export function commitRestore(stagedRestore, context = {}) {
  return snapshotParticipantRegistry.commitRestore(
    stagedRestore,
    context,
  );
}

export const SnapshotRestoreParticipantRegistry =
  SnapshotParticipantRegistry;
export const createSnapshotRestoreParticipantRegistry =
  createSnapshotParticipantRegistry;

export default snapshotParticipantRegistry;