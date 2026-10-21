import PropTypes from 'prop-types';
import { useId, useMemo } from 'react';
import {
  Building2,
  CalendarDays,
  CircleDollarSign,
  ClipboardList,
  CreditCard,
  FileText,
  HeartPulse,
  Info,
  Phone,
  Scale,
  ShieldCheck,
  UsersRound,
} from 'lucide-react';
import { DOCUMENT_DOWNLOAD_NOTICE } from '../../../fixtures/documents.js';
import StatusBadge from '../../../platform/components/StatusBadge.jsx';
import { redactForRole } from '../../../platform/security/maskingPolicy.js';
import {
  formatCurrency,
  formatCurrencyFromCents,
  formatDate,
  formatMaskedValue,
  formatStatus,
} from '../../../platform/utils/formatters.js';
import {
  isPlainObject,
  isPlatformRole,
} from '../../../platform/validation/schemas.js';

const EMPTY_COLLECTION = Object.freeze([]);
const PROVIDER_DOCUMENT_ROLES = new Set(['BOS', 'ADMIN']);

const SUMMARY_FIELDS = Object.freeze([
  Object.freeze({
    label: 'Provider billed',
    amountField: 'billedAmount',
    centsField: 'billedAmountCents',
  }),
  Object.freeze({
    label: 'Plan discount',
    amountField: 'discountAmount',
    centsField: 'discountAmountCents',
  }),
  Object.freeze({
    label: 'Allowed amount',
    amountField: 'allowedAmount',
    centsField: 'allowedAmountCents',
  }),
  Object.freeze({
    label: 'Plan paid',
    amountField: 'planPaidAmount',
    centsField: 'planPaidAmountCents',
  }),
  Object.freeze({
    label: 'Your responsibility',
    amountField: 'memberResponsibilityAmount',
    centsField: 'memberResponsibilityCents',
  }),
]);

function normalizeRole(value) {
  const role =
    typeof value === 'string'
      ? value.trim().toUpperCase()
      : value;

  return isPlatformRole(role) ? role : null;
}

function resolveActor(context, session, role) {
  const contextSource = isPlainObject(context?.session)
    ? context.session
    : isPlainObject(context?.actor)
      ? context.actor
      : isPlainObject(context)
        ? context
        : null;
  const sessionSource = isPlainObject(session) ? session : null;
  const source = contextSource ?? sessionSource ?? {};

  return {
    role: normalizeRole(role) ?? normalizeRole(source.role),
    memberId:
      typeof source.memberId === 'string' &&
      source.memberId.trim().length > 0
        ? source.memberId.normalize('NFC').trim()
        : null,
  };
}

function resolvePreviewSource(value, preview, document) {
  const source = preview ?? document ?? value;

  if (!isPlainObject(source)) {
    return {};
  }

  if (source.ok === true && isPlainObject(source.data)) {
    return source.data;
  }

  return source;
}

function normalizeCollection(value) {
  return Array.isArray(value) ? value : EMPTY_COLLECTION;
}

function getText(value, fallback = '—') {
  if (
    typeof value === 'string' &&
    value.trim().length > 0
  ) {
    return value;
  }

  if (
    typeof value === 'number' &&
    Number.isFinite(value)
  ) {
    return String(value);
  }

  return fallback;
}

function formatMoney(record, amountField, centsField) {
  if (
    typeof record?.[amountField] === 'number' &&
    Number.isFinite(record[amountField])
  ) {
    return formatCurrency(record[amountField]);
  }

  if (Number.isSafeInteger(record?.[centsField])) {
    return formatCurrencyFromCents(record[centsField]);
  }

  return '—';
}

function formatPaymentReference(value) {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0
  ) {
    return '—';
  }

  const normalized = value.trim();

  if (
    normalized.startsWith('[REDACTED') ||
    normalized.includes('*')
  ) {
    return normalized;
  }

  return formatMaskedValue(normalized);
}

