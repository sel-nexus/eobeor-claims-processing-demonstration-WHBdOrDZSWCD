import PropTypes from 'prop-types';
import {
  useEffect,
  useId,
  useMemo,
  useState,
} from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ClipboardList,
  Download,
  FileSearch,
  Filter,
  Loader2,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  INITIAL_AUDIT_EVENTS,
} from '../../../fixtures/seedBundle.js';
import AccessDenied from '../../../platform/components/AccessDenied.jsx';
import StatusBadge from '../../../platform/components/StatusBadge.jsx';
import { downloadBlob } from '../../../platform/utils/download.js';
import {
  formatCsv,
  formatDateTime,
  formatStatus,
} from '../../../platform/utils/formatters.js';
import { maskObject } from '../../../platform/security/maskingPolicy.js';
import {
  isPlainObject,
  isPlatformRole,
} from '../../../platform/validation/schemas.js';

const AUTHORIZED_ROLES = new Set(['ITS', 'ADMIN']);
const EMPTY_COLLECTION = Object.freeze([]);
const AUDIT_EXPORT_NOTICE = 'Fictional demo data';
const DEFAULT_PAGE_SIZE = 25;

const ROLE_OPTIONS = Object.freeze([
  'MEMBER',
  'CSR',
  'BOS',
  'ITS',
  'ADMIN',
]);

const OUTCOME_OPTIONS = Object.freeze([
  'SUCCESS',
  'FAILED',
  'DENIED',
]);

const CSV_HEADERS = Object.freeze([
  'event_id',
  'occurred_at',
  'actor_user_id',
  'actor_display_name',
  'actor_role',
  'action',
  'entity_type',
  'entity_id',
  'outcome',
  'correlation_id',
  'before',
  'after',
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

  return error;
}

function unwrapServiceResult(result, fallback) {
  if (result?.ok === false) {
    throw createServiceError(result, fallback);
  }

  return result?.ok === true ? result.data : result;
}

function normalizeAuditResult(result) {
  const value = unwrapServiceResult(
    result,
    'Browser-local audit history could not be loaded.',
  );

  if (Array.isArray(value)) {
    return {
      items: value,
      page: 1,
      limit: value.length || DEFAULT_PAGE_SIZE,
      total: value.length,
      totalPages: value.length === 0 ? 0 : 1,
    };
  }

  const items = Array.isArray(value?.items)
    ? value.items
    : Array.isArray(value?.events)
      ? value.events
      : null;

  if (items === null) {
    throw new TypeError(
      'The local audit service returned an invalid event collection.',
    );
  }

  const limit =
    Number.isSafeInteger(value.limit) && value.limit > 0
      ? value.limit
      : DEFAULT_PAGE_SIZE;
  const total =
    Number.isSafeInteger(value.total) && value.total >= 0
      ? value.total
      : items.length;

  return {
    items,
    page:
      Number.isSafeInteger(value.page) && value.page > 0
        ? value.page
        : 1,
    limit,
    total,
    totalPages:
      Number.isSafeInteger(value.totalPages) &&
      value.totalPages >= 0
        ? value.totalPages
        : total === 0
          ? 0
          : Math.ceil(total / limit),
  };
}

function resolveQueryMethod(service) {
  if (service === null || service === undefined) {
    return null;
  }

  if (typeof service.query === 'function') {
    return service.query.bind(service);
  }

  if (typeof service.list === 'function') {
    return service.list.bind(service);
  }

  if (typeof service.getEvents === 'function') {
    return service.getEvents.bind(service);
  }

  return null;
}

function resolveExportMethod(service) {
  if (service === null || service === undefined) {
    return null;
  }

  if (typeof service.export === 'function') {
    return service.export.bind(service);
  }

  if (typeof service.exportEvents === 'function') {
    return service.exportEvents.bind(service);
  }

  if (typeof service.exportAudit === 'function') {
    return service.exportAudit.bind(service);
  }

  return null;
}

function createEmptyFilters() {
  return {
    query: '',
    actorId: '',
    actorRole: '',
    action: '',
    entityType: '',
    outcome: '',
    from: '',
    to: '',
    direction: 'DESC',
    page: 1,
    limit: DEFAULT_PAGE_SIZE,
  };
}

function normalizeSearchText(value) {
  return typeof value === 'string'
    ? value
        .normalize('NFKC')
        .trim()
        .toLocaleLowerCase('en-US')
    : '';
}

function normalizeDateFilter(value) {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0
  ) {
    return '';
  }

  const normalized = value.trim();

  return /^\d{4}-\d{2}-\d{2}$/.test(normalized)
    ? normalized
    : '';
}

