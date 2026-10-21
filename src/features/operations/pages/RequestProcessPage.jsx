import PropTypes from 'prop-types';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  useNavigate,
  useParams,
} from 'react-router-dom';
import {
  ArrowLeft,
  CalendarClock,
  ChevronRight,
  FileText,
  Loader2,
  ReceiptText,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import PipelinePlayer from '../components/PipelinePlayer.jsx';
import AccessDenied from '../../../platform/components/AccessDenied.jsx';
import StatusBadge from '../../../platform/components/StatusBadge.jsx';
import { safeLogger } from '../../../platform/security/safeLogger.js';
import {
  formatDateTime,
  formatDuration,
  formatStatus,
} from '../../../platform/utils/formatters.js';
import { generateUuid } from '../../../platform/utils/ids.js';
import {
  isPlainObject,
  isPlatformRole,
} from '../../../platform/validation/schemas.js';

const TERMINAL_REQUEST_STATUSES = new Set([
  'COMPLETE',
  'FAILED',
  'CANCELLED',
]);

const RESUMABLE_REQUEST_STATUSES = new Set([
  'PAUSED',
  'FAILED',
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
    memberId:
      typeof source.memberId === 'string' &&
      source.memberId.trim().length > 0
        ? source.memberId.normalize('NFC').trim()
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

  return error;
}

function unwrapServiceResult(result, fallback) {
  if (result?.ok === false) {
    throw createServiceError(result, fallback);
  }

  return result?.ok === true ? result.data : result;
}

function normalizeRequestResult(result) {
  const value = unwrapServiceResult(
    result,
    'The browser-local reprint request could not be loaded.',
  );

  if (isPlainObject(value?.request)) {
    return value.request;
  }

  return isPlainObject(value) ? value : null;
}

function resolveRequestReader(service) {
  if (service === null || service === undefined) {
    return null;
  }

  if (typeof service.getRequestById === 'function') {
    return service.getRequestById.bind(service);
  }

  if (typeof service.getOwnedRequest === 'function') {
    return service.getOwnedRequest.bind(service);
  }

  if (typeof service.findRequestById === 'function') {
    return service.findRequestById.bind(service);
  }

  if (typeof service.get === 'function') {
    return service.get.bind(service);
  }

  return null;
}

function resolveProcessMethod(service) {
  if (service === null || service === undefined) {
    return null;
  }

  if (typeof service.processRequest === 'function') {
    return service.processRequest.bind(service);
  }

  if (typeof service.process === 'function') {
    return service.process.bind(service);
  }

  if (typeof service.run === 'function') {
    return service.run.bind(service);
  }

  return null;
}

function resolveResumeMethod(service) {
  if (service === null || service === undefined) {
    return null;
  }

  if (typeof service.resumeRequest === 'function') {
    return service.resumeRequest.bind(service);
  }

  if (typeof service.resume === 'function') {
    return service.resume.bind(service);
  }

  return null;
}

function resolveCancelMethod(service) {
  if (service === null || service === undefined) {
    return null;
  }

  if (typeof service.cancel === 'function') {
    return service.cancel.bind(service);
  }

  if (typeof service.stop === 'function') {
    return service.stop.bind(service);
  }

  return null;
}

function readRepositorySnapshot(repository) {
  if (repository === null || repository === undefined) {
    return null;
  }

  if (typeof repository.getSnapshot === 'function') {
    return repository.getSnapshot();
  }

  if (typeof repository.getState === 'function') {
    return repository.getState();
  }

  if (typeof repository.read === 'function') {
    return repository.read();
  }

  if (typeof repository.load === 'function') {
    return repository.load();
  }

  return null;
}

function findRequestInRepository(repository, requestId) {
  if (repository === null || repository === undefined) {
    return null;
  }

  if (typeof repository.getRequestById === 'function') {
    return repository.getRequestById(requestId);
  }

  if (typeof repository.findRequestById === 'function') {
    return repository.findRequestById(requestId);
  }

  const snapshot = readRepositorySnapshot(repository);
  const envelope =
    snapshot?.envelope ??
    snapshot?.operationsEnvelope ??
    snapshot?.persistent ??
    snapshot;

  return (
    envelope?.requests?.[requestId] ??
    snapshot?.requests?.[requestId] ??
    null
  );
}

function findPipelineRun(repository, requestId) {
  if (repository === null || repository === undefined) {
    return null;
  }

  if (
    typeof repository.getPipelineRunByRequestId === 'function'
  ) {
    return repository.getPipelineRunByRequestId(requestId);
  }

  const snapshot = readRepositorySnapshot(repository);
  const envelope =
    snapshot?.envelope ??
    snapshot?.operationsEnvelope ??
    snapshot?.persistent ??
    snapshot;
  const values = Object.values(
    envelope?.pipelineRuns ??
      snapshot?.pipelineRuns ??
      {},
  );

  return (
    values
      .filter((run) => run?.requestId === requestId)
      .sort((left, right) => {
        const leftTime = Date.parse(
          left.updatedAt ?? left.startedAt ?? 0,
        );
        const rightTime = Date.parse(
          right.updatedAt ?? right.startedAt ?? 0,
        );

        return rightTime - leftTime;
      })[0] ?? null
  );
}

function getDocumentIds(request, operationResult) {
  const ids = [
    ...(Array.isArray(request?.documentReferences)
      ? request.documentReferences
      : []),
    ...(Array.isArray(operationResult?.documentIds)
      ? operationResult.documentIds
      : []),
  ];

  return [...new Set(ids.filter(
    (value) =>
      typeof value === 'string' &&
      value.trim().length > 0,
  ))];
}

function isAuthorizationError(error) {
  return [
    'AUTHENTICATION_REQUIRED',
    'FORBIDDEN',
    'PERMISSION_DENIED',
    'ACTION_FORBIDDEN',
  ].includes(error?.code);
}

function getRequestDuration(request) {
  if (
    typeof request?.processingTimeMs === 'number' &&
    Number.isFinite(request.processingTimeMs) &&
    request.processingTimeMs >= 0
  ) {
    return formatDuration(request.processingTimeMs);
  }

  if (
    typeof request?.startedAt === 'string' &&
    typeof request?.completedAt === 'string'
  ) {
    const duration =
      Date.parse(request.completedAt) -
      Date.parse(request.startedAt);

    if (Number.isFinite(duration) && duration >= 0) {
      return formatDuration(duration);
    }
  }

  return '—';
}

/**
 * Deterministic request-processing route with resumable pipeline playback.
 *
 * @param {{
 *   requestId?: string,
 *   session?: Record<string, unknown>|null,
 *   context?: Record<string, unknown>|null,
 *   requestService?: object,
 *   pipelineOrchestrator?: object,
 *   pipelineService?: object,
 *   operationsRepository?: object,
 *   operationsStore?: object,
 *   repository?: object,
 *   initialRequest?: Record<string, unknown>|null,
 *   initialPipelineRun?: Record<string, unknown>|null,
 *   autoStart?: boolean,
 *   onNavigate?: Function,
 *   onCompleted?: Function
 * }} props Component props.
 * @returns {JSX.Element} Request processing page.
 */
export function RequestProcessPage({
  requestId,
  session = null,
  context = null,
  requestService = null,
  pipelineOrchestrator = null,
  pipelineService = null,
  operationsRepository = null,
  operationsStore = null,
  repository = null,
  initialRequest = null,
  initialPipelineRun = null,
  autoStart = true,
  onNavigate,
  onCompleted,
}) {
  const routeParams = useParams();
  const navigate = useNavigate();
  const headingId = useId();
  const feedbackId = useId();
  const mountedRef = useRef(true);
  const activeOperationRef = useRef(null);
  const autoStartedRef = useRef(new Set());
  const resolvedRequestId =
    requestId ??
    routeParams.requestId ??
    routeParams.id ??
    '';
  const accessContext = useMemo(
    () => normalizeContext(context ?? session),
    [context, session],
  );
  const authenticated = accessContext !== null;
  const processor =
    pipelineOrchestrator ?? pipelineService;
  const dataRepository =
    operationsRepository ??
    operationsStore ??
    repository;
  const [request, setRequest] = useState(initialRequest);
  const [pipelineRun, setPipelineRun] = useState(
    initialPipelineRun,
  );
  const [operationResult, setOperationResult] =
    useState(null);
  const [loading, setLoading] = useState(
    initialRequest === null,
  );
  const [processing, setProcessing] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [operationError, setOperationError] = useState(null);
  const [operationMessage, setOperationMessage] =
    useState(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [navigationPending, setNavigationPending] =
    useState(null);

  const loadEvidence = useCallback(
    async (showLoading = false) => {
      if (!authenticated) {
        setLoading(false);
        return null;
      }

      if (
        typeof resolvedRequestId !== 'string' ||
        resolvedRequestId.trim().length === 0
      ) {
        setLoading(false);
        setLoadError(
          'A browser-local reprint request identifier is required.',
        );
        return null;
      }

      if (showLoading) {
        setLoading(true);
      }

      const identifier =
        resolvedRequestId.normalize('NFC').trim();

      try {
        const reader = resolveRequestReader(requestService);
        let loadedRequest = null;

        if (reader !== null) {
          loadedRequest = normalizeRequestResult(
            await Promise.resolve(
              reader(identifier, accessContext),
            ),
          );
        } else {
          loadedRequest =
            initialRequest ??
            findRequestInRepository(
              dataRepository,
              identifier,
            );
        }

        if (!mountedRef.current) {
          return null;
        }

        if (loadedRequest === null) {
          setRequest(null);
          setPipelineRun(null);
          setLoadError(
            'The reprint request is unavailable for the current demo role.',
          );
          return null;
        }

        const loadedRun =
          findPipelineRun(dataRepository, identifier) ??
          (initialPipelineRun?.requestId === identifier
            ? initialPipelineRun
            : null);

        setRequest(loadedRequest);
        setPipelineRun(loadedRun);
        setLoadError(null);
        setAccessDenied(false);

        return {
          request: loadedRequest,
          pipelineRun: loadedRun,
        };
      } catch (error) {
        if (!mountedRef.current) {
          return null;
        }

        if (isAuthorizationError(error)) {
          setAccessDenied(true);
          setRequest(null);
          setPipelineRun(null);
          return null;
        }

        setLoadError(
          normalizeErrorMessage(
            error,
            'The browser-local reprint request could not be loaded.',
          ),
        );
        return null;
      } finally {
        if (mountedRef.current) {
          setLoading(false);
        }
      }
    },
    [
      accessContext,
      authenticated,
      dataRepository,
      initialPipelineRun,
      initialRequest,
      requestService,
      resolvedRequestId,
    ],
  );

  const runPipelineOperation = useCallback(
    async (kind, suppliedCommand = {}) => {
      const method =
        kind === 'RESUME'
          ? resolveResumeMethod(processor)
          : resolveProcessMethod(processor);

      if (method === null) {
        throw new Error(
          kind === 'RESUME'
            ? 'Pipeline resume is unavailable in this application composition.'
            : 'Pipeline processing is unavailable in this application composition.',
        );
      }

      const command = {
        ...suppliedCommand,
        requestId: resolvedRequestId,
        mode: 'COMPRESSED',
        scenario:
          suppliedCommand.scenario ??
          pipelineRun?.scenario ??
          'SUCCESS',
        idempotencyKey: generateUuid(),
      };

      activeOperationRef.current = {
        kind,
        requestId: resolvedRequestId,
      };

      if (mountedRef.current) {
        setProcessing(true);
        setOperationError(null);
        setOperationMessage(
          kind === 'RESUME'
            ? 'Resuming deterministic pipeline playback…'
            : 'Starting deterministic pipeline playback…',
        );
      }

      try {
        const result = await Promise.resolve(
          method(command, accessContext),
        );
        const data = unwrapServiceResult(
          result,
          kind === 'RESUME'
            ? 'Pipeline playback could not be resumed.'
            : 'Pipeline playback could not be started.',
        );

        if (mountedRef.current) {
          setOperationResult(
            isPlainObject(data) ? data : null,
          );
          setOperationMessage(
            data?.status === 'COMPLETE'
              ? 'Deterministic processing completed locally.'
              : data?.status === 'MANUAL_REVIEW'
                ? 'Pipeline playback stopped for authorized manual review.'
                : data?.status === 'FAILED'
                  ? 'Pipeline playback retained its failure evidence locally.'
                  : kind === 'RESUME'
                    ? 'Pipeline playback resumed from its checkpoint.'
                    : 'Pipeline playback started locally.',
          );

          await loadEvidence(false);

          if (
            data?.status === 'COMPLETE' &&
            typeof onCompleted === 'function'
          ) {
            await Promise.resolve(
              onCompleted(data, result),
            );
          }
        }

        return result;
      } catch (error) {
        if (
          error?.code === 'RUN_ALREADY_ACTIVE'
        ) {
          if (mountedRef.current) {
            setOperationMessage(
              'Deterministic pipeline playback is already active.',
            );
            await loadEvidence(false);
          }

          return {
            ok: true,
            data: {
              requestId: resolvedRequestId,
              status: 'PROCESSING',
              replayed: true,
            },
          };
        }

        if (mountedRef.current) {
          setOperationError(
            normalizeErrorMessage(
              error,
              kind === 'RESUME'
                ? 'Pipeline playback could not be resumed.'
                : 'Pipeline playback could not be started.',
            ),
          );
          setOperationMessage(null);
          await loadEvidence(false);
        }

        throw error;
      } finally {
        activeOperationRef.current = null;

        if (mountedRef.current) {
          setProcessing(false);
        }
      }
    },
    [
      accessContext,
      loadEvidence,
      onCompleted,
      pipelineRun?.scenario,
      processor,
      resolvedRequestId,
    ],
  );

  useEffect(() => {
    mountedRef.current = true;

    loadEvidence(initialRequest === null).catch((error) => {
      if (mountedRef.current) {
        setLoading(false);
        setLoadError(
          normalizeErrorMessage(
            error,
            'The browser-local reprint request could not be loaded.',
          ),
        );
      }
    });

    return () => {
      mountedRef.current = false;
    };
  }, [initialRequest, loadEvidence]);

  useEffect(() => {
    if (
      dataRepository === null ||
      dataRepository === undefined ||
      typeof dataRepository.subscribe !== 'function'
    ) {
      return undefined;
    }

    const unsubscribe = dataRepository.subscribe(() => {
      if (mountedRef.current) {
        loadEvidence(false).catch((error) => {
          if (mountedRef.current) {
            setOperationError(
              normalizeErrorMessage(
                error,
                'Updated pipeline evidence could not be loaded.',
              ),
            );
          }
        });
      }
    });

    return typeof unsubscribe === 'function'
      ? unsubscribe
      : undefined;
  }, [dataRepository, loadEvidence]);

  useEffect(() => {
    if (
      !autoStart ||
      !authenticated ||
      loading ||
      processing ||
      request?.status !== 'PENDING' ||
      autoStartedRef.current.has(resolvedRequestId)
    ) {
      return;
    }

    autoStartedRef.current.add(resolvedRequestId);

    runPipelineOperation('PROCESS').catch((error) => {
      if (
        mountedRef.current &&
        error?.code !== 'RUN_ALREADY_ACTIVE'
      ) {
        setOperationError(
          normalizeErrorMessage(
            error,
            'Deterministic pipeline playback could not be started.',
          ),
        );
      }
    });
  }, [
    authenticated,
    autoStart,
    loading,
    processing,
    request?.status,
    resolvedRequestId,
    runPipelineOperation,
  ]);

  useEffect(
    () => () => {
      const activeOperation = activeOperationRef.current;
      const cancel = resolveCancelMethod(processor);

      if (
        activeOperation === null ||
        cancel === null
      ) {
        return;
      }

      try {
        cancel(activeOperation.requestId);
      } catch {
        safeLogger.warn('PIPELINE_CANCEL_FAILED');
      }
    },
    [processor],
  );

  const handlePause = useCallback(async () => {
    const cancel = resolveCancelMethod(processor);

    if (cancel === null) {
      throw new Error(
        'Pipeline pause is unavailable in this application composition.',
      );
    }

    const cancelled = await Promise.resolve(
      cancel(resolvedRequestId),
    );

    if (cancelled === false) {
      throw new Error(
        'Pipeline playback is no longer active.',
      );
    }

    if (mountedRef.current) {
      setOperationMessage(
        'Pipeline pause requested. Completed stage evidence will be retained.',
      );
      setOperationError(null);
    }

    return {
      ok: true,
      data: {
        requestId: resolvedRequestId,
        status: 'PAUSED',
      },
    };
  }, [processor, resolvedRequestId]);

  const handleResume = useCallback(
    async (command) =>
      runPipelineOperation('RESUME', {
        expectedCheckpoint:
          command.expectedCheckpoint ??
          pipelineRun?.checkpoint?.step ??
          pipelineRun?.currentStep,
      }),
    [
      pipelineRun?.checkpoint?.step,
      pipelineRun?.currentStep,
      runPipelineOperation,
    ],
  );

  const handleNavigation = useCallback(
    async (event, destination, key) => {
      if (typeof onNavigate !== 'function') {
        return;
      }

      event.preventDefault();
      setNavigationPending(key);
      setOperationError(null);

      try {
        await Promise.resolve(
          onNavigate(destination, event),
        );
      } catch (error) {
        setOperationError(
          normalizeErrorMessage(
            error,
            'The selected browser-local route could not be opened.',
          ),
        );
      } finally {
        setNavigationPending(null);
      }
    },
    [onNavigate],
  );

  if (!authenticated) {
    return <AccessDenied authenticated={false} />;
  }

  if (accessDenied) {
    return <AccessDenied authenticated />;
  }

  if (loading) {
    return (
      <main
        className="mx-auto flex min-h-[50vh] w-full max-w-3xl items-center justify-center px-4 py-10 sm:px-6"
        aria-busy="true"
      >
        <section
          className="w-full rounded-xl border border-border bg-surface p-8 text-center shadow-card dark:border-border-dark dark:bg-surface-dark-muted"
          role="status"
        >
          <Loader2
            className="mx-auto h-7 w-7 animate-spin text-primary-600 motion-reduce:animate-none"
            aria-hidden="true"
          />
          <p className="mt-3 font-medium text-content dark:text-content-inverse">
            Loading request processing evidence
          </p>
          <p className="mt-2 text-sm text-content-muted dark:text-content-inverse-muted">
            Reading browser-local deterministic workflow state.
          </p>
        </section>
      </main>
    );
  }

  if (loadError !== null || request === null) {
    return (
      <main className="mx-auto flex min-h-[50vh] w-full max-w-3xl items-center justify-center px-4 py-10 sm:px-6">
        <section
          className="w-full rounded-xl border border-border bg-surface p-6 text-center shadow-card dark:border-border-dark dark:bg-surface-dark-muted sm:p-8"
          role="alert"
        >
          <ShieldAlert
            className="mx-auto h-8 w-8 text-content-subtle dark:text-content-inverse-muted"
            aria-hidden="true"
          />
          <h1 className="mt-3 text-xl font-semibold text-content dark:text-content-inverse">
            Request processing unavailable
          </h1>
          <p className="mt-2 text-sm text-content-muted dark:text-content-inverse-muted">
            {loadError ??
              'The request may be unavailable, or the current demo role may not have access.'}
          </p>
          <button
            className="mt-5 inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-primary-600 bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
            type="button"
            onClick={() => {
              loadEvidence(true).catch((error) => {
                setLoadError(
                  normalizeErrorMessage(
                    error,
                    'The browser-local reprint request could not be loaded.',
                  ),
                );
              });
            }}
          >
            <RefreshCw
              className="h-4 w-4"
              aria-hidden="true"
            />
            Try again
          </button>
        </section>
      </main>
    );
  }

  const requestStatus =
    request.status ?? pipelineRun?.status ?? 'PENDING';
  const requestComplete = requestStatus === 'COMPLETE';
  const requestFailed = requestStatus === 'FAILED';
  const manualReview =
    requestStatus === 'MANUAL_REVIEW';
  const requestTerminal =
    TERMINAL_REQUEST_STATUSES.has(requestStatus);
  const canResume =
    RESUMABLE_REQUEST_STATUSES.has(requestStatus) &&
    pipelineRun?.checkpoint?.resumable !== false;
  const canPause =
    requestStatus === 'PROCESSING' &&
    resolveCancelMethod(processor) !== null;
  const canStart =
    requestStatus === 'PENDING' &&
    resolveProcessMethod(processor) !== null;
  const documentIds = getDocumentIds(
    request,
    operationResult,
  );
  const errorReportId =
    request.errorReportId ??
    operationResult?.errorReportId ??
    null;
  const reviewId =
    operationResult?.reviewId ??
    pipelineRun?.checkpoint?.reviewId ??
    null;
  const queueHref = '/operations/queue';

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
      <a
        className="inline-flex min-h-10 items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-content-muted transition hover:bg-surface hover:text-content focus:outline-none focus:ring-2 focus:ring-primary-500 dark:text-content-inverse-muted dark:hover:bg-surface-dark-muted dark:hover:text-content-inverse"
        href={queueHref}
        onClick={(event) => {
          handleNavigation(
            event,
            {
              type: 'OPERATIONS_QUEUE',
              href: queueHref,
            },
            'queue',
          ).catch((error) => {
            setOperationError(
              normalizeErrorMessage(
                error,
                'The operations queue could not be opened.',
              ),
            );
          });
        }}
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to operations queue
      </a>

      <header
        className="mt-4 overflow-hidden rounded-2xl border border-primary-200 bg-primary-50 shadow-card dark:border-primary-800 dark:bg-primary-950"
        aria-labelledby={headingId}
      >
        <div className="grid gap-5 px-5 py-6 sm:px-7 sm:py-8 lg:grid-cols-[1fr_auto] lg:items-center">
          <div className="flex min-w-0 items-start gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-600 text-white shadow-sm">
              <ReceiptText
                className="h-6 w-6"
                aria-hidden="true"
              />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-primary-700 dark:text-primary-300">
                Deterministic request processing
              </p>
              <h1
                id={headingId}
                className="mt-1 break-all font-mono text-2xl font-semibold tracking-tight text-content dark:text-content-inverse sm:text-3xl"
              >
                {request.displayId ?? request.requestId}
              </h1>
              <p className="mt-2 text-sm text-content-muted dark:text-content-inverse-muted">
                Claim{' '}
                <span className="font-mono font-medium">
                  {request.claimNumber ?? 'Restricted'}
                </span>{' '}
                · {formatStatus(request.requestType)}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            <StatusBadge status={requestStatus} />
            {canStart && !processing ? (
              <button
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-primary-600 bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
                type="button"
                onClick={() => {
                  runPipelineOperation('PROCESS').catch(
                    (error) => {
                      setOperationError(
                        normalizeErrorMessage(
                          error,
                          'Pipeline playback could not be started.',
                        ),
                      );
                    },
                  );
                }}
              >
                <ReceiptText
                  className="h-4 w-4"
                  aria-hidden="true"
                />
                Start playback
              </button>
            ) : null}
          </div>
        </div>
      </header>

      <aside
        className="mt-5 rounded-xl border border-primary-200 bg-primary-50 p-4 text-sm text-primary-900 dark:border-primary-800 dark:bg-primary-950 dark:text-primary-100"
        role="note"
        aria-label="Pipeline processing disclosure"
      >
        <div className="flex items-start gap-3">
          <ShieldCheck
            className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
            aria-hidden="true"
          />
          <div>
            <p className="font-semibold">
              Browser-local compressed playback
            </p>
            <p className="mt-1 leading-6">
              Printed minute labels represent the fictional
              workflow while playback uses compressed local timing.
              Completed checkpoints are retained for safe resume.
              No payer, healthcare, document-delivery, payment, or
              integration system is contacted.
            </p>
          </div>
        </div>
      </aside>

      {operationError !== null ? (
        <div
          id={feedbackId}
          className="mt-5 rounded-lg border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700 dark:border-danger-700 dark:bg-danger-950 dark:text-danger-100"
          role="alert"
        >
          {operationError}
        </div>
      ) : null}

      {operationMessage !== null ? (
        <div
          className="mt-5 rounded-lg border border-success-200 bg-success-50 px-4 py-3 text-sm text-success-700 dark:border-success-700 dark:bg-surface-dark dark:text-success-100"
          role="status"
          aria-live="polite"
        >
          {processing ? (
            <Loader2
              className="mr-2 inline h-4 w-4 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
          ) : null}
          {operationMessage}
        </div>
      ) : null}

      <section
        className="mt-6 rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted sm:p-6"
        aria-labelledby="request-evidence-heading"
      >
        <div className="flex items-start gap-3">
          <CalendarClock
            className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
            aria-hidden="true"
          />
          <div>
            <h2
              id="request-evidence-heading"
              className="text-lg font-semibold text-content dark:text-content-inverse"
            >
              Request evidence
            </h2>
            <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
              Immutable identifiers and locally retained processing
              timestamps.
            </p>
          </div>
        </div>

        <dl className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['Request ID', request.requestId],
            ['Member ID', request.memberId],
            ['Priority', formatStatus(request.priority)],
            ['Source', formatStatus(request.sourceType)],
            ['Created', formatDateTime(request.createdAt)],
            ['Started', formatDateTime(request.startedAt)],
            ['Completed', formatDateTime(request.completedAt)],
            ['Processing time', getRequestDuration(request)],
          ].map(([label, value]) => (
            <div
              key={label}
              className="rounded-lg bg-surface-muted p-4 dark:bg-surface-dark"
            >
              <dt className="text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
                {label}
              </dt>
              <dd
                className={`mt-1 break-all text-sm font-medium text-content dark:text-content-inverse ${
                  label.endsWith('ID') ? 'font-mono' : ''
                }`}
              >
                {value ?? '—'}
              </dd>
            </div>
          ))}
        </dl>

        {request.result ? (
          <div className="mt-4 rounded-lg border border-border bg-surface-muted p-4 dark:border-border-dark dark:bg-surface-dark">
            <p className="text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
              Latest result
            </p>
            <p className="mt-2 text-sm leading-6 text-content dark:text-content-inverse">
              {request.result}
            </p>
          </div>
        ) : null}
      </section>

      <div className="mt-6">
        <PipelinePlayer
          value={
            pipelineRun ?? {
              requestId: request.requestId,
              status: requestStatus,
              currentStep: request.currentStep ?? 'REQUEST',
              completedSteps: [],
              stepResults: [],
              validationChecks: [],
            }
          }
          requestId={request.requestId}
          loading={processing}
          disabled={processing}
          onPause={canPause ? handlePause : undefined}
          onResume={canResume ? handleResume : undefined}
        />
      </div>

      {manualReview ? (
        <section
          className="mt-6 rounded-xl border border-warning-200 bg-warning-50 p-5 shadow-card dark:border-warning-700 dark:bg-warning-950 sm:p-6"
          aria-labelledby="manual-review-heading"
        >
          <h2
            id="manual-review-heading"
            className="text-lg font-semibold text-warning-700 dark:text-warning-100"
          >
            Authorized manual review required
          </h2>
          <p className="mt-2 text-sm leading-6 text-warning-700 dark:text-warning-100">
            Pipeline evidence is retained at the business-rules
            checkpoint. An authorized BOS or Admin demo role must
            decide the review before document generation resumes.
          </p>
          <a
            className="mt-4 inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-warning-700 bg-surface px-4 py-2 text-sm font-semibold text-warning-700 transition hover:bg-warning-100 focus:outline-none focus:ring-2 focus:ring-warning-500 dark:bg-surface-dark dark:text-warning-100"
            href="/operations/reviews"
            onClick={(event) => {
              handleNavigation(
                event,
                {
                  type: 'MANUAL_REVIEW',
                  href: '/operations/reviews',
                  reviewId,
                  requestId: request.requestId,
                },
                'review',
              ).catch((error) => {
                setOperationError(
                  normalizeErrorMessage(
                    error,
                    'The manual review route could not be opened.',
                  ),
                );
              });
            }}
          >
            Open manual reviews
            {navigationPending === 'review' ? (
              <Loader2
                className="h-4 w-4 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : (
              <ChevronRight
                className="h-4 w-4"
                aria-hidden="true"
              />
            )}
          </a>
        </section>
      ) : null}

      {requestTerminal ? (
        <section
          className="mt-6 rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted sm:p-6"
          aria-labelledby="terminal-navigation-heading"
        >
          <h2
            id="terminal-navigation-heading"
            className="text-lg font-semibold text-content dark:text-content-inverse"
          >
            Processing outcome
          </h2>
          <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
            Open retained evidence associated with this local
            terminal state.
          </p>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {requestComplete && documentIds.length > 0
              ? documentIds.map((documentId) => {
                  const href = `/documents/${encodeURIComponent(
                    documentId,
                  )}`;
                  const key = `document-${documentId}`;

                  return (
                    <a
                      key={documentId}
                      className="flex min-h-24 items-center justify-between gap-3 rounded-lg border border-border-strong bg-surface p-4 text-sm font-semibold text-content transition hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse dark:hover:bg-surface-dark-raised"
                      href={href}
                      onClick={(event) => {
                        handleNavigation(
                          event,
                          {
                            type: 'DOCUMENT',
                            href,
                            documentId,
                          },
                          key,
                        ).catch((error) => {
                          setOperationError(
                            normalizeErrorMessage(
                              error,
                              'The representative document could not be opened.',
                            ),
                          );
                        });
                      }}
                    >
                      <span className="inline-flex min-w-0 items-center gap-3">
                        <FileText
                          className="h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
                          aria-hidden="true"
                        />
                        <span className="min-w-0">
                          <span className="block">
                            Representative document
                          </span>
                          <span className="mt-1 block truncate font-mono text-xs font-normal text-content-subtle dark:text-content-inverse-muted">
                            {documentId}
                          </span>
                        </span>
                      </span>
                      {navigationPending === key ? (
                        <Loader2
                          className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none"
                          aria-hidden="true"
                        />
                      ) : (
                        <ChevronRight
                          className="h-4 w-4 shrink-0"
                          aria-hidden="true"
                        />
                      )}
                    </a>
                  );
                })
              : null}

            {requestFailed && errorReportId !== null ? (
              <a
                className="flex min-h-24 items-center justify-between gap-3 rounded-lg border border-danger-200 bg-danger-50 p-4 text-sm font-semibold text-danger-700 transition hover:bg-danger-100 focus:outline-none focus:ring-2 focus:ring-danger-500 dark:border-danger-700 dark:bg-danger-950 dark:text-danger-100"
                href={`/operations/errors/${encodeURIComponent(
                  errorReportId,
                )}`}
                onClick={(event) => {
                  const href =
                    `/operations/errors/${encodeURIComponent(
                      errorReportId,
                    )}`;

                  handleNavigation(
                    event,
                    {
                      type: 'ERROR_REPORT',
                      href,
                      errorReportId,
                    },
                    'error-report',
                  ).catch((error) => {
                    setOperationError(
                      normalizeErrorMessage(
                        error,
                        'The error report could not be opened.',
                      ),
                    );
                  });
                }}
              >
                <span className="inline-flex min-w-0 items-center gap-3">
                  <ShieldAlert
                    className="h-5 w-5 shrink-0"
                    aria-hidden="true"
                  />
                  <span className="min-w-0">
                    <span className="block">
                      Open error report
                    </span>
                    <span className="mt-1 block truncate font-mono text-xs font-normal">
                      {errorReportId}
                    </span>
                  </span>
                </span>
                {navigationPending === 'error-report' ? (
                  <Loader2
                    className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                ) : (
                  <ChevronRight
                    className="h-4 w-4 shrink-0"
                    aria-hidden="true"
                  />
                )}
              </a>
            ) : null}

            <a
              className="flex min-h-24 items-center justify-between gap-3 rounded-lg border border-border-strong bg-surface p-4 text-sm font-semibold text-content transition hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse dark:hover:bg-surface-dark-raised"
              href={queueHref}
              onClick={(event) => {
                handleNavigation(
                  event,
                  {
                    type: 'OPERATIONS_QUEUE',
                    href: queueHref,
                  },
                  'terminal-queue',
                ).catch((error) => {
                  setOperationError(
                    normalizeErrorMessage(
                      error,
                      'The operations queue could not be opened.',
                    ),
                  );
                });
              }}
            >
              <span>Return to operations queue</span>
              {navigationPending === 'terminal-queue' ? (
                <Loader2
                  className="h-4 w-4 animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              ) : (
                <ChevronRight
                  className="h-4 w-4"
                  aria-hidden="true"
                />
              )}
            </a>
          </div>
        </section>
      ) : null}

      <aside
        className="mt-8 rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted sm:p-6"
        role="note"
        aria-label="Request processing evidence disclaimer"
      >
        <div className="flex items-start gap-3">
          <ShieldCheck
            className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
            aria-hidden="true"
          />
          <div>
            <p className="font-semibold text-content dark:text-content-inverse">
              Fictional processing evidence
            </p>
            <p className="mt-1 text-sm leading-6 text-content-muted dark:text-content-inverse-muted">
              Request status, stage outcomes, documents, reports,
              timing, and navigation targets are browser-local
              demonstration records. They do not represent a live
              coverage, benefit, healthcare, payment, appeal, or
              delivery decision.
            </p>
          </div>
        </div>
      </aside>
    </div>
  );
}

RequestProcessPage.propTypes = {
  requestId: PropTypes.string,
  session: PropTypes.object,
  context: PropTypes.object,
  requestService: PropTypes.object,
  pipelineOrchestrator: PropTypes.object,
  pipelineService: PropTypes.object,
  operationsRepository: PropTypes.object,
  operationsStore: PropTypes.object,
  repository: PropTypes.object,
  initialRequest: PropTypes.object,
  initialPipelineRun: PropTypes.object,
  autoStart: PropTypes.bool,
  onNavigate: PropTypes.func,
  onCompleted: PropTypes.func,
};

export const RequestProcessingPage = RequestProcessPage;
export const ReprintRequestProcessPage = RequestProcessPage;
export const PipelineProcessPage = RequestProcessPage;

export default RequestProcessPage;