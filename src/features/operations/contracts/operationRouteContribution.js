import { createElement } from 'react';
import {
  ROUTE_CAPABILITIES,
} from '../../../platform/contracts/capabilities.js';
import {
  isPlainObject,
} from '../../../platform/validation/schemas.js';

export const OPERATION_ROUTE_CONTRIBUTION_SCHEMA_VERSION = 1;

export const OPERATION_ACTIONS = Object.freeze({
  CREATE_REQUEST: 'CREATE_REQUEST',
  PROCESS_REQUEST: 'PROCESS_REQUEST',
  RESUME_REQUEST: 'RESUME_REQUEST',
  APPLY_INBOUND_ROWS: 'APPLY_INBOUND_ROWS',
  RETRY_INBOUND_ROW: 'RETRY_INBOUND_ROW',
  RUN_BATCH: 'RUN_BATCH',
  RETRY_BATCH_ROW: 'RETRY_BATCH_ROW',
  REWORK_CLAIM: 'REWORK_CLAIM',
  DECIDE_REVIEW: 'DECIDE_REVIEW',
  ADJUST_CLAIM: 'ADJUST_CLAIM',
  GET_ERROR_REPORT: 'GET_ERROR_REPORT',
  ACT_ON_ERROR_REPORT: 'ACT_ON_ERROR_REPORT',
  OPEN_DOCUMENT: 'OPEN_DOCUMENT',
  DOWNLOAD_DOCUMENT: 'DOWNLOAD_DOCUMENT',
  CREATE_FAX_OUTBOX: 'CREATE_FAX_OUTBOX',
  MARK_FAX_SENT: 'MARK_FAX_SENT',
  LIST_REQUESTS: 'LIST_REQUESTS',
  BULK_PROCESS: 'BULK_PROCESS',
  EXPORT_ROWS: 'EXPORT_ROWS',
  LIST_PROCESSING_SUMMARY: 'LIST_PROCESSING_SUMMARY',
  GET_COMPLETED_REPORTS: 'GET_COMPLETED_REPORTS',
});

export const OPERATION_ACTION_VALUES = Object.freeze(
  Object.values(OPERATION_ACTIONS),
);

export const OPERATION_ROUTE_IDS = Object.freeze({
  REQUEST_NEW: 'operations-request-new',
  REQUEST_DETAIL: 'operations-request-detail',
  INBOUND: 'operations-inbound',
  BATCH: 'operations-batch',
  REVIEWS: 'operations-reviews',
  ERROR_REPORT: 'operations-error-report',
  QUEUE: 'operations-queue',
  DOCUMENT: 'operations-document',
});

export const OPERATION_ROUTE_CONTRIBUTION_ERROR_CODES =
  Object.freeze({
    INVALID_OPTIONS: 'INVALID_OPTIONS',
    INVALID_LOADER: 'INVALID_LOADER',
    INVALID_ROUTE_MODULE: 'INVALID_ROUTE_MODULE',
    ROUTE_LOAD_FAILED: 'ROUTE_LOAD_FAILED',
  });

const ALL_OPERATION_STORIES = Object.freeze([
  'SCRUM-2075',
  'SCRUM-2076',
  'SCRUM-2077',
  'SCRUM-2078',
  'SCRUM-2079',
  'SCRUM-2080',
]);

