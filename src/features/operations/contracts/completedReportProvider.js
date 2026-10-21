import {
  adaptCompletedReportDto,
  SIBLING_CONTRACT_VERSION,
} from '../../../platform/contracts/siblingContracts.js';
import {
  isPlainObject,
  isPlatformRole,
} from '../../../platform/validation/schemas.js';

export const COMPLETED_REPORT_PROVIDER_SCHEMA_VERSION = 1;
export const COMPLETED_REPORT_DTO_NAME = 'CompletedReportDTO.v1';

export const COMPLETED_REPORT_PROVIDER_ERROR_CODES =
  Object.freeze({
    INVALID_SOURCE: 'INVALID_SOURCE',
    INVALID_CONTEXT: 'INVALID_CONTEXT',
    INVALID_QUERY: 'INVALID_QUERY',
    INVALID_IDENTIFIER: 'INVALID_IDENTIFIER',
  });

const DOCUMENT_STATUS_COMPLETE = 'COMPLETE';
const MAXIMUM_RESULTS = 200;
const PRIVILEGED_ROLES = new Set(['BOS', 'ADMIN']);
const SUPPORT_ROLES = new Set(['CSR', 'ITS']);
const providerCache = new WeakMap();

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

function isReadableSource(value) {
  return (
    isPlainObject(value) ||
    (value !== null &&
      typeof value === 'object' &&
      (typeof value.getSnapshot === 'function' ||
        typeof value.getState === 'function' ||
        typeof value.read === 'function' ||
        typeof value.load === 'function'))
  );
}

function requireSource(value) {
  if (!isReadableSource(value)) {
    throw new CompletedReportProviderError(
      COMPLETED_REPORT_PROVIDER_ERROR_CODES.INVALID_SOURCE,
      'Completed report provider requires an operations snapshot or readable source.',
    );
  }

  return value;
}

function readSource(source) {
  if (typeof source.getSnapshot === 'function') {
    return source.getSnapshot();
  }

  if (typeof source.getState === 'function') {
    return source.getState();
  }

  if (typeof source.read === 'function') {
    return source.read();
  }

  if (typeof source.load === 'function') {
    return source.load();
  }

  return source;
}

function hasReportCollections(value) {
  return (
    isPlainObject(value) &&
    isPlainObject(value.documents) &&
    isPlainObject(value.requests) &&
    isPlainObject(value.outboundRecords)
  );
}

function resolveEnvelope(value) {
  const candidates = [
    value,
    value?.envelope,
    value?.operationsEnvelope,
    value?.persistent,
    value?.data,
    value?.slices?.operationsEnvelope,
    value?.slices?.operations,
    value?.operations?.initialEnvelope,
  ];
  const envelope = candidates.find(hasReportCollections);

  if (envelope === undefined) {
    throw new CompletedReportProviderError(
      COMPLETED_REPORT_PROVIDER_ERROR_CODES.INVALID_SOURCE,
      'Operations source does not contain completed report collections.',
    );
  }

  return envelope;
}

function readContextProvider(provider) {
  if (provider === null || provider === undefined) {
    return null;
  }

  if (typeof provider === 'function') {
    return provider();
  }

  if (typeof provider.getSession === 'function') {
    return provider.getSession();
  }

  if (typeof provider.getSnapshot === 'function') {
    const snapshot = provider.getSnapshot();

    return snapshot?.session ?? snapshot?.actor ?? snapshot;
  }

  if (typeof provider.getState === 'function') {
    const state = provider.getState();

    return state?.session ?? state?.actor ?? state;
  }

  return null;
}

