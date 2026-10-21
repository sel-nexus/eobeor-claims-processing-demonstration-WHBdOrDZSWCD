import PropTypes from 'prop-types';
import {
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AlertCircle,
  CheckCircle2,
  DatabaseBackup,
  Download,
  FileCheck2,
  FileJson,
  HardDrive,
  Loader2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react';
import AccessDenied from '../../../platform/components/AccessDenied.jsx';
import ConfirmDialog from '../../../platform/components/ConfirmDialog.jsx';
import StatusBadge from '../../../platform/components/StatusBadge.jsx';
import {
  SNAPSHOT_CONFIRMATIONS,
  SNAPSHOT_FORMATS,
  SNAPSHOT_SCOPES,
} from '../../../platform/services/snapshotFacade.js';
import { downloadBlob } from '../../../platform/utils/download.js';
import {
  formatDateTime,
  formatNumber,
} from '../../../platform/utils/formatters.js';
import {
  isPlainObject,
  isPlatformRole,
} from '../../../platform/validation/schemas.js';

const AUTHORIZED_ROLES = new Set(['ITS', 'ADMIN']);
const APPLY_ROLES = new Set(['ADMIN']);
const EMPTY_COLLECTION = Object.freeze([]);
const MAXIMUM_SNAPSHOT_BYTES = 5 * 1024 * 1024;
const FICTIONAL_DATA_NOTICE = 'Fictional demo data';

const EXPORT_SCOPE_OPTIONS = Object.freeze([
  Object.freeze({
    value: SNAPSHOT_SCOPES.ALL_DEMO_DATA,
    label: 'All governed demo data',
    description:
      'Exports available fictional users, settings, audits, preferences, monitoring, operations, fixture overlays, and insight slices.',
    roles: Object.freeze(['ADMIN']),
  }),
  Object.freeze({
    value: SNAPSHOT_SCOPES.PLATFORM_DIAGNOSTICS,
    label: 'Platform diagnostics',
    description:
      'Exports permitted platform diagnostics without active sessions or credential values.',
    roles: Object.freeze(['ADMIN', 'ITS']),
  }),
]);

function normalizeErrorMessage(error, fallback) {
  if (
    error !== null &&
    typeof error === 'object' &&
    typeof error.message === 'string' &&
    error.message.trim().length > 0
  ) {
    return error.message;
  }

  return fallback;
}

function normalizeRole(value) {
  const role =
    typeof value === 'string'
      ? value.trim().toUpperCase()
      : value;

  return isPlatformRole(role) ? role : null;
}

function normalizeContext(value) {
  if (!isPlainObject(value)) {
    return null;
  }

  const source = isPlainObject(value.session)
    ? value.session
    : isPlainObject(value.actor)
      ? value.actor
      : value;
  const role = normalizeRole(source.role);

  if (role === null) {
    return null;
  }

  return {
    ...source,
    role,
    actorId:
      typeof source.actorId === 'string' &&
      source.actorId.trim().length > 0
        ? source.actorId.normalize('NFC').trim()
        : typeof source.userId === 'string' &&
            source.userId.trim().length > 0
          ? source.userId.normalize('NFC').trim()
          : null,
  };
}

function createServiceError(result, fallback) {
  const error = new Error(
    typeof result?.error?.message === 'string' &&
    result.error.message.trim().length > 0
      ? result.error.message
      : fallback,
  );

  if (typeof result?.error?.code === 'string') {
    error.code = result.error.code;
  }

  if (result?.error?.retryable === true) {
    error.retryable = true;
  }

  if (isPlainObject(result?.error?.details)) {
    error.details = result.error.details;
  }

  if (Array.isArray(result?.error?.fieldErrors)) {
    error.fieldErrors = result.error.fieldErrors;
  }

  throw error;
}

function unwrapServiceResult(result, fallback) {
  if (result?.ok === false) {
    return createServiceError(result, fallback);
  }

  return result?.ok === true ? result.data : result;
}

function resolveExportMethod(service) {
  if (service === null || service === undefined) {
    return null;
  }

  if (typeof service.exportSnapshot === 'function') {
    return service.exportSnapshot.bind(service);
  }

  if (typeof service.export === 'function') {
    return service.export.bind(service);
  }

  return null;
}

function resolveValidateMethod(service) {
  if (service === null || service === undefined) {
    return null;
  }

  if (typeof service.validateSnapshot === 'function') {
    return service.validateSnapshot.bind(service);
  }

  if (typeof service.validate === 'function') {
    return service.validate.bind(service);
  }

  return null;
}

function resolveApplyMethod(service) {
  if (service === null || service === undefined) {
    return null;
  }

  if (typeof service.applySnapshot === 'function') {
    return service.applySnapshot.bind(service);
  }

  if (typeof service.apply === 'function') {
    return service.apply.bind(service);
  }

  return null;
}

function resolveRestoreMethod(service) {
  if (service === null || service === undefined) {
    return null;
  }

  if (typeof service.restoreSample === 'function') {
    return service.restoreSample.bind(service);
  }

  if (typeof service.restore === 'function') {
    return service.restore.bind(service);
  }

  return null;
}

function isJsonFile(file) {
  if (
    typeof globalThis.File === 'function' &&
    file instanceof globalThis.File
  ) {
    const filename = file.name.toLocaleLowerCase('en-US');
    const mediaType = file.type.toLocaleLowerCase('en-US');

    return (
      filename.endsWith('.json') &&
      (mediaType.length === 0 ||
        mediaType === 'application/json' ||
        mediaType === 'text/json')
    );
  }

  return (
    typeof globalThis.Blob === 'function' &&
    file instanceof globalThis.Blob
  );
}

function getFileName(file) {
  return typeof file?.name === 'string' &&
    file.name.trim().length > 0
    ? file.name.trim()
    : 'browser-local-snapshot.json';
}

function formatBytes(value) {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0
  ) {
    return '—';
  }

  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${formatNumber(value / 1024, {
      maximumFractionDigits: 1,
    })} KB`;
  }

  return `${formatNumber(value / (1024 * 1024), {
    maximumFractionDigits: 2,
  })} MB`;
}

function normalizeRecordCounts(value) {
  if (!isPlainObject(value)) {
    return [];
  }

  return Object.entries(value)
    .filter(
      ([name, count]) =>
        typeof name === 'string' &&
        name.trim().length > 0 &&
        Number.isFinite(count) &&
        count >= 0,
    )
    .sort(([left], [right]) =>
      left.localeCompare(right, 'en-US'),
    );
}

function getIssueMessage(issue) {
  if (
    isPlainObject(issue) &&
    typeof issue.message === 'string' &&
    issue.message.trim().length > 0
  ) {
    return issue.message.trim();
  }

  return 'Snapshot validation reported an unspecified issue.';
}

function getIssueKey(issue, index) {
  if (!isPlainObject(issue)) {
    return `snapshot-issue-${index}`;
  }

  return `${issue.code ?? 'issue'}-${issue.path ?? index}-${index}`;
}

/**
 * Snapshot export, validation, replacement, and canonical sample restore route.
 *
 * @param {{
 *   session?: Record<string, unknown>|null,
 *   context?: Record<string, unknown>|null,
 *   snapshotFacade?: object,
 *   snapshotService?: object,
 *   initialValidation?: Record<string, unknown>|null,
 *   onExported?: Function,
 *   onValidated?: Function,
 *   onApplied?: Function,
 *   onRestored?: Function
 * }} props Component props.
 * @returns {JSX.Element} Snapshot administration page.
 */
export function SnapshotsPage({
  session = null,
  context = null,
  snapshotFacade = null,
  snapshotService = null,
  initialValidation = null,
  onExported,
  onValidated,
  onApplied,
  onRestored,
}) {
  const headingId = useId();
  const exportScopeId = useId();
  const fileInputId = useId();
  const fileInputRef = useRef(null);
  const accessContext = useMemo(
    () => normalizeContext(context ?? session),
    [context, session],
  );
  const role = accessContext?.role ?? null;
  const authenticated = accessContext !== null;
  const canReplace =
    role !== null && APPLY_ROLES.has(role);
  const service = snapshotFacade ?? snapshotService;
  const exportSnapshot = useMemo(
    () => resolveExportMethod(service),
    [service],
  );
  const validateSnapshot = useMemo(
    () => resolveValidateMethod(service),
    [service],
  );
  const applySnapshot = useMemo(
    () => resolveApplyMethod(service),
    [service],
  );
  const restoreSample = useMemo(
    () => resolveRestoreMethod(service),
    [service],
  );
  const availableScopes = useMemo(
    () =>
      EXPORT_SCOPE_OPTIONS.filter((option) =>
        role === null ? false : option.roles.includes(role),
      ),
    [role],
  );
  const [exportScope, setExportScope] = useState(
    role === 'ITS'
      ? SNAPSHOT_SCOPES.PLATFORM_DIAGNOSTICS
      : SNAPSHOT_SCOPES.ALL_DEMO_DATA,
  );
  const [includeAudit, setIncludeAudit] = useState(true);
  const [selectedFile, setSelectedFile] = useState(null);
  const [validation, setValidation] = useState(
    initialValidation,
  );
  const [validationToken, setValidationToken] = useState(
    typeof initialValidation?.validationToken === 'string'
      ? initialValidation.validationToken
      : null,
  );
  const [exportPending, setExportPending] = useState(false);
  const [validationPending, setValidationPending] =
    useState(false);
  const [applyPending, setApplyPending] = useState(false);
  const [restorePending, setRestorePending] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [applyDialogOpen, setApplyDialogOpen] =
    useState(false);
  const [restoreDialogOpen, setRestoreDialogOpen] =
    useState(false);
  const [operationError, setOperationError] = useState(null);
  const [operationMessage, setOperationMessage] =
    useState(null);
  const pending =
    exportPending ||
    validationPending ||
    applyPending ||
    restorePending;
  const validationWarnings = Array.isArray(
    validation?.warningDetails,
  )
    ? validation.warningDetails
    : Array.isArray(validation?.warnings)
      ? validation.warnings
      : EMPTY_COLLECTION;
  const replacementSlices = Array.isArray(
    validation?.replacementSlices,
  )
    ? validation.replacementSlices
    : EMPTY_COLLECTION;
  const recordCounts = normalizeRecordCounts(
    validation?.recordCounts,
  );

  const clearFeedback = () => {
    setOperationError(null);
    setOperationMessage(null);
  };

  const clearSelectedSnapshot = () => {
    setSelectedFile(null);
    setValidation(null);
    setValidationToken(null);
    setApplyDialogOpen(false);
    clearFeedback();

    if (fileInputRef.current !== null) {
      fileInputRef.current.value = '';
    }
  };

  const handleExport = async () => {
    if (exportSnapshot === null) {
      setOperationError(
        'Snapshot export is unavailable in this application composition.',
      );
      return;
    }

    const resolvedScope =
      role === 'ITS'
        ? SNAPSHOT_SCOPES.PLATFORM_DIAGNOSTICS
        : exportScope;

    setExportPending(true);
    clearFeedback();

    try {
      const result = await Promise.resolve(
        exportSnapshot({
          scope: resolvedScope,
          includeAudit,
          format: SNAPSHOT_FORMATS.JSON,
        }),
      );
      const descriptor = unwrapServiceResult(
        result,
        'The browser-local snapshot could not be exported.',
      );

      if (
        !isPlainObject(descriptor) ||
        typeof descriptor.filename !== 'string' ||
        typeof globalThis.Blob !== 'function' ||
        !(descriptor.blob instanceof globalThis.Blob)
      ) {
        throw new Error(
          'The local snapshot service returned an invalid export descriptor.',
        );
      }

      downloadBlob(descriptor.blob, descriptor.filename, {
        cleanupDelayMs: 0,
      });

      setOperationMessage(
        `The ${resolvedScope === SNAPSHOT_SCOPES.PLATFORM_DIAGNOSTICS ? 'platform diagnostics' : 'governed demo data'} snapshot was exported locally. No file was transmitted.`,
      );

      if (typeof onExported === 'function') {
        await Promise.resolve(
          onExported(descriptor, result),
        );
      }
    } catch (error) {
      setOperationError(
        normalizeErrorMessage(
          error,
          'The browser-local snapshot could not be exported.',
        ),
      );
    } finally {
      setExportPending(false);
    }
  };

  const validateSelectedFile = async (file) => {
    if (!canReplace) {
      setOperationError(
        'Only the Administrator demo role can validate and replace local snapshot data.',
      );
      return;
    }

    if (validateSnapshot === null) {
      setOperationError(
        'Snapshot validation is unavailable in this application composition.',
      );
      return;
    }

    if (!isJsonFile(file)) {
      setOperationError(
        'Select a local JSON snapshot file.',
      );
      setSelectedFile(null);
      setValidation(null);
      setValidationToken(null);
      return;
    }

    if (
      typeof file.size === 'number' &&
      file.size > MAXIMUM_SNAPSHOT_BYTES
    ) {
      setOperationError(
        `Snapshot files must not exceed ${formatBytes(
          MAXIMUM_SNAPSHOT_BYTES,
        )}.`,
      );
      setSelectedFile(null);
      setValidation(null);
      setValidationToken(null);
      return;
    }

    setSelectedFile(file);
    setValidation(null);
    setValidationToken(null);
    setValidationPending(true);
    clearFeedback();

    try {
      const result = await Promise.resolve(
        validateSnapshot(file),
      );
      const report = unwrapServiceResult(
        result,
        'The browser-local snapshot could not be validated.',
      );

      if (
        !isPlainObject(report) ||
        report.valid !== true ||
        typeof report.validationToken !== 'string' ||
        report.validationToken.trim().length === 0
      ) {
        throw new Error(
          'The local snapshot service returned invalid validation evidence.',
        );
      }

      setValidation(report);
      setValidationToken(report.validationToken);
      setOperationMessage(
        'The snapshot passed local validation. No browser-local data has been replaced.',
      );

      if (typeof onValidated === 'function') {
        await Promise.resolve(
          onValidated(report, result, file),
        );
      }
    } catch (error) {
      setValidation(null);
      setValidationToken(null);
      setOperationError(
        normalizeErrorMessage(
          error,
          'The browser-local snapshot could not be validated.',
        ),
      );
    } finally {
      setValidationPending(false);
    }
  };

  const handleFileSelection = (files) => {
    const file = files?.[0];

    if (file === undefined) {
      return;
    }

    validateSelectedFile(file).catch((error) => {
      setValidationPending(false);
      setValidation(null);
      setValidationToken(null);
      setOperationError(
        normalizeErrorMessage(
          error,
          'The browser-local snapshot could not be validated.',
        ),
      );
    });
  };

  const handleApply = async () => {
    if (
      !canReplace ||
      validationToken === null ||
      applySnapshot === null
    ) {
      throw new Error(
        'Validated snapshot replacement is unavailable.',
      );
    }

    setApplyPending(true);
    clearFeedback();

    try {
      const result = await Promise.resolve(
        applySnapshot({
          validationToken,
          confirmation: SNAPSHOT_CONFIRMATIONS.APPLY,
        }),
      );
      const report = unwrapServiceResult(
        result,
        'The validated snapshot could not be applied.',
      );

      if (!isPlainObject(report) || report.applied !== true) {
        throw new Error(
          'The local snapshot service returned invalid replacement evidence.',
        );
      }

      setOperationMessage(
        report.reloadRequired === true
          ? 'The validated snapshot replaced governed browser-local data. Reload the application to refresh every route.'
          : 'The validated snapshot replaced governed browser-local data.',
      );
      setValidationToken(null);
      setValidation(null);
      setSelectedFile(null);

      if (fileInputRef.current !== null) {
        fileInputRef.current.value = '';
      }

      if (typeof onApplied === 'function') {
        await Promise.resolve(
          onApplied(report, result),
        );
      }

      return report;
    } catch (error) {
      const message = normalizeErrorMessage(
        error,
        'The validated snapshot could not be applied.',
      );

      setOperationError(message);
      throw new Error(message);
    } finally {
      setApplyPending(false);
    }
  };

  const handleRestore = async () => {
    if (!canReplace || restoreSample === null) {
      throw new Error(
        'Canonical sample restore is unavailable.',
      );
    }

    setRestorePending(true);
    clearFeedback();

    try {
      const result = await Promise.resolve(
        restoreSample({
          confirmation:
            SNAPSHOT_CONFIRMATIONS.RESTORE_SAMPLE,
        }),
      );
      const report = unwrapServiceResult(
        result,
        'Canonical fictional sample data could not be restored.',
      );

      if (!isPlainObject(report) || report.restored !== true) {
        throw new Error(
          'The local snapshot service returned invalid restore evidence.',
        );
      }

      setSelectedFile(null);
      setValidation(null);
      setValidationToken(null);

      if (fileInputRef.current !== null) {
        fileInputRef.current.value = '';
      }

      setOperationMessage(
        report.reloadRequired === true
          ? 'Canonical fictional sample data was restored. Reload the application to refresh every route.'
          : 'Canonical fictional sample data was restored locally.',
      );

      if (typeof onRestored === 'function') {
        await Promise.resolve(
          onRestored(report, result),
        );
      }

      return report;
    } catch (error) {
      const message = normalizeErrorMessage(
        error,
        'Canonical fictional sample data could not be restored.',
      );

      setOperationError(message);
      throw new Error(message);
    } finally {
      setRestorePending(false);
    }
  };

  if (!authenticated) {
    return <AccessDenied authenticated={false} />;
  }

  if (role === null || !AUTHORIZED_ROLES.has(role)) {
    return <AccessDenied authenticated />;
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
      <header
        className="overflow-hidden rounded-2xl border border-primary-200 bg-primary-50 shadow-card dark:border-primary-800 dark:bg-primary-950"
        aria-labelledby={headingId}
      >
        <div className="grid gap-5 px-5 py-6 sm:px-7 sm:py-8 lg:grid-cols-[1fr_auto] lg:items-center">
          <div className="flex min-w-0 items-start gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-600 text-white shadow-sm">
              <DatabaseBackup
                className="h-6 w-6"
                aria-hidden="true"
              />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-primary-700 dark:text-primary-300">
                Browser-local data governance
              </p>
              <h1
                id={headingId}
                className="mt-1 text-2xl font-semibold tracking-tight text-content dark:text-content-inverse sm:text-3xl"
              >
                Snapshots and sample restore
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-content-muted dark:text-content-inverse-muted sm:text-base">
                Export governed demonstration data as JSON,
                validate a local namespace snapshot before
                replacement, or restore the canonical fictional
                sample baseline.
              </p>
            </div>
          </div>

          <StatusBadge
            status={role}
            variant="neutral"
            label={`${role} demo role`}
          />
        </div>
      </header>

      <aside
        className="mt-5 rounded-xl border border-primary-200 bg-primary-50 p-4 text-sm text-primary-900 dark:border-primary-800 dark:bg-primary-950 dark:text-primary-100"
        role="note"
        aria-label="Snapshot privacy disclosure"
      >
        <div className="flex items-start gap-3">
          <ShieldCheck
            className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
            aria-hidden="true"
          />
          <div>
            <p className="font-semibold">
              {FICTIONAL_DATA_NOTICE}
            </p>
            <p className="mt-1 leading-6">
              Snapshot files contain browser-local fictional
              demonstration records. Export, validation,
              replacement, and sample restore do not upload data
              or contact a payer, provider, healthcare, identity,
              storage, monitoring, or other external system.
            </p>
            <p className="mt-1 text-xs leading-5">
              Active sessions and printed demo credentials are not
              imported from snapshots. Browser storage is
              user-editable and is not durable or secure server
              storage.
            </p>
          </div>
        </div>
      </aside>

      {operationError !== null ? (
        <div
          className="mt-5 flex items-start gap-2 rounded-lg border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700 dark:border-danger-700 dark:bg-danger-950 dark:text-danger-100"
          role="alert"
        >
          <AlertCircle
            className="mt-0.5 h-4 w-4 shrink-0"
            aria-hidden="true"
          />
          <span>{operationError}</span>
        </div>
      ) : null}

      {operationMessage !== null ? (
        <div
          className="mt-5 flex items-start gap-2 rounded-lg border border-success-200 bg-success-50 px-4 py-3 text-sm text-success-700 dark:border-success-700 dark:bg-surface-dark dark:text-success-100"
          role="status"
          aria-live="polite"
        >
          <CheckCircle2
            className="mt-0.5 h-4 w-4 shrink-0"
            aria-hidden="true"
          />
          <span>{operationMessage}</span>
        </div>
      ) : null}

      <section
        className="mt-8 rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted sm:p-6"
        aria-labelledby="snapshot-export-heading"
        aria-busy={exportPending}
      >
        <div className="flex items-start gap-3">
          <Download
            className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
            aria-hidden="true"
          />
          <div>
            <h2
              id="snapshot-export-heading"
              className="text-xl font-semibold text-content dark:text-content-inverse"
            >
              Export a JSON namespace snapshot
            </h2>
            <p className="mt-1 text-sm leading-6 text-content-muted dark:text-content-inverse-muted">
              Create a local JSON Blob containing only slices
              permitted for the current demo role.
            </p>
          </div>
        </div>

        <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label
                className="block text-sm font-medium text-content dark:text-content-inverse"
                htmlFor={exportScopeId}
              >
                Export scope
              </label>
              <select
                id={exportScopeId}
                className="mt-2 block min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-content shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 disabled:cursor-not-allowed disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
                value={
                  role === 'ITS'
                    ? SNAPSHOT_SCOPES.PLATFORM_DIAGNOSTICS
                    : exportScope
                }
                disabled={
                  exportPending || availableScopes.length <= 1
                }
                onChange={(event) => {
                  setExportScope(event.target.value);
                  clearFeedback();
                }}
              >
                {availableScopes.map((option) => (
                  <option
                    key={option.value}
                    value={option.value}
                  >
                    {option.label}
                  </option>
                ))}
              </select>
              <p className="mt-2 text-xs leading-5 text-content-subtle dark:text-content-inverse-muted">
                {
                  availableScopes.find(
                    (option) =>
                      option.value ===
                      (role === 'ITS'
                        ? SNAPSHOT_SCOPES.PLATFORM_DIAGNOSTICS
                        : exportScope),
                  )?.description
                }
              </p>
            </div>

            <label className="flex min-h-11 items-center gap-3 self-start rounded-lg border border-border bg-surface-muted px-4 py-3 text-sm font-medium text-content dark:border-border-dark dark:bg-surface-dark dark:text-content-inverse sm:mt-7">
              <input
                className="h-4 w-4 rounded border-border-strong text-primary-600 focus:ring-primary-500"
                type="checkbox"
                checked={includeAudit}
                disabled={exportPending}
                onChange={(event) => {
                  setIncludeAudit(event.target.checked);
                  clearFeedback();
                }}
              />
              Include authorized masked audit events
            </label>
          </div>

          <button
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-primary-600 bg-primary-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:focus:ring-offset-surface-dark lg:w-auto"
            type="button"
            disabled={pending || exportSnapshot === null}
            onClick={() => {
              handleExport().catch((error) => {
                setExportPending(false);
                setOperationError(
                  normalizeErrorMessage(
                    error,
                    'The browser-local snapshot could not be exported.',
                  ),
                );
              });
            }}
          >
            {exportPending ? (
              <Loader2
                className="h-4 w-4 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : (
              <Download
                className="h-4 w-4"
                aria-hidden="true"
              />
            )}
            {exportPending
              ? 'Creating local export…'
              : 'Export JSON snapshot'}
          </button>
        </div>

        <p className="mt-5 text-xs font-semibold text-primary-700 dark:text-primary-300">
          Export notice: {FICTIONAL_DATA_NOTICE}
        </p>
      </section>

      {canReplace ? (
        <section
          className="mt-8 rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted sm:p-6"
          aria-labelledby="snapshot-import-heading"
          aria-busy={validationPending || applyPending}
        >
          <div className="flex items-start gap-3">
            <Upload
              className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
              aria-hidden="true"
            />
            <div>
              <h2
                id="snapshot-import-heading"
                className="text-xl font-semibold text-content dark:text-content-inverse"
              >
                Validate and replace local data
              </h2>
              <p className="mt-1 text-sm leading-6 text-content-muted dark:text-content-inverse-muted">
                Select a JSON snapshot for local validation.
                Validation does not mutate browser-local data.
                Replacement requires a separate typed
                confirmation.
              </p>
            </div>
          </div>

          <div
            className={`mt-6 rounded-xl border-2 border-dashed p-6 text-center transition ${
              dragActive
                ? 'border-primary-500 bg-primary-50 dark:bg-primary-950'
                : 'border-border-strong bg-surface-muted dark:border-border-dark-strong dark:bg-surface-dark'
            }`}
            onDragEnter={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={(event) => {
              if (event.currentTarget === event.target) {
                setDragActive(false);
              }
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDragActive(false);

              if (!pending) {
                handleFileSelection(event.dataTransfer.files);
              }
            }}
          >
            {validationPending ? (
              <Loader2
                className="mx-auto h-8 w-8 animate-spin text-primary-600 motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : (
              <FileJson
                className="mx-auto h-8 w-8 text-content-subtle dark:text-content-inverse-muted"
                aria-hidden="true"
              />
            )}
            <p className="mt-3 font-semibold text-content dark:text-content-inverse">
              {validationPending
                ? 'Validating snapshot locally'
                : 'Drop a JSON snapshot here'}
            </p>
            <p className="mt-2 text-sm leading-6 text-content-muted dark:text-content-inverse-muted">
              Maximum size {formatBytes(MAXIMUM_SNAPSHOT_BYTES)}.
              The selected file is read only by browser-local
              validation code.
            </p>

            <input
              ref={fileInputRef}
              id={fileInputId}
              className="sr-only"
              type="file"
              accept=".json,application/json,text/json"
              disabled={pending}
              onChange={(event) => {
                handleFileSelection(event.target.files);
                event.target.value = '';
              }}
            />
            <label
              className={`mt-4 inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border-strong bg-surface px-4 py-2 text-sm font-semibold text-content transition focus-within:ring-2 focus-within:ring-primary-500 dark:border-border-dark-strong dark:bg-surface-dark-muted dark:text-content-inverse ${
                pending
                  ? 'cursor-not-allowed opacity-60'
                  : 'cursor-pointer hover:bg-surface-muted dark:hover:bg-surface-dark-raised'
              }`}
              htmlFor={pending ? undefined : fileInputId}
            >
              <Upload
                className="h-4 w-4"
                aria-hidden="true"
              />
              Select JSON snapshot
            </label>
          </div>

          {selectedFile !== null ? (
            <div className="mt-5 flex flex-col gap-4 rounded-xl border border-border p-4 dark:border-border-dark sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <FileJson
                  className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-content dark:text-content-inverse">
                    {getFileName(selectedFile)}
                  </p>
                  <p className="mt-1 text-xs text-content-subtle dark:text-content-inverse-muted">
                    {formatBytes(selectedFile.size)}
                  </p>
                </div>
              </div>

              <button
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border-strong bg-surface px-4 py-2 text-sm font-semibold text-content transition hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
                type="button"
                disabled={pending}
                onClick={clearSelectedSnapshot}
              >
                <X className="h-4 w-4" aria-hidden="true" />
                Clear selected file
              </button>
            </div>
          ) : null}

          {validation !== null ? (
            <div className="mt-6 overflow-hidden rounded-xl border border-success-200 bg-success-50 dark:border-success-700 dark:bg-surface-dark">
              <div className="flex flex-col gap-4 border-b border-success-200 p-5 dark:border-success-700 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex items-start gap-3">
                  <FileCheck2
                    className="mt-0.5 h-6 w-6 shrink-0 text-success-700 dark:text-success-100"
                    aria-hidden="true"
                  />
                  <div>
                    <h3 className="font-semibold text-success-700 dark:text-success-100">
                      Snapshot validation passed
                    </h3>
                    <p className="mt-1 text-sm leading-6 text-content-muted dark:text-content-inverse-muted">
                      Review the replacement preview before
                      opening the destructive confirmation.
                    </p>
                  </div>
                </div>
                <StatusBadge status="PASSED" />
              </div>

              <div className="space-y-5 p-5">
                <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-lg bg-surface p-3 dark:bg-surface-dark-muted">
                    <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                      Format version
                    </dt>
                    <dd className="mt-1 font-mono text-sm font-semibold text-content dark:text-content-inverse">
                      {validation.formatVersion ?? '—'}
                    </dd>
                  </div>
                  <div className="rounded-lg bg-surface p-3 dark:bg-surface-dark-muted">
                    <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                      Schema version
                    </dt>
                    <dd className="mt-1 font-mono text-sm font-semibold text-content dark:text-content-inverse">
                      {validation.schemaVersion ?? '—'}
                    </dd>
                  </div>
                  <div className="rounded-lg bg-surface p-3 dark:bg-surface-dark-muted">
                    <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                      Replacement slices
                    </dt>
                    <dd className="mt-1 text-sm font-semibold text-content dark:text-content-inverse">
                      {replacementSlices.length}
                    </dd>
                  </div>
                  <div className="rounded-lg bg-surface p-3 dark:bg-surface-dark-muted">
                    <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                      Validation expires
                    </dt>
                    <dd className="mt-1 text-sm font-semibold text-content dark:text-content-inverse">
                      {formatDateTime(validation.expiresAt)}
                    </dd>
                  </div>
                </dl>

                {replacementSlices.length > 0 ? (
                  <div>
                    <h4 className="text-sm font-semibold text-content dark:text-content-inverse">
                      Governed slices to replace
                    </h4>
                    <ul className="mt-3 flex flex-wrap gap-2">
                      {replacementSlices.map((sliceName) => (
                        <li
                          key={sliceName}
                          className="rounded-full border border-border-strong bg-surface px-3 py-1 font-mono text-xs font-semibold text-content dark:border-border-dark-strong dark:bg-surface-dark-muted dark:text-content-inverse"
                        >
                          {sliceName}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {recordCounts.length > 0 ? (
                  <div>
                    <h4 className="text-sm font-semibold text-content dark:text-content-inverse">
                      Local record preview
                    </h4>
                    <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {recordCounts.map(([name, count]) => (
                        <div
                          key={name}
                          className="flex items-center justify-between gap-4 rounded-lg bg-surface p-3 dark:bg-surface-dark-muted"
                        >
                          <dt className="break-all font-mono text-xs text-content-muted dark:text-content-inverse-muted">
                            {name}
                          </dt>
                          <dd className="font-semibold tabular-nums text-content dark:text-content-inverse">
                            {formatNumber(count)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                ) : null}

                {validationWarnings.length > 0 ? (
                  <div className="rounded-lg border border-warning-200 bg-warning-50 p-4 text-warning-700 dark:border-warning-700 dark:bg-warning-950 dark:text-warning-100">
                    <h4 className="text-sm font-semibold">
                      Validation warnings
                    </h4>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5">
                      {validationWarnings.map((warning, index) => (
                        <li key={getIssueKey(warning, index)}>
                          {typeof warning === 'string'
                            ? warning
                            : getIssueMessage(warning)}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <button
                  className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-danger-600 bg-danger-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-danger-700 focus:outline-none focus:ring-2 focus:ring-danger-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:focus:ring-offset-surface-dark"
                  type="button"
                  disabled={
                    pending ||
                    validationToken === null ||
                    applySnapshot === null
                  }
                  onClick={() => {
                    clearFeedback();
                    setApplyDialogOpen(true);
                  }}
                >
                  <DatabaseBackup
                    className="h-4 w-4"
                    aria-hidden="true"
                  />
                  Replace local demo data
                </button>
              </div>
            </div>
          ) : null}
        </section>
      ) : (
        <section
          className="mt-8 rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted sm:p-6"
          aria-labelledby="snapshot-read-only-heading"
        >
          <div className="flex items-start gap-3">
            <ShieldAlert
              className="mt-0.5 h-5 w-5 shrink-0 text-content-subtle dark:text-content-inverse-muted"
              aria-hidden="true"
            />
            <div>
              <h2
                id="snapshot-read-only-heading"
                className="text-lg font-semibold text-content dark:text-content-inverse"
              >
                Snapshot replacement is Administrator-only
              </h2>
              <p className="mt-1 text-sm leading-6 text-content-muted dark:text-content-inverse-muted">
                The ITS demo role may export permitted platform
                diagnostics. Local snapshot validation,
                replacement, and canonical sample restore are not
                available for this role.
              </p>
            </div>
          </div>
        </section>
      )}

      {canReplace ? (
        <section
          className="mt-8 rounded-xl border border-warning-200 bg-warning-50 p-5 shadow-card dark:border-warning-700 dark:bg-warning-950 sm:p-6"
          aria-labelledby="sample-restore-heading"
          aria-busy={restorePending}
        >
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex items-start gap-3">
              <RefreshCw
                className="mt-0.5 h-5 w-5 shrink-0 text-warning-700 dark:text-warning-100"
                aria-hidden="true"
              />
              <div>
                <h2
                  id="sample-restore-heading"
                  className="text-xl font-semibold text-content dark:text-content-inverse"
                >
                  Restore canonical sample data
                </h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-warning-700 dark:text-warning-100">
                  Restore the bundled fictional users, settings,
                  audits, preferences, monitoring, operations,
                  claims, documents, and insight fixtures. Current
                  governed browser-local changes will be replaced.
                </p>
                <p className="mt-2 text-xs leading-5 text-warning-700 dark:text-warning-100">
                  The active session is preserved only when its
                  seeded user and role remain valid.
                </p>
              </div>
            </div>

            <button
              className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-danger-600 bg-danger-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-danger-700 focus:outline-none focus:ring-2 focus:ring-danger-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:focus:ring-offset-warning-950"
              type="button"
              disabled={pending || restoreSample === null}
              onClick={() => {
                clearFeedback();
                setRestoreDialogOpen(true);
              }}
            >
              <RefreshCw
                className="h-4 w-4"
                aria-hidden="true"
              />
              Restore sample data
            </button>
          </div>
        </section>
      ) : null}

      <aside
        className="mt-8 rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted sm:p-6"
        role="note"
        aria-labelledby="quota-recovery-heading"
      >
        <div className="flex items-start gap-3">
          <HardDrive
            className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
            aria-hidden="true"
          />
          <div>
            <h2
              id="quota-recovery-heading"
              className="font-semibold text-content dark:text-content-inverse"
            >
              Browser storage and quota recovery
            </h2>
            <p className="mt-2 text-sm leading-6 text-content-muted dark:text-content-inverse-muted">
              Browser storage is best-effort and is not durable
              server storage. If a quota or persistence error
              occurs, avoid repeating destructive actions until
              you have preserved the current local evidence.
            </p>
            <ol className="mt-4 grid gap-3 text-sm text-content-muted dark:text-content-inverse-muted sm:grid-cols-3">
              <li className="rounded-lg bg-surface-muted p-4 dark:bg-surface-dark">
                <span className="block font-semibold text-content dark:text-content-inverse">
                  1. Export first
                </span>
                Download an authorized JSON snapshot before
                clearing browser data or restoring the baseline.
              </li>
              <li className="rounded-lg bg-surface-muted p-4 dark:bg-surface-dark">
                <span className="block font-semibold text-content dark:text-content-inverse">
                  2. Reduce local data
                </span>
                Remove unnecessary fictional records or old local
                exports, then retry only on an explicit user
                action.
              </li>
              <li className="rounded-lg bg-surface-muted p-4 dark:bg-surface-dark">
                <span className="block font-semibold text-content dark:text-content-inverse">
                  3. Restore if needed
                </span>
                An Administrator may restore canonical sample data
                after reviewing the destructive confirmation.
              </li>
            </ol>
          </div>
        </div>
      </aside>

      <aside
        className="mt-8 rounded-xl border border-warning-200 bg-warning-50 p-5 text-warning-700 shadow-card dark:border-warning-700 dark:bg-warning-950 dark:text-warning-100 sm:p-6"
        role="note"
        aria-label="Snapshot governance limitations"
      >
        <div className="flex items-start gap-3">
          <ShieldAlert
            className="mt-0.5 h-5 w-5 shrink-0"
            aria-hidden="true"
          />
          <div>
            <p className="font-semibold">
              Not production backup or recovery
            </p>
            <p className="mt-1 text-sm leading-6">
              Snapshot export, import validation, replacement, and
              sample restore are client-side demonstration
              controls. They do not provide encryption at rest,
              immutable retention, disaster recovery, secure
              authorization, database backup, or regulatory
              compliance.
            </p>
          </div>
        </div>
      </aside>

      <ConfirmDialog
        open={applyDialogOpen}
        title="Replace governed browser-local demo data?"
        description="This applies the validated fictional snapshot and replaces the listed governed slices. The operation cannot be undone from this page unless you previously exported a snapshot."
        confirmLabel="Replace local demo data"
        cancelLabel="Cancel"
        confirmationText={SNAPSHOT_CONFIRMATIONS.APPLY}
        destructive
        loading={applyPending}
        onConfirm={handleApply}
        onOpenChange={setApplyDialogOpen}
      >
        <div className="mt-3 rounded-lg border border-warning-200 bg-warning-50 p-3 text-xs leading-5 text-warning-700 dark:border-warning-700 dark:bg-warning-950 dark:text-warning-100">
          <p className="font-semibold">
            Replacement preview
          </p>
          <p className="mt-1">
            {replacementSlices.length}{' '}
            {replacementSlices.length === 1
              ? 'slice'
              : 'slices'}{' '}
            will be replaced. Active session data from the file
            will not be imported.
          </p>
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={restoreDialogOpen}
        title="Restore canonical fictional sample data?"
        description="This replaces governed browser-local changes with the bundled fictional baseline. Export the current state first if you may need it later."
        confirmLabel="Restore sample data"
        cancelLabel="Cancel"
        confirmationText={
          SNAPSHOT_CONFIRMATIONS.RESTORE_SAMPLE
        }
        destructive
        loading={restorePending}
        onConfirm={handleRestore}
        onOpenChange={setRestoreDialogOpen}
      />
    </div>
  );
}

SnapshotsPage.propTypes = {
  session: PropTypes.object,
  context: PropTypes.object,
  snapshotFacade: PropTypes.object,
  snapshotService: PropTypes.object,
  initialValidation: PropTypes.object,
  onExported: PropTypes.func,
  onValidated: PropTypes.func,
  onApplied: PropTypes.func,
  onRestored: PropTypes.func,
};

export const SnapshotManagementPage = SnapshotsPage;
export const GovernanceSnapshotsPage = SnapshotsPage;
export const LocalSnapshotsPage = SnapshotsPage;

export default SnapshotsPage;