const ROUTE_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: OPERATION_ROUTE_IDS.REQUEST_NEW,
    path: '/operations/requests/new',
    title: 'Create reprint request',
    capability: ROUTE_CAPABILITIES.MEMBER_CLAIMS,
    roles: Object.freeze(['MEMBER', 'CSR', 'BOS', 'ADMIN']),
    actions: Object.freeze([
      OPERATION_ACTIONS.CREATE_REQUEST,
    ]),
    userStories: Object.freeze(['SCRUM-2075']),
  }),
  Object.freeze({
    id: OPERATION_ROUTE_IDS.REQUEST_DETAIL,
    path: '/operations/requests/:id',
    title: 'Request processing status',
    capability: ROUTE_CAPABILITIES.MEMBER_CLAIMS,
    roles: Object.freeze(['MEMBER', 'CSR', 'BOS', 'ADMIN']),
    actions: Object.freeze([
      OPERATION_ACTIONS.PROCESS_REQUEST,
      OPERATION_ACTIONS.RESUME_REQUEST,
      OPERATION_ACTIONS.GET_COMPLETED_REPORTS,
    ]),
    userStories: Object.freeze([
      'SCRUM-2075',
      'SCRUM-2079',
    ]),
  }),
  Object.freeze({
    id: OPERATION_ROUTE_IDS.INBOUND,
    path: '/operations/inbound',
    title: 'Inbound fixture processing',
    capability: ROUTE_CAPABILITIES.BOS_OPERATIONS,
    roles: Object.freeze(['BOS', 'ADMIN']),
    actions: Object.freeze([
      OPERATION_ACTIONS.APPLY_INBOUND_ROWS,
      OPERATION_ACTIONS.RETRY_INBOUND_ROW,
    ]),
    userStories: Object.freeze(['SCRUM-2076']),
  }),
  Object.freeze({
    id: OPERATION_ROUTE_IDS.BATCH,
    path: '/operations/batch',
    title: 'Claims outbound batch',
    capability: ROUTE_CAPABILITIES.BOS_OPERATIONS,
    roles: Object.freeze(['BOS', 'ADMIN']),
    actions: Object.freeze([
      OPERATION_ACTIONS.RUN_BATCH,
      OPERATION_ACTIONS.RETRY_BATCH_ROW,
      OPERATION_ACTIONS.REWORK_CLAIM,
    ]),
    userStories: Object.freeze(['SCRUM-2077']),
  }),
  Object.freeze({
    id: OPERATION_ROUTE_IDS.REVIEWS,
    path: '/operations/reviews',
    title: 'Manual reviews',
    capability: ROUTE_CAPABILITIES.BOS_OPERATIONS,
    roles: Object.freeze(['BOS', 'ADMIN']),
    actions: Object.freeze([
      OPERATION_ACTIONS.DECIDE_REVIEW,
      OPERATION_ACTIONS.ADJUST_CLAIM,
    ]),
    userStories: Object.freeze(['SCRUM-2078']),
  }),
  Object.freeze({
    id: OPERATION_ROUTE_IDS.ERROR_REPORT,
    path: '/operations/errors/:id',
    title: 'Error report',
    capability: ROUTE_CAPABILITIES.AUTHENTICATED,
    roles: Object.freeze(['BOS', 'ITS', 'ADMIN']),
    actions: Object.freeze([
      OPERATION_ACTIONS.GET_ERROR_REPORT,
      OPERATION_ACTIONS.ACT_ON_ERROR_REPORT,
    ]),
    userStories: Object.freeze(['SCRUM-2078']),
  }),
  Object.freeze({
    id: OPERATION_ROUTE_IDS.QUEUE,
    path: '/operations/queue',
    title: 'Operations queue',
    capability: ROUTE_CAPABILITIES.BOS_OPERATIONS,
    roles: Object.freeze(['BOS', 'ADMIN']),
    actions: Object.freeze([
      OPERATION_ACTIONS.LIST_REQUESTS,
      OPERATION_ACTIONS.BULK_PROCESS,
      OPERATION_ACTIONS.EXPORT_ROWS,
      OPERATION_ACTIONS.LIST_PROCESSING_SUMMARY,
    ]),
    userStories: Object.freeze(['SCRUM-2080']),
  }),
  Object.freeze({
    id: OPERATION_ROUTE_IDS.DOCUMENT,
    path: '/documents/:id',
    title: 'Representative document',
    capability: ROUTE_CAPABILITIES.MEMBER_CLAIMS,
    roles: Object.freeze(['MEMBER', 'CSR', 'BOS', 'ADMIN']),
    actions: Object.freeze([
      OPERATION_ACTIONS.OPEN_DOCUMENT,
      OPERATION_ACTIONS.DOWNLOAD_DOCUMENT,
      OPERATION_ACTIONS.CREATE_FAX_OUTBOX,
      OPERATION_ACTIONS.MARK_FAX_SENT,
    ]),
    userStories: Object.freeze(['SCRUM-2079']),
  }),
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

function normalizeOptions(value) {
  if (value === undefined) {
    return {};
  }

  if (!isPlainObject(value)) {
    throw new OperationRouteContributionError(
      OPERATION_ROUTE_CONTRIBUTION_ERROR_CODES.INVALID_OPTIONS,
      'Operation route contribution options must be a plain object.',
    );
  }

  const loaders =
    value.loaders ??
    value.moduleLoaders ??
    {};

  if (!isPlainObject(loaders)) {
    throw new OperationRouteContributionError(
      OPERATION_ROUTE_CONTRIBUTION_ERROR_CODES.INVALID_OPTIONS,
      'Operation route loaders must be a plain object.',
    );
  }

  if (
    value.loadRoute !== undefined &&
    typeof value.loadRoute !== 'function'
  ) {
    throw new OperationRouteContributionError(
      OPERATION_ROUTE_CONTRIBUTION_ERROR_CODES.INVALID_LOADER,
      'Operation route resolver must be a function.',
    );
  }

  Object.entries(loaders).forEach(([routeId, loader]) => {
    if (typeof loader !== 'function') {
      throw new OperationRouteContributionError(
        OPERATION_ROUTE_CONTRIBUTION_ERROR_CODES.INVALID_LOADER,
        'Each operation route loader must be a function.',
        { routeId },
      );
    }
  });

  return {
    loaders,
    loadRoute: value.loadRoute ?? null,
  };
}