function normalizeFilters(filters) {
  return {
    query:
      typeof filters.query === 'string'
        ? filters.query.normalize('NFKC').trim()
        : '',
    actorId:
      typeof filters.actorId === 'string'
        ? filters.actorId.normalize('NFC').trim()
        : '',
    actorRole:
      typeof filters.actorRole === 'string'
        ? filters.actorRole.trim().toUpperCase()
        : '',
    action:
      typeof filters.action === 'string'
        ? filters.action
            .normalize('NFC')
            .trim()
            .toUpperCase()
        : '',
    entityType:
      typeof filters.entityType === 'string'
        ? filters.entityType
            .normalize('NFC')
            .trim()
            .toUpperCase()
        : '',
    outcome:
      typeof filters.outcome === 'string'
        ? filters.outcome.trim().toUpperCase()
        : '',
    from: normalizeDateFilter(filters.from),
    to: normalizeDateFilter(filters.to),
    direction:
      filters.direction === 'ASC' ? 'ASC' : 'DESC',
    page:
      Number.isSafeInteger(filters.page) && filters.page > 0
        ? filters.page
        : 1,
    limit:
      Number.isSafeInteger(filters.limit) &&
      filters.limit > 0
        ? filters.limit
        : DEFAULT_PAGE_SIZE,
  };
}

function createServiceQuery(filters) {
  return {
    page: filters.page,
    limit: filters.limit,
    direction: filters.direction,
    ...(filters.query.length === 0
      ? {}
      : { query: filters.query }),
    ...(filters.actorId.length === 0
      ? {}
      : { actorId: filters.actorId }),
    ...(filters.actorRole.length === 0
      ? {}
      : { actorRole: filters.actorRole }),
    ...(filters.action.length === 0
      ? {}
      : { actions: [filters.action] }),
    ...(filters.entityType.length === 0
      ? {}
      : { entityType: filters.entityType }),
    ...(filters.outcome.length === 0
      ? {}
      : { outcomes: [filters.outcome] }),
    ...(filters.from.length === 0
      ? {}
      : { from: filters.from }),
    ...(filters.to.length === 0
      ? {}
      : { to: filters.to }),
  };
}

function createExportFilters(filters) {
  const {
    page: ignoredPage,
    limit: ignoredLimit,
    ...query
  } = createServiceQuery(filters);

  void ignoredPage;
  void ignoredLimit;

  return query;
}

function getEventDate(event) {
  if (
    typeof event?.occurredAt !== 'string' ||
    !Number.isFinite(Date.parse(event.occurredAt))
  ) {
    return null;
  }

  return new Date(event.occurredAt)
    .toISOString()
    .slice(0, 10);
}

function eventMatchesFilters(event, filters) {
  if (
    filters.actorId.length > 0 &&
    event.actor?.userId !== filters.actorId
  ) {
    return false;
  }

  if (
    filters.actorRole.length > 0 &&
    event.actor?.role !== filters.actorRole
  ) {
    return false;
  }

  if (
    filters.action.length > 0 &&
    event.action !== filters.action
  ) {
    return false;
  }

  if (
    filters.entityType.length > 0 &&
    event.entity?.type !== filters.entityType
  ) {
    return false;
  }

  if (
    filters.outcome.length > 0 &&
    event.outcome !== filters.outcome
  ) {
    return false;
  }

  const eventDate = getEventDate(event);

  if (
    filters.from.length > 0 &&
    (eventDate === null || eventDate < filters.from)
  ) {
    return false;
  }

  if (
    filters.to.length > 0 &&
    (eventDate === null || eventDate > filters.to)
  ) {
    return false;
  }

  const query = normalizeSearchText(filters.query);

  if (query.length === 0) {
    return true;
  }

  return [
    event.eventId,
    event.occurredAt,
    event.actor?.userId,
    event.actor?.displayName,
    event.actor?.role,
    event.action,
    event.entity?.type,
    event.entity?.id,
    event.outcome,
    event.correlationId,
  ]
    .filter(
      (value) =>
        value !== null && value !== undefined,
    )
    .join(' ')
    .toLocaleLowerCase('en-US')
    .includes(query);
}

function compareEvents(left, right, direction) {
  const leftTime = Date.parse(left.occurredAt ?? 0);
  const rightTime = Date.parse(right.occurredAt ?? 0);
  const difference = leftTime - rightTime;

  if (Number.isFinite(difference) && difference !== 0) {
    return direction === 'ASC' ? difference : -difference;
  }

  const comparison = String(
    left.eventId ?? '',
  ).localeCompare(
    String(right.eventId ?? ''),
    'en-US',
  );

  return direction === 'ASC'
    ? comparison
    : -comparison;
}

function redactEvent(event) {
  const masked = maskObject(event, {
    fieldPolicies: {
      eventId: 'PRESERVE',
      action: 'PRESERVE',
      outcome: 'PRESERVE',
      correlationId: 'PRESERVE',
    },
  });

  return isPlainObject(masked) ? masked : event;
}

function getEventKey(event, index) {
  return event.eventId ?? `audit-event-${index}`;
}

function formatDetail(value) {
  if (value === null || value === undefined) {
    return null;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return JSON.stringify({
      notice: 'Masked audit detail unavailable',
    });
  }
}

