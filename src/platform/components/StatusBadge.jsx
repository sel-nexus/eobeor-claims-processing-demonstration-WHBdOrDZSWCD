import PropTypes from 'prop-types';
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Loader2,
  XCircle,
} from 'lucide-react';

export const STATUS_BADGE_VARIANTS = Object.freeze({
  SUCCESS: 'success',
  WARNING: 'warning',
  ERROR: 'error',
  PROCESSING: 'processing',
  NEUTRAL: 'neutral',
});

const VARIANT_VALUES = Object.freeze(
  Object.values(STATUS_BADGE_VARIANTS),
);

const VARIANT_CONFIG = Object.freeze({
  [STATUS_BADGE_VARIANTS.SUCCESS]: Object.freeze({
    Icon: CheckCircle2,
    className:
      'border-success-200 bg-success-50 text-success-700 dark:border-success-700 dark:bg-success-950 dark:text-success-100',
  }),
  [STATUS_BADGE_VARIANTS.WARNING]: Object.freeze({
    Icon: AlertTriangle,
    className:
      'border-warning-200 bg-warning-50 text-warning-700 dark:border-warning-700 dark:bg-warning-950 dark:text-warning-100',
  }),
  [STATUS_BADGE_VARIANTS.ERROR]: Object.freeze({
    Icon: XCircle,
    className:
      'border-danger-200 bg-danger-50 text-danger-700 dark:border-danger-700 dark:bg-danger-950 dark:text-danger-100',
  }),
  [STATUS_BADGE_VARIANTS.PROCESSING]: Object.freeze({
    Icon: Loader2,
    className:
      'border-primary-200 bg-primary-50 text-primary-700 dark:border-primary-700 dark:bg-primary-950 dark:text-primary-100',
    iconClassName: 'animate-spin motion-reduce:animate-none',
  }),
  [STATUS_BADGE_VARIANTS.NEUTRAL]: Object.freeze({
    Icon: Circle,
    className:
      'border-border-strong bg-surface-muted text-content-muted dark:border-border-dark-strong dark:bg-surface-dark-muted dark:text-content-inverse-muted',
  }),
});

const SUCCESS_STATUSES = new Set([
  'ACTIVE',
  'APPLIED',
  'APPROVED',
  'COMPLETE',
  'COMPLETED',
  'HEALTHY',
  'PASSED',
  'SENT',
  'SUCCESS',
]);

const WARNING_STATUSES = new Set([
  'MANUAL_REVIEW',
  'PAUSED',
  'PENDING',
  'QUEUED',
  'READY',
  'WARNING',
]);

const ERROR_STATUSES = new Set([
  'CANCELLED',
  'CRITICAL',
  'DENIED',
  'ERROR',
  'FAILED',
  'REJECTED',
]);

const PROCESSING_STATUSES = new Set([
  'HYDRATING',
  'IN_PROGRESS',
  'PARSING',
  'PROCESSING',
  'RUNNING',
]);

function normalizeStatus(status) {
  return typeof status === 'string'
    ? status
        .normalize('NFC')
        .trim()
        .replace(/[\s-]+/g, '_')
        .toUpperCase()
    : '';
}

function resolveVariant(variant, status) {
  if (
    typeof variant === 'string' &&
    VARIANT_VALUES.includes(variant.toLowerCase())
  ) {
    return variant.toLowerCase();
  }

  const normalizedStatus = normalizeStatus(status);

  if (SUCCESS_STATUSES.has(normalizedStatus)) {
    return STATUS_BADGE_VARIANTS.SUCCESS;
  }

  if (WARNING_STATUSES.has(normalizedStatus)) {
    return STATUS_BADGE_VARIANTS.WARNING;
  }

  if (ERROR_STATUSES.has(normalizedStatus)) {
    return STATUS_BADGE_VARIANTS.ERROR;
  }

  if (PROCESSING_STATUSES.has(normalizedStatus)) {
    return STATUS_BADGE_VARIANTS.PROCESSING;
  }

  return STATUS_BADGE_VARIANTS.NEUTRAL;
}

function formatStatus(status) {
  const normalized = normalizeStatus(status);

  if (normalized.length === 0) {
    return 'Status';
  }

  return normalized
    .split('_')
    .map((word) => {
      const lowercase = word.toLocaleLowerCase('en-US');

      return `${lowercase.charAt(0).toUpperCase()}${lowercase.slice(1)}`;
    })
    .join(' ');
}

/**
 * Displays an accessible text-and-icon status badge.
 *
 * When no variant is supplied, the component derives a suitable variant from
 * common status values. Visible text is always rendered so color and icon
 * shape are not the only indicators of status.
 *
 * @param {{
 *   ariaLabel?: string,
 *   children?: React.ReactNode,
 *   className?: string,
 *   label?: React.ReactNode,
 *   showIcon?: boolean,
 *   status?: string,
 *   title?: string,
 *   variant?: 'success'|'warning'|'error'|'processing'|'neutral'
 * }} props Component props.
 * @returns {JSX.Element} Status badge.
 */
export function StatusBadge({
  ariaLabel,
  children,
  className = '',
  label,
  showIcon = true,
  status,
  title,
  variant,
}) {
  const resolvedVariant = resolveVariant(variant, status);
  const config = VARIANT_CONFIG[resolvedVariant];
  const Icon = config.Icon;
  const content =
    children ?? label ?? formatStatus(status);

  return (
    <span
      className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium leading-none ${config.className} ${className}`.trim()}
      role="status"
      aria-label={ariaLabel}
      title={title}
      data-status-variant={resolvedVariant}
    >
      {showIcon ? (
        <Icon
          className={`h-3.5 w-3.5 shrink-0 ${
            config.iconClassName ?? ''
          }`.trim()}
          aria-hidden="true"
        />
      ) : null}
      <span className="min-w-0 truncate">{content}</span>
    </span>
  );
}

StatusBadge.propTypes = {
  ariaLabel: PropTypes.string,
  children: PropTypes.node,
  className: PropTypes.string,
  label: PropTypes.node,
  showIcon: PropTypes.bool,
  status: PropTypes.string,
  title: PropTypes.string,
  variant: PropTypes.oneOf(VARIANT_VALUES),
};

export const AccessibleStatusBadge = StatusBadge;

export default StatusBadge;