function getDocumentTitle(documentType, source) {
  if (
    typeof source.documentTitle === 'string' &&
    source.documentTitle.trim().length > 0
  ) {
    return source.documentTitle;
  }

  return documentType === 'EOR'
    ? 'Explanation of Review'
    : 'Explanation of Benefits';
}

function getReasonCodeLabel(reason) {
  if (typeof reason === 'string') {
    return reason;
  }

  if (!isPlainObject(reason)) {
    return 'Processing reason';
  }

  const groupCode = getText(reason.groupCode, '');
  const code = getText(
    reason.code ?? reason.reasonCodeId,
    '',
  );
  const combined = `${groupCode}${code}`.trim();

  return (
    combined ||
    getText(reason.shortLabel, 'Processing reason')
  );
}

function getReasonCodeDescription(reason) {
  if (!isPlainObject(reason)) {
    return null;
  }

  return (
    reason.description ??
    reason.message ??
    reason.shortLabel ??
    null
  );
}

function resolveLineReasons(line) {
  if (Array.isArray(line.reasonCodes)) {
    return line.reasonCodes;
  }

  if (Array.isArray(line.reasonCodeIds)) {
    return line.reasonCodeIds;
  }

  return EMPTY_COLLECTION;
}

function getLineKey(line, index) {
  return (
    line.serviceLineId ??
    line.remittanceRowId ??
    `${line.lineNumber ?? 'line'}-${index}`
  );
}

function getContactLabel(contact, index) {
  if (typeof contact === 'string') {
    return `Contact ${index + 1}`;
  }

  return (
    contact.label ??
    contact.contactLabel ??
    contact.department ??
    contact.name ??
    `Contact ${index + 1}`
  );
}

function getContactValue(contact) {
  if (typeof contact === 'string') {
    return contact;
  }

  if (!isPlainObject(contact)) {
    return '—';
  }

  return (
    contact.value ??
    contact.phoneMasked ??
    contact.phone ??
    contact.email ??
    contact.contactReference ??
    contact.reference ??
    '—'
  );
}

function SummaryCard({ label, value }) {
  return (
    <div className="rounded-lg bg-surface-muted p-4 dark:bg-surface-dark">
      <dt className="text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
        {label}
      </dt>
      <dd className="mt-2 text-lg font-semibold tabular-nums text-content dark:text-content-inverse">
        {value}
      </dd>
    </div>
  );
}

SummaryCard.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.string.isRequired,
};

/**
 * Role-aware renderer for representative EOB and EOR preview data.
 *
 * @param {{
 *   value?: Record<string, unknown>,
 *   preview?: Record<string, unknown>,
 *   document?: Record<string, unknown>,
 *   session?: Record<string, unknown>|null,
 *   context?: Record<string, unknown>|null,
 *   role?: string,
 *   owned?: boolean,
 *   details?: Record<string, unknown>,
 *   serviceLines?: readonly Record<string, unknown>[],
 *   remittanceRows?: readonly Record<string, unknown>[],
 *   appeal?: Record<string, unknown>|null,
 *   coverage?: Record<string, unknown>|null,
 *   contacts?: readonly (Record<string, unknown>|string)[],
 *   className?: string
 * }} props Component props.
 * @returns {JSX.Element} Representative document preview.
 */