function normalizeContext(value) {
  if (typeof value === 'string') {
    value = { role: value };
  }

  if (!isPlainObject(value)) {
    return null;
  }

  const source = isPlainObject(value.session)
    ? value.session
    : isPlainObject(value.actor)
      ? value.actor
      : value;
  const role =
    typeof source.role === 'string'
      ? source.role.trim().toUpperCase()
      : source.role;

  if (!isPlatformRole(role)) {
    return null;
  }

  const memberId =
    source.memberId === undefined || source.memberId === null
      ? null
      : typeof source.memberId === 'string' &&
          source.memberId.trim().length > 0
        ? source.memberId.normalize('NFC').trim().toUpperCase()
        : null;

  if (role === 'MEMBER' && memberId === null) {
    return null;
  }

  return deepFreeze({
    role,
    memberId,
    actorId:
      typeof source.actorId === 'string' &&
      source.actorId.trim().length > 0
        ? source.actorId.normalize('NFC').trim()
        : typeof source.userId === 'string' &&
            source.userId.trim().length > 0
          ? source.userId.normalize('NFC').trim()
          : null,
  });
}

function normalizeOptionalString(value, name, maximum = 200) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.trim().length > maximum
  ) {
    throw new CompletedReportProviderError(
      COMPLETED_REPORT_PROVIDER_ERROR_CODES.INVALID_QUERY,
      `${name} must be a non-empty string of at most ${maximum} characters.`,
    );
  }

  return value.normalize('NFC').trim();
}

function normalizeQuery(value) {
  if (value === undefined || value === null) {
    return {
      documentType: null,
      claimNumber: null,
      memberId: null,
      requestId: null,
      search: null,
      limit: 50,
    };
  }

  if (!isPlainObject(value)) {
    throw new CompletedReportProviderError(
      COMPLETED_REPORT_PROVIDER_ERROR_CODES.INVALID_QUERY,
      'Completed report query must be a plain object.',
    );
  }

  const documentTypeValue = normalizeOptionalString(
    value.documentType,
    'Document type',
    10,
  );
  const documentType =
    documentTypeValue === null
      ? null
      : documentTypeValue.toUpperCase();

  if (
    documentType !== null &&
    documentType !== 'EOB' &&
    documentType !== 'EOR'
  ) {
    throw new CompletedReportProviderError(
      COMPLETED_REPORT_PROVIDER_ERROR_CODES.INVALID_QUERY,
      'Completed report document type must be EOB or EOR.',
    );
  }

  const limit = value.limit ?? 50;

  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MAXIMUM_RESULTS
  ) {
    throw new CompletedReportProviderError(
      COMPLETED_REPORT_PROVIDER_ERROR_CODES.INVALID_QUERY,
      `Completed report query limit must be between 1 and ${MAXIMUM_RESULTS}.`,
    );
  }

  const searchValue = value.search ?? value.query ?? value.q;
  const normalizedSearch = normalizeOptionalString(
    searchValue,
    'Completed report search',
  );

  return {
    documentType,
    claimNumber: normalizeOptionalString(
      value.claimNumber,
      'Claim number',
    ),
    memberId: normalizeOptionalString(
      value.memberId,
      'Member ID',
    ),
    requestId: normalizeOptionalString(
      value.requestId,
      'Request ID',
    ),
    search:
      normalizedSearch === null
        ? null
        : normalizedSearch
            .normalize('NFKC')
            .toLocaleLowerCase('en-US'),
    limit,
  };
}

function maskIdentifier(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }

  if (value.length <= 4) {
    return '*'.repeat(value.length);
  }

  return `${'*'.repeat(value.length - 4)}${value.slice(-4)}`;
}

function canAccessDocument(document, context) {
  if (PRIVILEGED_ROLES.has(context.role)) {
    return true;
  }

  if (context.role === 'MEMBER') {
    return document.memberId === context.memberId;
  }

  return SUPPORT_ROLES.has(context.role);
}

function selectIdentifier(value, context, kind) {
  if (
    PRIVILEGED_ROLES.has(context.role) ||
    context.role === 'MEMBER' ||
    (context.role === 'CSR' && kind === 'claim')
  ) {
    return value;
  }

  return maskIdentifier(value);
}