function createUnavailableRouteModule(definition) {
  function OperationRouteUnavailable() {
    return createElement(
      'main',
      {
        className:
          'mx-auto flex min-h-[50vh] max-w-3xl items-center justify-center px-4 py-10 sm:px-6',
      },
      createElement(
        'section',
        {
          className:
            'w-full rounded-xl border border-border bg-surface p-6 text-center shadow-card dark:border-border-dark dark:bg-surface-dark-muted sm:p-8',
          role: 'status',
        },
        createElement(
          'h1',
          {
            className:
              'text-xl font-semibold text-content dark:text-content-inverse',
          },
          definition.title,
        ),
        createElement(
          'p',
          {
            className:
              'mt-3 text-sm text-content-muted dark:text-content-inverse-muted',
          },
          'This operations route is not included in the current application composition.',
        ),
      ),
    );
  }

  OperationRouteUnavailable.displayName =
    `Unavailable${definition.id.replace(/[^a-zA-Z0-9]/g, '')}`;

  return Object.freeze({
    Component: OperationRouteUnavailable,
  });
}

function normalizeRouteModule(value, definition) {
  const moduleValue =
    value !== null &&
    typeof value === 'object'
      ? value
      : null;
  const Component =
    moduleValue?.Component ??
    moduleValue?.default;

  if (typeof Component !== 'function') {
    throw new OperationRouteContributionError(
      OPERATION_ROUTE_CONTRIBUTION_ERROR_CODES.INVALID_ROUTE_MODULE,
      `Operation route ${definition.id} did not provide a React component.`,
      {
        routeId: definition.id,
        path: definition.path,
      },
    );
  }

  return {
    ...moduleValue,
    Component,
  };
}

function resolveLoader(definition, options) {
  const loader =
    options.loaders[definition.id] ??
    options.loaders[definition.path];

  if (loader !== undefined) {
    return loader;
  }

  if (options.loadRoute !== null) {
    return () => options.loadRoute(definition);
  }

  return null;
}

function createLazyLoader(definition, options) {
  const loader = resolveLoader(definition, options);

  if (loader === null) {
    const fallback = createUnavailableRouteModule(definition);

    return () => Promise.resolve(fallback);
  }

  return async () => {
    try {
      const moduleValue = await loader(definition);

      return normalizeRouteModule(moduleValue, definition);
    } catch (error) {
      if (error instanceof OperationRouteContributionError) {
        throw error;
      }

      throw new OperationRouteContributionError(
        OPERATION_ROUTE_CONTRIBUTION_ERROR_CODES.ROUTE_LOAD_FAILED,
        `Operation route ${definition.id} could not be loaded.`,
        {
          routeId: definition.id,
          path: definition.path,
        },
        error,
      );
    }
  };
}

/**
 * Error raised when an operation route contribution is invalid.
 */
export class OperationRouteContributionError extends Error {
  /**
   * @param {string} code Stable route contribution error code.
   * @param {string} message Human-readable error message.
   * @param {unknown} [details] Optional structured details.
   * @param {unknown} [cause] Original error.
   */
  constructor(code, message, details, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'OperationRouteContributionError';
    this.code = code;

    if (details !== undefined) {
      this.details = deepFreeze(details);
    }
  }
}

/**
 * Returns lazy React Router route contributions for operations workflows.
 *
 * Loaders may be keyed by route ID or path. A shared `loadRoute` resolver can
 * alternatively receive each immutable route definition.
 *
 * @param {{
 *   loaders?: Record<string, Function>,
 *   moduleLoaders?: Record<string, Function>,
 *   loadRoute?: (definition: Readonly<Record<string, unknown>>) => unknown
 * }} [options] Lazy route loader options.
 * @returns {readonly Readonly<Record<string, unknown>>[]} Route definitions.
 */
export function getOperationRoutes(options = {}) {
  const normalizedOptions = normalizeOptions(options);

  return Object.freeze(
    ROUTE_DEFINITIONS.map((definition) =>
      Object.freeze({
        id: definition.id,
        path: definition.path,
        lazy: createLazyLoader(
          definition,
          normalizedOptions,
        ),
        handle: deepFreeze({
          contribution: 'operations',
          schemaVersion:
            OPERATION_ROUTE_CONTRIBUTION_SCHEMA_VERSION,
          title: definition.title,
          capability: definition.capability,
          roles: definition.roles,
          actions: definition.actions,
          userStories: definition.userStories,
          localOnly: true,
          networkRequired: false,
        }),
      }),
    ),
  );
}

export const OPERATION_ROUTE_DEFINITIONS = ROUTE_DEFINITIONS;
export const OPERATION_USER_STORIES = ALL_OPERATION_STORIES;
export const createOperationRoutes = getOperationRoutes;
export const getRoutes = getOperationRoutes;

export default getOperationRoutes;