export function DocumentPreview({
  value,
  preview,
  document,
  session = null,
  context = null,
  role,
  owned,
  details,
  serviceLines,
  remittanceRows,
  appeal = null,
  coverage = null,
  contacts,
  className = '',
}) {
  const headingId = useId();
  const source = resolvePreviewSource(
    value,
    preview,
    document,
  );
  const actor = resolveActor(context, session, role);
  const sourceMemberId =
    typeof source.memberId === 'string'
      ? source.memberId
      : null;
  const actorOwnsDocument =
    owned ??
    (actor.role === 'MEMBER' &&
      actor.memberId !== null &&
      actor.memberId === sourceMemberId);
  const providerScoped =
    source.audienceScope === 'PROVIDER' ||
    source.layout?.audienceScope === 'PROVIDER';
  const accessUnavailable =
    providerScoped &&
    actor.role !== null &&
    !PROVIDER_DOCUMENT_ROLES.has(actor.role);

  const visible = useMemo(() => {
    const combined = {
      ...source,
      details:
        details ??
        source.details ??
        {},
      serviceLines:
        serviceLines ??
        details?.serviceLines ??
        source.details?.serviceLines ??
        source.serviceLines ??
        EMPTY_COLLECTION,
      remittanceRows:
        remittanceRows ??
        details?.remittanceRows ??
        source.details?.remittanceRows ??
        source.remittanceRows ??
        EMPTY_COLLECTION,
      appeal:
        appeal ??
        details?.appeal ??
        source.details?.appeal ??
        source.appeal ??
        null,
      coverage:
        coverage ??
        details?.coverage ??
        source.details?.coverage ??
        source.coverage ??
        null,
      contacts:
        contacts ??
        details?.contacts ??
        source.details?.contacts ??
        source.contacts ??
        EMPTY_COLLECTION,
    };

    if (actor.role === null) {
      return combined;
    }

    return redactForRole(combined, actor.role, {
      owned: actorOwnsDocument,
      fieldPolicies: {
        documentId: 'PRESERVE',
        requestId: 'PRESERVE',
        artifactKey: 'PRESERVE',
        layoutId: 'PRESERVE',
        appealId: 'PRESERVE',
        serviceLineId: 'PRESERVE',
        remittanceRowId: 'PRESERVE',
        reasonCodeId: 'PRESERVE',
        code: 'PRESERVE',
        groupCode: 'PRESERVE',
      },
    });
  }, [
    actor.role,
    actorOwnsDocument,
    appeal,
    contacts,
    coverage,
    details,
    remittanceRows,
    serviceLines,
    source,
  ]);

  if (accessUnavailable) {
    return (
      <section
        className={`rounded-xl border border-border bg-surface p-6 text-center shadow-card dark:border-border-dark dark:bg-surface-dark-muted ${className}`.trim()}
        role="alert"
      >
        <ShieldCheck
          className="mx-auto h-8 w-8 text-content-subtle dark:text-content-inverse-muted"
          aria-hidden="true"
        />
        <h2 className="mt-3 text-lg font-semibold text-content dark:text-content-inverse">
          Document preview unavailable
        </h2>
        <p className="mt-2 text-sm text-content-muted dark:text-content-inverse-muted">
          This provider-scoped representative document is not
          available to the current demo role.
        </p>
        <p className="mt-2 text-xs text-content-subtle dark:text-content-inverse-muted">
          No patient, claim, payment, or remittance details were
          displayed.
        </p>
      </section>
    );
  }

  const visibleDetails = isPlainObject(visible.details)
    ? visible.details
    : {};
  const documentType =
    visible.documentType === 'EOR' ? 'EOR' : 'EOB';
  const documentTitle = getDocumentTitle(
    documentType,
    visible,
  );
  const lineItems = normalizeCollection(
    visible.serviceLines,
  );
  const patientRows = normalizeCollection(
    visible.remittanceRows,
  );
  const visibleAppeal = isPlainObject(visible.appeal)
    ? visible.appeal
    : null;
  const visibleCoverage = isPlainObject(visible.coverage)
    ? visible.coverage
    : null;
  const visibleContacts = normalizeCollection(
    visible.contacts,
  );
  const provider = isPlainObject(visibleDetails.provider)
    ? visibleDetails.provider
    : isPlainObject(visible.provider)
      ? visible.provider
      : null;
  const providerName =
    visibleDetails.providerName ??
    provider?.name ??
    visible.providerName;
  const paymentReference =
    visibleDetails.paymentReferenceMasked ??
    visibleDetails.paymentReference ??
    visible.paymentReferenceMasked ??
    visible.paymentReference;
  const documentNotice =
    visible.documentNotice ??
    visibleDetails.documentNotice ??
    'This is not a bill.';
  const requiredDisclosures = normalizeCollection(
    visible.requiredDisclosures ??
      visibleDetails.requiredDisclosures,
  );

  return (
    <article
      className={`overflow-hidden rounded-xl border border-border bg-surface shadow-elevated dark:border-border-dark dark:bg-surface-dark-muted ${className}`.trim()}
      aria-labelledby={headingId}
    >
      <header className="border-b border-primary-200 bg-primary-50 p-5 dark:border-primary-800 dark:bg-primary-950 sm:p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-600 text-white shadow-sm">
              <FileText
                className="h-5 w-5"
                aria-hidden="true"
              />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-primary-700 dark:text-primary-300">
                Representative demo document
              </p>
              <h2
                id={headingId}
                className="mt-1 text-xl font-semibold tracking-tight text-content dark:text-content-inverse sm:text-2xl"
              >
                {documentTitle}
              </h2>
              <p className="mt-2 text-sm text-content-muted dark:text-content-inverse-muted">
                {documentType} · Version{' '}
                {getText(visible.version)}
              </p>
            </div>
          </div>
          <StatusBadge
            status={visible.status ?? 'COMPLETE'}
          />
        </div>

        <dl className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg bg-surface/80 p-3 dark:bg-surface-dark-muted">
            <dt className="text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
              Claim number
            </dt>
            <dd className="mt-1 break-all font-mono text-sm font-medium text-content dark:text-content-inverse">
              {getText(visible.claimNumber, 'Restricted')}
            </dd>
          </div>
          <div className="rounded-lg bg-surface/80 p-3 dark:bg-surface-dark-muted">
            <dt className="text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
              Member ID
            </dt>
            <dd className="mt-1 break-all font-mono text-sm font-medium text-content dark:text-content-inverse">
              {getText(visible.memberId, 'Restricted')}
            </dd>
          </div>
          <div className="rounded-lg bg-surface/80 p-3 dark:bg-surface-dark-muted">
            <dt className="text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
              Document date
            </dt>
            <dd className="mt-1 text-sm font-medium text-content dark:text-content-inverse">
              {formatDate(visible.documentDate)}
            </dd>
          </div>
          <div className="rounded-lg bg-surface/80 p-3 dark:bg-surface-dark-muted">
            <dt className="text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
              Document ID
            </dt>
            <dd className="mt-1 break-all font-mono text-sm font-medium text-content dark:text-content-inverse">
              {getText(visible.documentId, 'Representative')}
            </dd>
          </div>
        </dl>
      </header>

      <div className="space-y-8 p-5 sm:p-6">
        <section aria-labelledby={`${headingId}-claim`}>
          <div className="flex items-start gap-3">
            <HeartPulse
              className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
              aria-hidden="true"
            />
            <div>
              <h3
                id={`${headingId}-claim`}
                className="font-semibold text-content dark:text-content-inverse"
              >
                {documentType === 'EOR'
                  ? 'Review summary'
                  : 'Claim summary'}
              </h3>
              <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
                Fictional member, provider, coverage, and service
                information.
              </p>
            </div>
          </div>

          <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                Member
              </dt>
              <dd className="mt-1 text-sm font-medium text-content dark:text-content-inverse">
                {getText(
                  visibleDetails.memberName ??
                    visible.memberName,
                  'Restricted',
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                Provider
              </dt>
              <dd className="mt-1 text-sm font-medium text-content dark:text-content-inverse">
                {getText(
                  providerName,
                  'Fictional provider',
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                Service dates
              </dt>
              <dd className="mt-1 text-sm font-medium text-content dark:text-content-inverse">
                {formatDate(
                  visibleDetails.serviceDateFrom ??
                    visible.serviceDateFrom,
                )}
                {(visibleDetails.serviceDateTo ??
                  visible.serviceDateTo) !==
                (visibleDetails.serviceDateFrom ??
                  visible.serviceDateFrom)
                  ? ` – ${formatDate(
                      visibleDetails.serviceDateTo ??
                        visible.serviceDateTo,
                    )}`
                  : ''}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                {documentType === 'EOR'
                  ? 'Review status'
                  : 'Claim status'}
              </dt>
              <dd className="mt-1">
                <StatusBadge
                  status={
                    visibleDetails.reviewStatus ??
                    visibleDetails.claimStatus ??
                    visible.claimStatus ??
                    visible.status ??
                    'COMPLETE'
                  }
                />
              </dd>
            </div>
          </dl>
        </section>

        {visibleCoverage !== null ? (
          <section
            className="rounded-xl border border-border p-4 dark:border-border-dark"
            aria-labelledby={`${headingId}-coverage`}
          >
            <div className="flex items-center gap-2">
              <ShieldCheck
                className="h-5 w-5 text-primary-700 dark:text-primary-300"
                aria-hidden="true"
              />
              <h3
                id={`${headingId}-coverage`}
                className="font-semibold text-content dark:text-content-inverse"
              >
                Coverage
              </h3>
            </div>
            <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                  Plan
                </dt>
                <dd className="mt-1 text-sm font-medium text-content dark:text-content-inverse">
                  {getText(
                    visibleCoverage.planName ??
                      visibleCoverage.planId,
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                  Group
                </dt>
                <dd className="mt-1 font-mono text-sm font-medium text-content dark:text-content-inverse">
                  {getText(visibleCoverage.groupNumber)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                  Effective date
                </dt>
                <dd className="mt-1 text-sm font-medium text-content dark:text-content-inverse">
                  {formatDate(visibleCoverage.effectiveDate)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                  Status
                </dt>
                <dd className="mt-1">
                  <StatusBadge
                    status={
                      visibleCoverage.status ?? 'UNKNOWN'
                    }
                  />
                </dd>
              </div>
            </dl>
          </section>
        ) : null}

        <section aria-labelledby={`${headingId}-financial`}>
          <div className="flex items-start gap-3">
            <CircleDollarSign
              className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
              aria-hidden="true"
            />
            <div>
              <h3
                id={`${headingId}-financial`}
                className="font-semibold text-content dark:text-content-inverse"
              >
                Financial summary
              </h3>
              <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
                Representative amounts only. This is not a bill.
              </p>
            </div>
          </div>

          <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {SUMMARY_FIELDS.map((field) => (
              <SummaryCard
                key={field.label}
                label={field.label}
                value={formatMoney(
                  visibleDetails,
                  field.amountField,
                  field.centsField,
                )}
              />
            ))}
          </dl>

          {paymentReference !== undefined &&
          paymentReference !== null ? (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-border bg-surface-muted p-3 dark:border-border-dark dark:bg-surface-dark">
              <CreditCard
                className="mt-0.5 h-4 w-4 shrink-0 text-content-subtle dark:text-content-inverse-muted"
                aria-hidden="true"
              />
              <p className="text-sm text-content-muted dark:text-content-inverse-muted">
                Payment reference:{' '}
                <span className="font-mono font-semibold text-content dark:text-content-inverse">
                  {formatPaymentReference(paymentReference)}
                </span>
              </p>
            </div>
          ) : null}
        </section>

        <section aria-labelledby={`${headingId}-services`}>
          <div className="flex items-start gap-3">
            <ClipboardList
              className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
              aria-hidden="true"
            />
            <div>
              <h3
                id={`${headingId}-services`}
                className="font-semibold text-content dark:text-content-inverse"
              >
                Service details
              </h3>
              <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
                Fictional service lines and processing reason
                codes.
              </p>
            </div>
          </div>

          {lineItems.length === 0 ? (
            <div
              className="mt-4 rounded-lg bg-surface-muted p-4 text-sm text-content-muted dark:bg-surface-dark dark:text-content-inverse-muted"
              role="status"
            >
              No authorized service-line details are available.
            </div>
          ) : (
            <div className="mt-4 space-y-4">
              {lineItems.map((line, index) => {
                const reasons = resolveLineReasons(line);

                return (
                  <article
                    key={getLineKey(line, index)}
                    className="rounded-xl border border-border p-4 dark:border-border-dark"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
                          Service line{' '}
                          {line.lineNumber ?? index + 1}
                        </p>
                        <h4 className="mt-1 font-semibold text-content dark:text-content-inverse">
                          {getText(
                            line.procedureDescription,
                            'Fictional service',
                          )}
                        </h4>
                        <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
                          {formatDate(line.serviceDateFrom)}
                          {line.serviceDateTo !==
                          line.serviceDateFrom
                            ? ` – ${formatDate(
                                line.serviceDateTo,
                              )}`
                            : ''}
                        </p>
                      </div>
                      <StatusBadge
                        status={line.status ?? 'UNKNOWN'}
                      />
                    </div>

                    <dl className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-3 lg:grid-cols-6">
                      <div>
                        <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                          Procedure
                        </dt>
                        <dd className="mt-1 font-mono font-medium text-content dark:text-content-inverse">
                          {getText(line.procedureCode)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                          Units
                        </dt>
                        <dd className="mt-1 font-medium text-content dark:text-content-inverse">
                          {getText(line.units)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                          Billed
                        </dt>
                        <dd className="mt-1 font-medium text-content dark:text-content-inverse">
                          {formatMoney(
                            line,
                            'billedAmount',
                            'billedAmountCents',
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                          Allowed
                        </dt>
                        <dd className="mt-1 font-medium text-content dark:text-content-inverse">
                          {formatMoney(
                            line,
                            'allowedAmount',
                            'allowedAmountCents',
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                          Plan paid
                        </dt>
                        <dd className="mt-1 font-medium text-content dark:text-content-inverse">
                          {formatMoney(
                            line,
                            'planPaidAmount',
                            'planPaidAmountCents',
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                          Responsibility
                        </dt>
                        <dd className="mt-1 font-medium text-content dark:text-content-inverse">
                          {formatMoney(
                            line,
                            'memberResponsibilityAmount',
                            'memberResponsibilityCents',
                          )}
                        </dd>
                      </div>
                    </dl>

                    {reasons.length > 0 ? (
                      <div className="mt-4 border-t border-border pt-4 dark:border-border-dark">
                        <p className="text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
                          Reason codes
                        </p>
                        <ul className="mt-2 grid gap-2 md:grid-cols-2">
                          {reasons.map(
                            (reason, reasonIndex) => (
                              <li
                                key={`${getReasonCodeLabel(
                                  reason,
                                )}-${reasonIndex}`}
                                className="rounded-lg bg-surface-muted p-3 dark:bg-surface-dark"
                              >
                                <p className="font-mono text-sm font-semibold text-content dark:text-content-inverse">
                                  {getReasonCodeLabel(reason)}
                                </p>
                                {getReasonCodeDescription(
                                  reason,
                                ) !== null ? (
                                  <p className="mt-1 text-xs leading-5 text-content-muted dark:text-content-inverse-muted">
                                    {getReasonCodeDescription(
                                      reason,
                                    )}
                                  </p>
                                ) : null}
                              </li>
                            ),
                          )}
                        </ul>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {patientRows.length > 0 ? (
          <section aria-labelledby={`${headingId}-patients`}>
            <div className="flex items-start gap-3">
              <UsersRound
                className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
                aria-hidden="true"
              />
              <div>
                <h3
                  id={`${headingId}-patients`}
                  className="font-semibold text-content dark:text-content-inverse"
                >
                  Patient remittance rows
                </h3>
                <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
                  Provider-scoped fictional remittance details.
                </p>
              </div>
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {patientRows.map((row, index) => (
                <article
                  key={getLineKey(row, index)}
                  className="rounded-xl border border-border p-4 dark:border-border-dark"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h4 className="font-semibold text-content dark:text-content-inverse">
                        {getText(
                          row.memberName,
                          'Restricted patient',
                        )}
                      </h4>
                      <p className="mt-1 font-mono text-xs text-content-subtle dark:text-content-inverse-muted">
                        {getText(row.memberId, 'Restricted')}
                      </p>
                    </div>
                    <StatusBadge
                      status={row.status ?? 'COMPLETE'}
                    />
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                        Claim
                      </dt>
                      <dd className="mt-1 break-all font-mono font-medium text-content dark:text-content-inverse">
                        {getText(row.claimNumber)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                        Provider
                      </dt>
                      <dd className="mt-1 font-medium text-content dark:text-content-inverse">
                        {getText(
                          row.providerName ??
                            row.providerId,
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                        Allowed
                      </dt>
                      <dd className="mt-1 font-medium text-content dark:text-content-inverse">
                        {formatMoney(
                          row,
                          'allowedAmount',
                          'allowedAmountCents',
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                        Plan paid
                      </dt>
                      <dd className="mt-1 font-medium text-content dark:text-content-inverse">
                        {formatMoney(
                          row,
                          'planPaidAmount',
                          'planPaidAmountCents',
                        )}
                      </dd>
                    </div>
                  </dl>
                  {row.paymentReferenceMasked ? (
                    <p className="mt-3 text-xs text-content-muted dark:text-content-inverse-muted">
                      Payment reference:{' '}
                      <span className="font-mono font-semibold">
                        {formatPaymentReference(
                          row.paymentReferenceMasked,
                        )}
                      </span>
                    </p>
                  ) : null}
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {provider !== null ? (
          <section
            className="rounded-xl border border-border p-4 dark:border-border-dark"
            aria-labelledby={`${headingId}-provider`}
          >
            <div className="flex items-center gap-2">
              <Building2
                className="h-5 w-5 text-primary-700 dark:text-primary-300"
                aria-hidden="true"
              />
              <h3
                id={`${headingId}-provider`}
                className="font-semibold text-content dark:text-content-inverse"
              >
                Provider information
              </h3>
            </div>
            <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                  Name
                </dt>
                <dd className="mt-1 text-sm font-medium text-content dark:text-content-inverse">
                  {getText(provider.name)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                  Provider ID
                </dt>
                <dd className="mt-1 break-all font-mono text-sm font-medium text-content dark:text-content-inverse">
                  {getText(provider.providerId)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                  NPI
                </dt>
                <dd className="mt-1 break-all font-mono text-sm font-medium text-content dark:text-content-inverse">
                  {getText(provider.npi)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                  Network
                </dt>
                <dd className="mt-1 text-sm font-medium text-content dark:text-content-inverse">
                  {formatStatus(provider.networkStatus)}
                </dd>
              </div>
            </dl>
          </section>
        ) : null}

        {visibleAppeal !== null ? (
          <section
            className="rounded-xl border border-primary-200 bg-primary-50 p-4 dark:border-primary-800 dark:bg-primary-950"
            aria-labelledby={`${headingId}-appeal`}
          >
            <div className="flex items-start gap-3">
              <Scale
                className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
                aria-hidden="true"
              />
              <div className="min-w-0">
                <h3
                  id={`${headingId}-appeal`}
                  className="font-semibold text-primary-900 dark:text-primary-100"
                >
                  Questions and appeal rights
                </h3>
                <p className="mt-2 text-sm leading-6 text-primary-900 dark:text-primary-100">
                  {getText(
                    visibleAppeal.summary,
                    'Contact demo support with questions about this fictional document.',
                  )}
                </p>
                {visibleAppeal.deadlineDescription ? (
                  <p className="mt-2 text-sm font-medium text-primary-900 dark:text-primary-100">
                    {visibleAppeal.deadlineDescription}
                  </p>
                ) : null}
                {Array.isArray(
                  visibleAppeal.instructions,
                ) &&
                visibleAppeal.instructions.length > 0 ? (
                  <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm leading-6 text-primary-900 dark:text-primary-100">
                    {visibleAppeal.instructions.map(
                      (instruction, index) => (
                        <li key={`${instruction}-${index}`}>
                          {instruction}
                        </li>
                      ),
                    )}
                  </ol>
                ) : null}
              </div>
            </div>
          </section>
        ) : null}

        {visibleContacts.length > 0 ? (
          <section aria-labelledby={`${headingId}-contacts`}>
            <div className="flex items-center gap-2">
              <Phone
                className="h-5 w-5 text-primary-700 dark:text-primary-300"
                aria-hidden="true"
              />
              <h3
                id={`${headingId}-contacts`}
                className="font-semibold text-content dark:text-content-inverse"
              >
                Contact information
              </h3>
            </div>
            <dl className="mt-4 grid gap-3 sm:grid-cols-2">
              {visibleContacts.map((contact, index) => (
                <div
                  key={`${getContactLabel(
                    contact,
                    index,
                  )}-${index}`}
                  className="rounded-lg bg-surface-muted p-3 dark:bg-surface-dark"
                >
                  <dt className="text-xs font-semibold text-content-subtle dark:text-content-inverse-muted">
                    {getContactLabel(contact, index)}
                  </dt>
                  <dd className="mt-1 break-words text-sm font-medium text-content dark:text-content-inverse">
                    {getContactValue(contact)}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}

        <aside
          className="rounded-xl border border-warning-200 bg-warning-50 p-4 dark:border-warning-700 dark:bg-warning-950"
          role="note"
          aria-label="Representative document notice"
        >
          <div className="flex items-start gap-3">
            <Info
              className="mt-0.5 h-5 w-5 shrink-0 text-warning-700 dark:text-warning-100"
              aria-hidden="true"
            />
            <div>
              <p className="font-semibold text-warning-700 dark:text-warning-100">
                {documentNotice}
              </p>
              <p className="mt-1 text-sm leading-6 text-warning-700 dark:text-warning-100">
                {DOCUMENT_DOWNLOAD_NOTICE}
              </p>
              {requiredDisclosures.length > 0 ? (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-warning-700 dark:text-warning-100">
                  {requiredDisclosures.map(
                    (disclosure, index) => (
                      <li key={`${disclosure}-${index}`}>
                        {disclosure}
                      </li>
                    ),
                  )}
                </ul>
              ) : null}
              <p className="mt-2 text-xs leading-5 text-warning-700 dark:text-warning-100">
                The preview is rendered from static,
                browser-local fictional data. No payer, provider,
                healthcare, payment, document-delivery, or fax
                system was contacted.
              </p>
            </div>
          </div>
        </aside>

        <p className="flex items-center gap-2 text-xs text-content-subtle dark:text-content-inverse-muted">
          <CalendarDays
            className="h-4 w-4 shrink-0"
            aria-hidden="true"
          />
          Created {formatDate(visible.createdAt)} · Role-aware
          redaction applied for {actor.role ?? 'supplied preview'}
        </p>
      </div>
    </article>
  );
}

DocumentPreview.propTypes = {
  value: PropTypes.object,
  preview: PropTypes.object,
  document: PropTypes.object,
  session: PropTypes.object,
  context: PropTypes.object,
  role: PropTypes.string,
  owned: PropTypes.bool,
  details: PropTypes.object,
  serviceLines: PropTypes.arrayOf(PropTypes.object),
  remittanceRows: PropTypes.arrayOf(PropTypes.object),
  appeal: PropTypes.object,
  coverage: PropTypes.object,
  contacts: PropTypes.arrayOf(
    PropTypes.oneOfType([
      PropTypes.object,
      PropTypes.string,
    ]),
  ),
  className: PropTypes.string,
};

export const EobEorDocumentPreview = DocumentPreview;
export const RepresentativeDocumentPreview = DocumentPreview;
export const RoleAwareDocumentPreview = DocumentPreview;

export default DocumentPreview;