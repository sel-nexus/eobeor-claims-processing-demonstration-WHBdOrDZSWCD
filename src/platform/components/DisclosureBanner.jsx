import PropTypes from 'prop-types';
import { Info } from 'lucide-react';

export const DISCLOSURE_BANNER_TITLE =
  'Static demonstration disclosures';

export const DISCLOSURE_BANNER_ITEMS = Object.freeze([
  Object.freeze({
    id: 'simulation',
    label: 'Simulation only',
    description:
      'All data and processing are fictional and run locally in your browser.',
  }),
  Object.freeze({
    id: 'authorization',
    label: 'Client-side authorization',
    description:
      'Demo role and access controls are enforced client-side and are not production authorization.',
  }),
  Object.freeze({
    id: 'transmission',
    label: 'No transmission',
    description:
      'No data is transmitted to external healthcare, payment, monitoring, or integration systems.',
  }),
  Object.freeze({
    id: 'production-context',
    label: 'Production context only',
    description:
      'Production security, compliance, identity, connectivity, and recovery controls are not provided.',
  }),
  Object.freeze({
    id: 'representative-documents',
    label: 'Representative documents',
    description:
      'Documents use fictional data and are not authoritative claim documents.',
  }),
]);

/**
 * Displays persistent honesty disclosures for the static demonstration.
 *
 * @param {{
 *   className?: string,
 *   compact?: boolean,
 *   id?: string,
 *   title?: string
 * }} props Component props.
 * @returns {JSX.Element} Disclosure banner.
 */
export function DisclosureBanner({
  className = '',
  compact = false,
  id = 'application-disclosure-banner',
  title = DISCLOSURE_BANNER_TITLE,
}) {
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;

  return (
    <aside
      id={id}
      className={`w-full border-b border-primary-200 bg-primary-50 text-content dark:border-primary-800 dark:bg-primary-950 dark:text-content-inverse ${className}`.trim()}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      role="note"
    >
      <div
        className={`mx-auto flex w-full max-w-7xl gap-3 px-4 sm:px-6 lg:px-8 ${
          compact ? 'py-2' : 'py-3'
        }`}
      >
        <Info
          className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
          aria-hidden="true"
        />
        <div className="min-w-0">
          <h2
            id={titleId}
            className="text-sm font-semibold text-primary-900 dark:text-primary-100"
          >
            {title}
          </h2>
          <ul
            id={descriptionId}
            className={`grid text-xs leading-5 text-primary-900 dark:text-primary-100 ${
              compact
                ? 'mt-0.5 gap-x-6 md:grid-cols-2 xl:grid-cols-3'
                : 'mt-1 gap-x-6 gap-y-1 md:grid-cols-2 xl:grid-cols-3'
            }`}
          >
            {DISCLOSURE_BANNER_ITEMS.map((item) => (
              <li key={item.id}>
                <span className="font-semibold">
                  {item.label}:
                </span>{' '}
                {item.description}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </aside>
  );
}

DisclosureBanner.propTypes = {
  className: PropTypes.string,
  compact: PropTypes.bool,
  id: PropTypes.string,
  title: PropTypes.string,
};

export const ComplianceDisclosureBanner = DisclosureBanner;
export const SimulationDisclosureBanner = DisclosureBanner;

export default DisclosureBanner;