function getDocumentOutboundRecords(envelope, documentId) {
  return Object.values(envelope.outboundRecords)
    .filter(
      (record) =>
        isPlainObject(record) &&
        record.documentId === documentId,
    )
    .sort((left, right) => {
      const timestampDifference =
        Date.parse(left.createdAt) - Date.parse(right.createdAt);

      return timestampDifference !== 0
        ? timestampDifference
        : String(left.outboundId).localeCompare(
            String(right.outboundId),
            'en-US',
          );
    });
}

function resolveDeliveryStatus(records) {
  if (records.some((record) => record.status === 'SENT')) {
    return 'SENT';
  }

  if (records.some((record) => record.status === 'READY')) {
    return 'READY';
  }

  if (records.some((record) => record.status === 'COMPLETE')) {
    return 'COMPLETE';
  }

  if (
    records.length > 0 &&
    records.every(
      (record) => record.status === 'NOT_REQUESTED',
    )
  ) {
    return 'NOT_REQUESTED';
  }

  return records.length === 0 ? 'NOT_CREATED' : 'COMPLETE';
}

function createReportMetadata(envelope, document, context) {
  const request = envelope.requests[document.requestId] ?? null;
  const outboundRecords = getDocumentOutboundRecords(
    envelope,
    document.documentId,
  );

  return deepFreeze({
    reportId: document.documentId,
    documentId: document.documentId,
    documentType: document.documentType,
    status: document.status,
    claimNumber: selectIdentifier(
      document.claimNumber,
      context,
      'claim',
    ),
    memberId: selectIdentifier(
      document.memberId,
      context,
      'member',
    ),
    version: document.version,
    documentDate: document.documentDate,
    createdAt: document.createdAt,
    requestId: document.requestId,
    requestStatus:
      typeof request?.status === 'string'
        ? request.status
        : null,
    deliveryStatus: resolveDeliveryStatus(outboundRecords),
    outbound: outboundRecords.map((record) => ({
      outboundId: record.outboundId,
      kind: record.kind,
      status: record.status,
      createdAt: record.createdAt,
      transmitted: false,
    })),
    representativeOnly: true,
    downloadAvailable: document.status === DOCUMENT_STATUS_COMPLETE,
  });
}

function reportMatchesQuery(document, query) {
  if (
    query.documentType !== null &&
    document.documentType !== query.documentType
  ) {
    return false;
  }

  if (
    query.claimNumber !== null &&
    document.claimNumber !== query.claimNumber
  ) {
    return false;
  }

  if (
    query.memberId !== null &&
    document.memberId !== query.memberId
  ) {
    return false;
  }

  if (
    query.requestId !== null &&
    document.requestId !== query.requestId
  ) {
    return false;
  }

  if (query.search !== null) {
    const searchable = [
      document.documentId,
      document.documentType,
      document.claimNumber,
      document.memberId,
      document.requestId,
      document.documentDate,
    ]
      .join(' ')
      .toLocaleLowerCase('en-US');

    if (!searchable.includes(query.search)) {
      return false;
    }
  }

  return true;
}

function compareDocuments(left, right) {
  if (left.documentDate !== right.documentDate) {
    return right.documentDate.localeCompare(left.documentDate);
  }

  if (left.createdAt !== right.createdAt) {
    return (
      Date.parse(right.createdAt) - Date.parse(left.createdAt)
    );
  }

  if (left.version !== right.version) {
    return right.version - left.version;
  }

  return left.documentId.localeCompare(
    right.documentId,
    'en-US',
  );
}

function resolveDocumentByReportId(envelope, reportId) {
  const direct = envelope.documents[reportId];

  if (isPlainObject(direct)) {
    return direct;
  }

  const outbound = Object.values(envelope.outboundRecords).find(
    (record) =>
      isPlainObject(record) &&
      (record.outboundId === reportId ||
        record.payloadMasked?.reportId === reportId ||
        record.payloadMasked?.reportReference === reportId),
  );

  return outbound === undefined
    ? null
    : envelope.documents[outbound.documentId] ?? null;
}