function serializeDetail(value) {
  const formatted = formatDetail(value);

  return formatted ?? '';
}

function createLocalExport(events, format) {
  if (typeof globalThis.Blob !== 'function') {
    throw new Error(
      'Browser Blob APIs are unavailable for local export.',
    );
  }

  const timestamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');

  if (format === 'JSON') {
    const content = `${JSON.stringify(
      {
        notice: AUDIT_EXPORT_NOTICE,
        masked: true,
        rowCount: events.length,
        events,
      },
      null,
      2,
    )}\n`;

    return {
      blob: new globalThis.Blob([content], {
        type: 'application/json;charset=utf-8',
      }),
      filename: `audit-events-demo-${timestamp}.json`,
      rowCount: events.length,
    };
  }

  const csv = formatCsv(
    [
      CSV_HEADERS,
      ...events.map((event) => [
        event.eventId,
        event.occurredAt,
        event.actor?.userId,
        event.actor?.displayName,
        event.actor?.role,
        event.action,
        event.entity?.type,
        event.entity?.id,
        event.outcome,
        event.correlationId,
        serializeDetail(event.before),
        serializeDetail(event.after),
      ]),
    ],
    {
      formulaSafe: true,
      formulaPrefix: "'",
      lineEnding: '\r\n',
    },
  );
  const content =
    `# ${AUDIT_EXPORT_NOTICE}\r\n${csv}\r\n`;

  return {
    blob: new globalThis.Blob([content], {
      type: 'text/csv;charset=utf-8',
    }),
    filename: `audit-events-demo-${timestamp}.csv`,
    rowCount: events.length,
  };
}

function getOutcomeVariant(outcome) {
  switch (outcome) {
    case 'SUCCESS':
      return 'success';
    case 'FAILED':
    case 'DENIED':
      return 'error';
    default:
      return 'neutral';
  }
}

function AuditDetail({ label, value }) {
  const formatted = formatDetail(value);

  return (
    <section className="min-w-0 rounded-lg border border-border bg-surface-muted p-4 dark:border-border-dark dark:bg-surface-dark">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
        {label}
      </h4>
      {formatted === null ? (
        <p className="mt-2 text-sm text-content-muted dark:text-content-inverse-muted">
          No {label.toLocaleLowerCase('en-US')} value recorded.
        </p>
      ) : (
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-5 text-content dark:text-content-inverse">
          {formatted}
        </pre>
      )}
    </section>
  );
}

AuditDetail.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.object,
};

/**
 * Masked browser-local audit history route.
 *
 * @param {{
 *   session?: Record<string, unknown>|null,
 *   context?: Record<string, unknown>|null,
 *   auditFacade?: object,
 *   auditService?: object,
 *   initialEvents?: readonly Record<string, unknown>[],
 *   initialFilters?: Record<string, unknown>|null,
 *   onExported?: Function
 * }} props Component props.
 * @returns {JSX.Element} Audit history page.
 */