function resolveContext(provider, value) {
  const supplied = normalizeContext(value);

  if (supplied !== null) {
    return supplied;
  }

  const provided = normalizeContext(
    readContextProvider(provider.contextProvider),
  );

  if (provided !== null) {
    return provided;
  }

  const fallback = normalizeContext(provider.defaultContext);

  if (fallback !== null) {
    return fallback;
  }

  throw new CompletedReportProviderError(
    COMPLETED_REPORT_PROVIDER_ERROR_CODES.INVALID_CONTEXT,
    'Completed report access requires a supported role and member ownership context when applicable.',
  );
}

/**
 * Error raised when completed report metadata cannot be read safely.
 */
export class CompletedReportProviderError extends Error {
  /**
   * @param {string} code Stable provider error code.
   * @param {string} message Human-readable error message.
   * @param {unknown} [details] Optional structured details.
   * @param {unknown} [cause] Original error.
   */
  constructor(code, message, details, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'CompletedReportProviderError';
    this.code = code;

    if (details !== undefined) {
      this.details = deepFreeze(details);
    }
  }
}

/**
 * Provides role-scoped completed report metadata without exposing artifact
 * keys, paths, fixture text, or outbound payloads.
 */
export class CompletedReportProvider {
  /**
   * @param {object|Record<string, unknown>} source Operations source.
   * @param {{
   *   contextProvider?: object|Function,
   *   sessionProvider?: object|Function,
   *   defaultContext?: Record<string, unknown>
   * }} [options] Provider options.
   */
  constructor(source, options = {}) {
    this.source = requireSource(source);
    this.contextProvider =
      options.contextProvider ??
      options.sessionProvider ??
      null;
    this.defaultContext = options.defaultContext ?? null;
  }

  /**
   * Lists completed reports visible to the supplied actor.
   *
   * @param {Record<string, unknown>|string} context Actor context or role.
   * @param {Record<string, unknown>} [query] Report filters.
   * @returns {Readonly<Record<string, unknown>>} Completed report DTO.
   */
  listCompletedReports(context, query = {}) {
    const actor = resolveContext(this, context);
    const normalizedQuery = normalizeQuery(query);
    const envelope = resolveEnvelope(readSource(this.source));
    const documents = Object.values(envelope.documents)
      .filter(isPlainObject)
      .filter(
        (document) =>
          document.status === DOCUMENT_STATUS_COMPLETE,
      )
      .filter((document) =>
        canAccessDocument(document, actor),
      )
      .filter((document) =>
        reportMatchesQuery(document, normalizedQuery),
      )
      .sort(compareDocuments);
    const items = documents
      .slice(0, normalizedQuery.limit)
      .map((document) =>
        createReportMetadata(envelope, document, actor),
      );

    return adaptCompletedReportDto({
      schemaVersion: SIBLING_CONTRACT_VERSION,
      dtoName: COMPLETED_REPORT_DTO_NAME,
      providerSchemaVersion:
        COMPLETED_REPORT_PROVIDER_SCHEMA_VERSION,
      revision:
        Number.isSafeInteger(envelope.revision) &&
        envelope.revision >= 0
          ? envelope.revision
          : 0,
      asOf:
        typeof envelope.updatedAt === 'string' &&
        Number.isFinite(Date.parse(envelope.updatedAt))
          ? new Date(envelope.updatedAt).toISOString()
          : null,
      total: documents.length,
      limit: normalizedQuery.limit,
      items,
      reports: items,
      representativeOnly: true,
      disclosure:
        'Role-scoped browser-local report metadata; artifact paths and outbound payloads are not included.',
    });
  }

  getCompletedReports(context, query = {}) {
    return this.listCompletedReports(context, query);
  }

  provideCompletedReports(context, query = {}) {
    return this.listCompletedReports(context, query);
  }

  /**
   * Returns status metadata for one visible completed report.
   *
   * Missing and unauthorized reports both return null to avoid disclosing
   * report existence across ownership boundaries.
   *
   * @param {string} reportId Report, document, or outbound identifier.
   * @param {Record<string, unknown>|string} context Actor context or role.
   * @returns {Readonly<Record<string, unknown>>|null} Status DTO or null.
   */
  getCompletedReportStatus(reportId, context) {
    if (
      typeof reportId !== 'string' ||
      reportId.trim().length === 0 ||
      reportId.trim().length > 200
    ) {
      throw new CompletedReportProviderError(
        COMPLETED_REPORT_PROVIDER_ERROR_CODES.INVALID_IDENTIFIER,
        'Completed report ID must be a non-empty string of at most 200 characters.',
      );
    }

    const actor = resolveContext(this, context);
    const envelope = resolveEnvelope(readSource(this.source));
    const document = resolveDocumentByReportId(
      envelope,
      reportId.normalize('NFC').trim(),
    );

    if (
      document === null ||
      document.status !== DOCUMENT_STATUS_COMPLETE ||
      !canAccessDocument(document, actor)
    ) {
      return null;
    }

    const report = createReportMetadata(
      envelope,
      document,
      actor,
    );

    return adaptCompletedReportDto({
      schemaVersion: SIBLING_CONTRACT_VERSION,
      dtoName: COMPLETED_REPORT_DTO_NAME,
      providerSchemaVersion:
        COMPLETED_REPORT_PROVIDER_SCHEMA_VERSION,
      revision:
        Number.isSafeInteger(envelope.revision) &&
        envelope.revision >= 0
          ? envelope.revision
          : 0,
      reportId: report.reportId,
      documentId: report.documentId,
      documentType: report.documentType,
      status: report.status,
      requestStatus: report.requestStatus,
      deliveryStatus: report.deliveryStatus,
      documentDate: report.documentDate,
      version: report.version,
      representativeOnly: true,
      transmitted: false,
    });
  }

  getCompletedReport(reportId, context) {
    return this.getCompletedReportStatus(reportId, context);
  }

  provideCompletedReportStatus(reportId, context) {
    return this.getCompletedReportStatus(reportId, context);
  }
}

/**
 * Creates a completed report provider.
 *
 * @param {ConstructorParameters<typeof CompletedReportProvider>[0]} source
 * Operations source.
 * @param {ConstructorParameters<typeof CompletedReportProvider>[1]} [options]
 * Provider options.
 * @returns {CompletedReportProvider} Completed report provider.
 */
export function createCompletedReportProvider(
  source,
  options = {},
) {
  return new CompletedReportProvider(source, options);
}

function getCachedProvider(source) {
  requireSource(source);

  const existing = providerCache.get(source);

  if (existing !== undefined) {
    return existing;
  }

  const provider = createCompletedReportProvider(source);

  providerCache.set(source, provider);
  return provider;
}

/**
 * Lists completed report metadata visible to an actor.
 *
 * @param {object|Record<string, unknown>} source Operations source.
 * @param {Record<string, unknown>|string} context Actor context or role.
 * @param {Record<string, unknown>} [query] Report filters.
 * @returns {Readonly<Record<string, unknown>>} Completed report DTO.
 */
export function listCompletedReports(
  source,
  context,
  query = {},
) {
  return getCachedProvider(source).listCompletedReports(
    context,
    query,
  );
}

/**
 * Returns status metadata for one visible completed report.
 *
 * @param {object|Record<string, unknown>} source Operations source.
 * @param {string} reportId Report identifier.
 * @param {Record<string, unknown>|string} context Actor context or role.
 * @returns {Readonly<Record<string, unknown>>|null} Status DTO or null.
 */
export function getCompletedReportStatus(
  source,
  reportId,
  context,
) {
  return getCachedProvider(source).getCompletedReportStatus(
    reportId,
    context,
  );
}

export const LocalCompletedReportProvider =
  CompletedReportProvider;
export const OperationsCompletedReportProvider =
  CompletedReportProvider;
export const createLocalCompletedReportProvider =
  createCompletedReportProvider;
export const getCompletedReports = listCompletedReports;
export const getCompletedReport = getCompletedReportStatus;

export default CompletedReportProvider;