export function AuditPage({
  session = null,
  context = null,
  auditFacade = null,
  auditService = null,
  initialEvents = INITIAL_AUDIT_EVENTS,
  initialFilters = null,
  onExported,
}) {
  const headingId = useId();
  const searchId = useId();
  const actorId = useId();
  const actorRoleId = useId();
  const actionId = useId();
  const entityTypeId = useId();
  const outcomeId = useId();
  const fromId = useId();
  const toId = useId();
  const directionId = useId();
  const accessContext = useMemo(
    () => normalizeContext(context ?? session),
    [context, session],
  );
  const role = accessContext?.role ?? null;
  const authenticated = accessContext !== null;
  const service = auditFacade ?? auditService;
  const queryAudit = useMemo(
    () => resolveQueryMethod(service),
    [service],
  );
  const exportAudit = useMemo(
    () => resolveExportMethod(service),
    [service],
  );
  const initialFilterState = useMemo(
    () =>
      normalizeFilters({
        ...createEmptyFilters(),
        ...(isPlainObject(initialFilters)
          ? initialFilters
          : {}),
      }),
    [initialFilters],
  );
  const [filterValues, setFilterValues] = useState(
    initialFilterState,
  );
  const [appliedFilters, setAppliedFilters] = useState(
    initialFilterState,
  );
  const [events, setEvents] = useState(initialEvents);
  const [resultMeta, setResultMeta] = useState({
    page: 1,
    limit: initialFilterState.limit,
    total: initialEvents.length,
    totalPages:
      initialEvents.length === 0 ? 0 : 1,
  });
  const [loading, setLoading] = useState(
    queryAudit !== null,
  );
  const [loadError, setLoadError] = useState(null);
  const [operationError, setOperationError] = useState(null);
  const [operationMessage, setOperationMessage] =
    useState(null);
  const [exportFormat, setExportFormat] = useState('CSV');
  const [exportPending, setExportPending] = useState(false);
  const [reloadSequence, setReloadSequence] = useState(0);

  useEffect(() => {
    let active = true;

    const load = async () => {
      if (
        !authenticated ||
        role === null ||
        !AUTHORIZED_ROLES.has(role)
      ) {
        setLoading(false);
        return;
      }

      if (queryAudit === null) {
        const filtered = initialEvents
          .filter((event) =>
            eventMatchesFilters(event, appliedFilters),
          )
          .sort((left, right) =>
            compareEvents(
              left,
              right,
              appliedFilters.direction,
            ),
          );
        const start =
          (appliedFilters.page - 1) *
          appliedFilters.limit;
        const items = filtered.slice(
          start,
          start + appliedFilters.limit,
        );

        setEvents(items);
        setResultMeta({
          page: appliedFilters.page,
          limit: appliedFilters.limit,
          total: filtered.length,
          totalPages:
            filtered.length === 0
              ? 0
              : Math.ceil(
                  filtered.length /
                    appliedFilters.limit,
                ),
        });
        setLoading(false);
        setLoadError(null);
        return;
      }

      setLoading(true);
      setLoadError(null);
      setOperationError(null);

      try {
        const result = await Promise.resolve(
          queryAudit(
            createServiceQuery(appliedFilters),
            accessContext,
          ),
        );
        const normalized = normalizeAuditResult(result);

        if (!active) {
          return;
        }

        setEvents(normalized.items);
        setResultMeta({
          page: normalized.page,
          limit: normalized.limit,
          total: normalized.total,
          totalPages: normalized.totalPages,
        });
      } catch (error) {
        if (active) {
          const fallback = initialEvents
            .filter((event) =>
              eventMatchesFilters(event, appliedFilters),
            )
            .sort((left, right) =>
              compareEvents(
                left,
                right,
                appliedFilters.direction,
              ),
            );

          setEvents(
            fallback.slice(0, appliedFilters.limit),
          );
          setResultMeta({
            page: 1,
            limit: appliedFilters.limit,
            total: fallback.length,
            totalPages:
              fallback.length === 0
                ? 0
                : Math.ceil(
                    fallback.length /
                      appliedFilters.limit,
                  ),
          });
          setLoadError(
            normalizeErrorMessage(
              error,
              'Browser-local audit history could not be loaded.',
            ),
          );
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    load().catch((error) => {
      if (active) {
        setLoading(false);
        setLoadError(
          normalizeErrorMessage(
            error,
            'Browser-local audit history could not be loaded.',
          ),
        );
      }
    });

    return () => {
      active = false;
    };
  }, [
    accessContext,
    appliedFilters,
    authenticated,
    initialEvents,
    queryAudit,
    reloadSequence,
    role,
  ]);

  const visibleEvents = useMemo(
    () => events.map(redactEvent),
    [events],
  );

  const filtersActive =
    appliedFilters.query.length > 0 ||
    appliedFilters.actorId.length > 0 ||
    appliedFilters.actorRole.length > 0 ||
    appliedFilters.action.length > 0 ||
    appliedFilters.entityType.length > 0 ||
    appliedFilters.outcome.length > 0 ||
    appliedFilters.from.length > 0 ||
    appliedFilters.to.length > 0 ||
    appliedFilters.direction !== 'DESC';

  const updateFilter = (field, value) => {
    setFilterValues((current) => ({
      ...current,
      [field]: value,
    }));
    setOperationError(null);
    setOperationMessage(null);
  };

  const handleSearch = (event) => {
    event.preventDefault();

    const normalized = normalizeFilters({
      ...filterValues,
      page: 1,
    });

    if (
      normalized.from.length > 0 &&
      normalized.to.length > 0 &&
      normalized.from > normalized.to
    ) {
      setOperationError(
        'Audit start date must not be after the end date.',
      );
      return;
    }

    setAppliedFilters(normalized);
    setOperationError(null);
    setOperationMessage(null);
  };

  const clearFilters = () => {
    const empty = createEmptyFilters();

    setFilterValues(empty);
    setAppliedFilters(empty);
    setOperationError(null);
    setOperationMessage(null);
  };

  const changePage = (page) => {
    if (
      page < 1 ||
      (resultMeta.totalPages > 0 &&
        page > resultMeta.totalPages)
    ) {
      return;
    }

    setFilterValues((current) => ({
      ...current,
      page,
    }));
    setAppliedFilters((current) => ({
      ...current,
      page,
    }));
    setOperationError(null);
    setOperationMessage(null);
  };

  const handleExport = async () => {
    setExportPending(true);
    setOperationError(null);
    setOperationMessage(null);

    try {
      let descriptor;
      let serviceResult = null;

      if (exportAudit !== null) {
        serviceResult = await Promise.resolve(
          exportAudit(
            {
              format: exportFormat,
              filters: createExportFilters(
                appliedFilters,
              ),
            },
            accessContext,
          ),
        );
        descriptor = unwrapServiceResult(
          serviceResult,
          'The masked audit export could not be created.',
        );
      } else {
        const localEvents = initialEvents
          .filter((event) =>
            eventMatchesFilters(event, appliedFilters),
          )
          .sort((left, right) =>
            compareEvents(
              left,
              right,
              appliedFilters.direction,
            ),
          )
          .map(redactEvent);

        descriptor = createLocalExport(
          localEvents,
          exportFormat,
        );
      }

      if (
        !isPlainObject(descriptor) ||
        typeof descriptor.filename !== 'string' ||
        typeof globalThis.Blob !== 'function' ||
        !(descriptor.blob instanceof globalThis.Blob)
      ) {
        throw new Error(
          'The local audit service returned an invalid export descriptor.',
        );
      }

      downloadBlob(
        descriptor.blob,
        descriptor.filename,
        {
          cleanupDelayMs: 0,
        },
      );

      setOperationMessage(
        `${descriptor.rowCount ?? resultMeta.total} masked fictional audit ${
          (descriptor.rowCount ?? resultMeta.total) === 1
            ? 'event was'
            : 'events were'
        } exported locally as ${exportFormat}.`,
      );

      if (typeof onExported === 'function') {
        await Promise.resolve(
          onExported(descriptor, serviceResult),
        );
      }
    } catch (error) {
      setOperationError(
        normalizeErrorMessage(
          error,
          'The masked audit export could not be created.',
        ),
      );
    } finally {
      setExportPending(false);
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
              <ClipboardList
                className="h-6 w-6"
                aria-hidden="true"
              />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-primary-700 dark:text-primary-300">
                Browser-local governance evidence
              </p>
              <h1
                id={headingId}
                className="mt-1 text-2xl font-semibold tracking-tight text-content dark:text-content-inverse sm:text-3xl"
              >
                Masked audit history
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-content-muted dark:text-content-inverse-muted sm:text-base">
                Review role-scoped fictional events by time,
                actor, action, entity, and outcome. Before and
                after values are defensively masked before
                display.
              </p>
            </div>
          </div>

          <StatusBadge
            status={role}
            variant="neutral"
            label={`${formatStatus(role)} demo role`}
          />
        </div>
      </header>

      <aside
        className="mt-5 rounded-xl border border-primary-200 bg-primary-50 p-4 text-sm text-primary-900 dark:border-primary-800 dark:bg-primary-950 dark:text-primary-100"
        role="note"
        aria-label="Audit history disclosure"
      >
        <div className="flex items-start gap-3">
          <ShieldCheck
            className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
            aria-hidden="true"
          />
          <div>
            <p className="font-semibold">
              Masked browser-local evidence only
            </p>
            <p className="mt-1 leading-6">
              Audit events and exports contain fictional,
              defensively masked demonstration data. This history
              is browser-local, user-editable through developer
              tools, and is not a production security,
              compliance, healthcare, or legal audit trail.
            </p>
            {role === 'ITS' ? (
              <p className="mt-1 leading-6">
                ITS visibility is limited by the local audit
                facade to platform, monitoring, integration,
                settings, storage, and snapshot activity.
              </p>
            ) : null}
          </div>
        </div>
      </aside>

      {loadError !== null ? (
        <div
          className="mt-5 rounded-lg border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-700 dark:border-warning-700 dark:bg-warning-950 dark:text-warning-100"
          role="alert"
        >
          {loadError} Bundled masked baseline evidence is displayed
          where available.
        </div>
      ) : null}

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
        className="mt-6 rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted sm:p-6"
        aria-labelledby="audit-filters-heading"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <Filter
              className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
              aria-hidden="true"
            />
            <div>
              <h2
                id="audit-filters-heading"
                className="text-lg font-semibold text-content dark:text-content-inverse"
              >
                Audit filters
              </h2>
              <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
                Filter the authorized local history before
                reviewing or exporting it.
              </p>
            </div>
          </div>

          {filtersActive ? (
            <button
              className="inline-flex min-h-10 items-center justify-center gap-2 self-start rounded-lg px-3 py-2 text-sm font-semibold text-content-muted transition hover:bg-surface-muted hover:text-content focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-60 dark:text-content-inverse-muted dark:hover:bg-surface-dark-raised dark:hover:text-content-inverse"
              type="button"
              disabled={loading || exportPending}
              onClick={clearFilters}
            >
              <X className="h-4 w-4" aria-hidden="true" />
              Clear filters
            </button>
          ) : null}
        </div>

        <form
          className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3"
          onSubmit={handleSearch}
        >
          <div className="sm:col-span-2 lg:col-span-3">
            <label
              className="block text-sm font-medium text-content dark:text-content-inverse"
              htmlFor={searchId}
            >
              Search audit history
            </label>
            <div className="relative mt-2">
              <Search
                className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-content-subtle dark:text-content-inverse-muted"
                aria-hidden="true"
              />
              <input
                id={searchId}
                className="block min-h-11 w-full rounded-lg border border-border-strong bg-surface py-2 pl-10 pr-3 text-sm text-content shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
                type="search"
                value={filterValues.query}
                maxLength={200}
                autoComplete="off"
                placeholder="Actor, action, entity, outcome, or correlation ID"
                disabled={loading}
                onChange={(event) =>
                  updateFilter('query', event.target.value)
                }
              />
            </div>
          </div>

          <div>
            <label
              className="block text-sm font-medium text-content dark:text-content-inverse"
              htmlFor={actorId}
            >
              Actor user ID
            </label>
            <input
              id={actorId}
              className="mt-2 block min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 font-mono text-sm text-content shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
              type="text"
              value={filterValues.actorId}
              maxLength={200}
              autoComplete="off"
              disabled={loading}
              placeholder="usr_admin"
              onChange={(event) =>
                updateFilter('actorId', event.target.value)
              }
            />
          </div>

          <div>
            <label
              className="block text-sm font-medium text-content dark:text-content-inverse"
              htmlFor={actorRoleId}
            >
              Actor role
            </label>
            <select
              id={actorRoleId}
              className="mt-2 block min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-content shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
              value={filterValues.actorRole}
              disabled={loading}
              onChange={(event) =>
                updateFilter(
                  'actorRole',
                  event.target.value,
                )
              }
            >
              <option value="">All actor roles</option>
              {ROLE_OPTIONS.map((actorRole) => (
                <option key={actorRole} value={actorRole}>
                  {formatStatus(actorRole)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              className="block text-sm font-medium text-content dark:text-content-inverse"
              htmlFor={actionId}
            >
              Action
            </label>
            <input
              id={actionId}
              className="mt-2 block min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 font-mono text-sm uppercase text-content shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
              type="text"
              value={filterValues.action}
              maxLength={100}
              autoComplete="off"
              placeholder="SETTINGS_UPDATED"
              disabled={loading}
              onChange={(event) =>
                updateFilter('action', event.target.value)
              }
            />
          </div>

          <div>
            <label
              className="block text-sm font-medium text-content dark:text-content-inverse"
              htmlFor={entityTypeId}
            >
              Entity type
            </label>
            <input
              id={entityTypeId}
              className="mt-2 block min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 font-mono text-sm uppercase text-content shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
              type="text"
              value={filterValues.entityType}
              maxLength={100}
              autoComplete="off"
              placeholder="SETTINGS"
              disabled={loading}
              onChange={(event) =>
                updateFilter(
                  'entityType',
                  event.target.value,
                )
              }
            />
          </div>

          <div>
            <label
              className="block text-sm font-medium text-content dark:text-content-inverse"
              htmlFor={outcomeId}
            >
              Outcome
            </label>
            <select
              id={outcomeId}
              className="mt-2 block min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-content shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
              value={filterValues.outcome}
              disabled={loading}
              onChange={(event) =>
                updateFilter('outcome', event.target.value)
              }
            >
              <option value="">All outcomes</option>
              {OUTCOME_OPTIONS.map((outcome) => (
                <option key={outcome} value={outcome}>
                  {formatStatus(outcome)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              className="block text-sm font-medium text-content dark:text-content-inverse"
              htmlFor={fromId}
            >
              From date
            </label>
            <input
              id={fromId}
              className="mt-2 block min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-content shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
              type="date"
              value={filterValues.from}
              disabled={loading}
              onChange={(event) =>
                updateFilter('from', event.target.value)
              }
            />
          </div>

          <div>
            <label
              className="block text-sm font-medium text-content dark:text-content-inverse"
              htmlFor={toId}
            >
              To date
            </label>
            <input
              id={toId}
              className="mt-2 block min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-content shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
              type="date"
              value={filterValues.to}
              disabled={loading}
              onChange={(event) =>
                updateFilter('to', event.target.value)
              }
            />
          </div>

          <div>
            <label
              className="block text-sm font-medium text-content dark:text-content-inverse"
              htmlFor={directionId}
            >
              Time order
            </label>
            <select
              id={directionId}
              className="mt-2 block min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-content shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
              value={filterValues.direction}
              disabled={loading}
              onChange={(event) =>
                updateFilter(
                  'direction',
                  event.target.value,
                )
              }
            >
              <option value="DESC">Newest first</option>
              <option value="ASC">Oldest first</option>
            </select>
          </div>

          <div className="sm:col-span-2 lg:col-span-3">
            <button
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-primary-600 bg-primary-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:focus:ring-offset-surface-dark sm:w-auto"
              type="submit"
              disabled={loading}
            >
              {loading ? (
                <Loader2
                  className="h-4 w-4 animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              ) : (
                <Filter
                  className="h-4 w-4"
                  aria-hidden="true"
                />
              )}
              {loading
                ? 'Loading audit history…'
                : 'Apply audit filters'}
            </button>
          </div>
        </form>
      </section>

      <section
        className="mt-6 rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted sm:p-6"
        aria-labelledby="audit-export-heading"
        aria-busy={exportPending}
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2
              id="audit-export-heading"
              className="text-lg font-semibold text-content dark:text-content-inverse"
            >
              Export masked audit data
            </h2>
            <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
              Exports apply the current filters and remain in your
              browser. CSV values are formula-safe.
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="block text-sm font-medium text-content dark:text-content-inverse">
              Export format
              <select
                className="mt-2 block min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-content shadow-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse sm:w-36"
                value={exportFormat}
                disabled={exportPending}
                onChange={(event) => {
                  setExportFormat(event.target.value);
                  setOperationError(null);
                  setOperationMessage(null);
                }}
              >
                <option value="CSV">CSV</option>
                <option value="JSON">JSON</option>
              </select>
            </label>

            <div className="flex items-end">
              <button
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-primary-600 bg-primary-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:focus:ring-offset-surface-dark"
                type="button"
                disabled={exportPending}
                onClick={() => {
                  handleExport().catch((error) => {
                    setExportPending(false);
                    setOperationError(
                      normalizeErrorMessage(
                        error,
                        'The masked audit export could not be created.',
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
                  : `Export ${exportFormat}`}
              </button>
            </div>
          </div>
        </div>

        <p className="mt-4 text-xs font-semibold text-primary-700 dark:text-primary-300">
          Export notice: {AUDIT_EXPORT_NOTICE}
        </p>
      </section>

      <section
        className="mt-8"
        aria-labelledby="audit-events-heading"
        aria-busy={loading}
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2
              id="audit-events-heading"
              className="text-xl font-semibold text-content dark:text-content-inverse"
            >
              Authorized audit events
            </h2>
            <p
              className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted"
              aria-live="polite"
            >
              {loading
                ? 'Loading masked browser-local audit events.'
                : `${resultMeta.total} authorized masked ${
                    resultMeta.total === 1 ? 'event' : 'events'
                  } found.`}
            </p>
          </div>

          <button
            className="inline-flex min-h-10 items-center justify-center gap-2 self-start rounded-lg border border-border-strong bg-surface px-4 py-2 text-sm font-semibold text-content transition hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark-muted dark:text-content-inverse dark:hover:bg-surface-dark-raised"
            type="button"
            disabled={loading}
            onClick={() =>
              setReloadSequence((current) => current + 1)
            }
          >
            <RefreshCw
              className="h-4 w-4"
              aria-hidden="true"
            />
            Refresh history
          </button>
        </div>

        {loading ? (
          <div
            className="mt-4 rounded-xl border border-border bg-surface p-8 text-center shadow-card dark:border-border-dark dark:bg-surface-dark-muted"
            role="status"
          >
            <Loader2
              className="mx-auto h-7 w-7 animate-spin text-primary-600 motion-reduce:animate-none"
              aria-hidden="true"
            />
            <p className="mt-3 text-sm font-medium text-content dark:text-content-inverse">
              Loading authorized local audit evidence
            </p>
          </div>
        ) : null}

        {!loading &&
        visibleEvents.length === 0 &&
        loadError === null ? (
          <div
            className="mt-4 rounded-xl border border-border bg-surface p-8 text-center shadow-card dark:border-border-dark dark:bg-surface-dark-muted"
            role="status"
          >
            <FileSearch
              className="mx-auto h-8 w-8 text-content-subtle dark:text-content-inverse-muted"
              aria-hidden="true"
            />
            <h3 className="mt-3 font-semibold text-content dark:text-content-inverse">
              No authorized audit events found
            </h3>
            <p className="mt-2 text-sm leading-6 text-content-muted dark:text-content-inverse-muted">
              Adjust or clear the filters. Events outside the
              current demo role&apos;s scope are not disclosed.
            </p>
          </div>
        ) : null}

        {!loading && visibleEvents.length > 0 ? (
          <ol className="mt-4 space-y-4">
            {visibleEvents.map((event, index) => (
              <li
                key={getEventKey(event, index)}
                className="rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted sm:p-6"
              >
                <article>
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
                        Audit action
                      </p>
                      <h3 className="mt-1 break-words text-base font-semibold text-content dark:text-content-inverse">
                        {formatStatus(
                          event.action ?? 'Recorded',
                        )}
                      </h3>
                      <p className="mt-2 break-all font-mono text-xs text-content-subtle dark:text-content-inverse-muted">
                        {event.eventId ??
                          'Local audit event'}
                      </p>
                    </div>

                    <StatusBadge
                      className="self-start"
                      status={event.outcome ?? 'UNKNOWN'}
                      variant={getOutcomeVariant(
                        event.outcome,
                      )}
                    />
                  </div>

                  <dl className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="rounded-lg bg-surface-muted p-4 dark:bg-surface-dark">
                      <dt className="text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
                        Time
                      </dt>
                      <dd className="mt-1 text-sm font-medium text-content dark:text-content-inverse">
                        {formatDateTime(event.occurredAt)}
                      </dd>
                    </div>

                    <div className="rounded-lg bg-surface-muted p-4 dark:bg-surface-dark">
                      <dt className="text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
                        Actor
                      </dt>
                      <dd className="mt-1 text-sm font-medium text-content dark:text-content-inverse">
                        {event.actor?.displayName ??
                          'Masked actor'}
                      </dd>
                      <p className="mt-1 break-all font-mono text-xs text-content-subtle dark:text-content-inverse-muted">
                        {event.actor?.userId ?? 'Restricted'}
                        {event.actor?.role
                          ? ` · ${event.actor.role}`
                          : ''}
                      </p>
                    </div>

                    <div className="rounded-lg bg-surface-muted p-4 dark:bg-surface-dark">
                      <dt className="text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
                        Entity
                      </dt>
                      <dd className="mt-1 text-sm font-medium text-content dark:text-content-inverse">
                        {formatStatus(
                          event.entity?.type ??
                            'Unknown entity',
                        )}
                      </dd>
                      <p className="mt-1 break-all font-mono text-xs text-content-subtle dark:text-content-inverse-muted">
                        {event.entity?.id ?? 'Restricted'}
                      </p>
                    </div>

                    <div className="rounded-lg bg-surface-muted p-4 dark:bg-surface-dark">
                      <dt className="text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
                        Correlation
                      </dt>
                      <dd className="mt-1 break-all font-mono text-xs font-medium text-content dark:text-content-inverse">
                        {event.correlationId ?? 'Unavailable'}
                      </dd>
                    </div>
                  </dl>

                  <div className="mt-5 grid gap-4 lg:grid-cols-2">
                    <AuditDetail
                      label="Before"
                      value={
                        isPlainObject(event.before)
                          ? event.before
                          : null
                      }
                    />
                    <AuditDetail
                      label="After"
                      value={
                        isPlainObject(event.after)
                          ? event.after
                          : null
                      }
                    />
                  </div>
                </article>
              </li>
            ))}
          </ol>
        ) : null}

        {!loading && resultMeta.totalPages > 1 ? (
          <nav
            className="mt-6 flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 shadow-card dark:border-border-dark dark:bg-surface-dark-muted sm:flex-row sm:items-center sm:justify-between"
            aria-label="Audit history pagination"
          >
            <p className="text-sm text-content-muted dark:text-content-inverse-muted">
              Page{' '}
              <span className="font-semibold text-content dark:text-content-inverse">
                {resultMeta.page}
              </span>{' '}
              of{' '}
              <span className="font-semibold text-content dark:text-content-inverse">
                {resultMeta.totalPages}
              </span>
            </p>

            <div className="flex gap-2">
              <button
                className="inline-flex min-h-10 items-center justify-center rounded-lg border border-border-strong bg-surface px-4 py-2 text-sm font-semibold text-content transition hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
                type="button"
                disabled={resultMeta.page <= 1}
                onClick={() =>
                  changePage(resultMeta.page - 1)
                }
              >
                Previous
              </button>
              <button
                className="inline-flex min-h-10 items-center justify-center rounded-lg border border-border-strong bg-surface px-4 py-2 text-sm font-semibold text-content transition hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
                type="button"
                disabled={
                  resultMeta.page >= resultMeta.totalPages
                }
                onClick={() =>
                  changePage(resultMeta.page + 1)
                }
              >
                Next
              </button>
            </div>
          </nav>
        ) : null}
      </section>

      <aside
        className="mt-8 rounded-xl border border-warning-200 bg-warning-50 p-5 text-warning-700 shadow-card dark:border-warning-700 dark:bg-warning-950 dark:text-warning-100 sm:p-6"
        role="note"
        aria-label="Audit history limitations"
      >
        <div className="flex items-start gap-3">
          <ShieldAlert
            className="mt-0.5 h-5 w-5 shrink-0"
            aria-hidden="true"
          />
          <div>
            <p className="font-semibold">
              Not a production audit system
            </p>
            <p className="mt-1 text-sm leading-6">
              Event times, actors, actions, entities, outcomes,
              before and after values, and exported files are
              fictional browser-local demonstration evidence.
              They do not provide immutable retention, secure
              identity, server authorization, certification,
              regulatory compliance, or external monitoring.
            </p>
          </div>
        </div>
      </aside>
    </div>
  );
}

AuditPage.propTypes = {
  session: PropTypes.object,
  context: PropTypes.object,
  auditFacade: PropTypes.object,
  auditService: PropTypes.object,
  initialEvents: PropTypes.arrayOf(PropTypes.object),
  initialFilters: PropTypes.object,
  onExported: PropTypes.func,
};

export const AuditHistoryPage = AuditPage;
export const GovernanceAuditPage = AuditPage;
export const LocalAuditPage = AuditPage;
export const MaskedAuditHistoryPage = AuditPage;

export default AuditPage;