import PropTypes from 'prop-types';
import {
  useEffect,
  useId,
  useMemo,
  useState,
} from 'react';
import {
  AlertCircle,
  Bot,
  Database,
  FileSearch,
  Globe,
  Layers3,
  Loader2,
  MonitorCog,
  Plug,
  RefreshCw,
  Search,
  ShieldCheck,
  Waypoints,
  WifiOff,
  X,
} from 'lucide-react';
import {
  INTEGRATION_INVENTORY_FIXTURE,
} from '../../../fixtures/insights.js';
import AccessDenied from '../../../platform/components/AccessDenied.jsx';
import StatusBadge from '../../../platform/components/StatusBadge.jsx';
import {
  isPlainObject,
  isPlatformRole,
} from '../../../platform/validation/schemas.js';

const AUTHORIZED_ROLES = new Set(['ITS', 'ADMIN']);
const EMPTY_COLLECTION = Object.freeze([]);

const LAYER_PRESENTATION = Object.freeze({
  DATA: Object.freeze({
    label: 'Data',
    description:
      'Bundled fixture collections and same-origin representative document assets.',
    Icon: Database,
  }),
  AI_AGENT: Object.freeze({
    label: 'AI agent',
    description:
      'Deterministic local functions labeled as agents for workflow demonstration.',
    Icon: Bot,
  }),
  APPLICATION: Object.freeze({
    label: 'Application',
    description:
      'Browser SPA routes and role-aware local workspaces.',
    Icon: MonitorCog,
  }),
  INTEGRATION: Object.freeze({
    label: 'Integration',
    description:
      'Browser-local queue, feed, reporting, and handoff representations.',
    Icon: Waypoints,
  }),
  EXTERNAL: Object.freeze({
    label: 'External',
    description:
      'Conceptual production dependencies that are not connected by this demonstration.',
    Icon: Globe,
  }),
});

const CONNECTION_TYPE_LABELS = Object.freeze({
  SYNC: 'Sync',
  ASYNC: 'Async',
  BATCH: 'Batch',
  REAL_TIME: 'Real-time',
});

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

function unwrapServiceResult(result, fallback) {
  if (result?.ok === false) {
    throw new Error(result.error?.message ?? fallback);
  }

  return result?.ok === true ? result.data : result;
}

function normalizeInventoryResult(result) {
  const value = unwrapServiceResult(
    result,
    'The simulated integration inventory could not be loaded.',
  );
  const inventory = isPlainObject(value?.inventory)
    ? value.inventory
    : value;

  if (
    !isPlainObject(inventory) ||
    !Array.isArray(inventory.items) ||
    !Array.isArray(inventory.layers) ||
    !Array.isArray(inventory.connectionTypes)
  ) {
    throw new TypeError(
      'The local integration inventory returned invalid data.',
    );
  }

  return {
    ...inventory,
    items: inventory.items.filter(isPlainObject),
  };
}

function resolveInventoryReader(service) {
  if (service === null || service === undefined) {
    return null;
  }

  if (typeof service.list === 'function') {
    return service.list.bind(service);
  }

  if (typeof service.getInventory === 'function') {
    return service.getInventory.bind(service);
  }

  if (
    typeof service.getIntegrationInventory === 'function'
  ) {
    return service.getIntegrationInventory.bind(service);
  }

  if (typeof service.listIntegrations === 'function') {
    return service.listIntegrations.bind(service);
  }

  return null;
}

function normalizeSearchText(value) {
  return typeof value === 'string'
    ? value
        .normalize('NFKC')
        .trim()
        .toLocaleLowerCase('en-US')
    : '';
}

function getLayerPresentation(layer) {
  return (
    LAYER_PRESENTATION[layer] ?? {
      label:
        typeof layer === 'string'
          ? layer.replace(/_/g, ' ')
          : 'Architecture layer',
      description:
        'Conceptual browser-local architecture layer.',
      Icon: Layers3,
    }
  );
}

function getConnectionTypeLabel(connectionType) {
  return (
    CONNECTION_TYPE_LABELS[connectionType] ??
    String(connectionType ?? '')
      .replace(/_/g, ' ')
      .toLocaleLowerCase('en-US')
      .replace(/^./, (character) =>
        character.toLocaleUpperCase('en-US'),
      )
  );
}

function getIntegrationKey(integration, index) {
  return (
    integration.integrationId ??
    `integration-inventory-${index}`
  );
}

function integrationMatchesFilters(
  integration,
  layer,
  connectionType,
  query,
) {
  if (
    layer.length > 0 &&
    integration.layer !== layer
  ) {
    return false;
  }

  if (
    connectionType.length > 0 &&
    (!Array.isArray(integration.connectionTypes) ||
      !integration.connectionTypes.includes(connectionType))
  ) {
    return false;
  }

  if (query.length === 0) {
    return true;
  }

  return [
    integration.integrationId,
    integration.name,
    ...(Array.isArray(integration.aliases)
      ? integration.aliases
      : []),
    integration.layer,
    ...(Array.isArray(integration.connectionTypes)
      ? integration.connectionTypes
      : []),
    integration.status,
    integration.description,
  ]
    .filter(
      (value) =>
        value !== null && value !== undefined,
    )
    .join(' ')
    .toLocaleLowerCase('en-US')
    .includes(query);
}

/**
 * Simulated integration inventory and architecture-layer route.
 *
 * @param {{
 *   session?: Record<string, unknown>|null,
 *   context?: Record<string, unknown>|null,
 *   integrationInventoryFacade?: object,
 *   integrationFacade?: object,
 *   insightsRepository?: object,
 *   initialInventory?: Record<string, unknown>
 * }} props Component props.
 * @returns {JSX.Element} Integration inventory page.
 */
export function IntegrationsPage({
  session = null,
  context = null,
  integrationInventoryFacade = null,
  integrationFacade = null,
  insightsRepository = null,
  initialInventory = INTEGRATION_INVENTORY_FIXTURE,
}) {
  const headingId = useId();
  const searchId = useId();
  const layerId = useId();
  const connectionTypeId = useId();
  const accessContext = useMemo(
    () => normalizeContext(context ?? session),
    [context, session],
  );
  const role = accessContext?.role ?? null;
  const authenticated = accessContext !== null;
  const service =
    integrationInventoryFacade ??
    integrationFacade ??
    insightsRepository;
  const inventoryReader = useMemo(
    () => resolveInventoryReader(service),
    [service],
  );
  const [inventory, setInventory] = useState(initialInventory);
  const [loading, setLoading] = useState(
    inventoryReader !== null,
  );
  const [loadError, setLoadError] = useState(null);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [layer, setLayer] = useState('');
  const [connectionType, setConnectionType] = useState('');
  const [reloadSequence, setReloadSequence] = useState(0);

  useEffect(() => {
    let active = true;

    const loadInventory = async () => {
      if (
        !authenticated ||
        role === null ||
        !AUTHORIZED_ROLES.has(role)
      ) {
        setLoading(false);
        return;
      }

      if (inventoryReader === null) {
        setInventory(initialInventory);
        setLoading(false);
        setLoadError(null);
        return;
      }

      setLoading(true);
      setLoadError(null);

      try {
        const result = await Promise.resolve(
          inventoryReader(
            {
              page: 1,
              limit: 100,
            },
            accessContext,
          ),
        );
        const nextInventory =
          normalizeInventoryResult(result);

        if (active) {
          setInventory(nextInventory);
        }
      } catch (error) {
        if (active) {
          setInventory(initialInventory);
          setLoadError(
            normalizeErrorMessage(
              error,
              'The simulated integration inventory could not be loaded.',
            ),
          );
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    loadInventory().catch((error) => {
      if (active) {
        setLoading(false);
        setInventory(initialInventory);
        setLoadError(
          normalizeErrorMessage(
            error,
            'The simulated integration inventory could not be loaded.',
          ),
        );
      }
    });

    return () => {
      active = false;
    };
  }, [
    accessContext,
    authenticated,
    initialInventory,
    inventoryReader,
    reloadSequence,
    role,
  ]);

  const items = Array.isArray(inventory?.items)
    ? inventory.items
    : EMPTY_COLLECTION;
  const layers = Array.isArray(inventory?.layers)
    ? inventory.layers
    : EMPTY_COLLECTION;
  const connectionTypes = Array.isArray(
    inventory?.connectionTypes,
  )
    ? inventory.connectionTypes
    : EMPTY_COLLECTION;
  const normalizedSearch = normalizeSearchText(search);
  const filteredItems = useMemo(
    () =>
      items.filter((integration) =>
        integrationMatchesFilters(
          integration,
          layer,
          connectionType,
          normalizedSearch,
        ),
      ),
    [
      connectionType,
      items,
      layer,
      normalizedSearch,
    ],
  );
  const layerCounts = useMemo(
    () =>
      Object.fromEntries(
        layers.map((layerName) => [
          layerName,
          items.filter(
            (integration) =>
              integration.layer === layerName,
          ).length,
        ]),
      ),
    [items, layers],
  );
  const filtersActive =
    search.length > 0 ||
    searchInput.length > 0 ||
    layer.length > 0 ||
    connectionType.length > 0;

  const handleSearch = (event) => {
    event.preventDefault();
    setSearch(searchInput.normalize('NFKC').trim());
  };

  const clearFilters = () => {
    setSearchInput('');
    setSearch('');
    setLayer('');
    setConnectionType('');
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
              <Plug
                className="h-6 w-6"
                aria-hidden="true"
              />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-primary-700 dark:text-primary-300">
                Simulated architecture inventory
              </p>
              <h1
                id={headingId}
                className="mt-1 text-2xl font-semibold tracking-tight text-content dark:text-content-inverse sm:text-3xl"
              >
                Integration inventory
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-content-muted dark:text-content-inverse-muted sm:text-base">
                Review conceptual integration aliases,
                architecture layers, connection patterns, and
                exact fixture status phrases.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row lg:justify-end">
            <span className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-success-200 bg-success-50 px-4 py-2 text-sm font-semibold text-success-700 dark:border-success-700 dark:bg-surface-dark dark:text-success-100">
              <WifiOff
                className="h-4 w-4"
                aria-hidden="true"
              />
              Network enabled: No
            </span>
            <button
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border-strong bg-surface px-4 py-2 text-sm font-semibold text-content transition hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark-muted dark:text-content-inverse dark:hover:bg-surface-dark-raised dark:focus:ring-offset-primary-950"
              type="button"
              disabled={loading}
              onClick={() =>
                setReloadSequence((current) => current + 1)
              }
            >
              {loading ? (
                <Loader2
                  className="h-4 w-4 animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              ) : (
                <RefreshCw
                  className="h-4 w-4"
                  aria-hidden="true"
                />
              )}
              {loading ? 'Loading locally…' : 'Refresh inventory'}
            </button>
          </div>
        </div>
      </header>

      <aside
        className="mt-5 rounded-xl border border-primary-200 bg-primary-50 p-4 text-sm text-primary-900 dark:border-primary-800 dark:bg-primary-950 dark:text-primary-100"
        role="note"
        aria-label="Integration inventory disclosure"
      >
        <div className="flex items-start gap-3">
          <ShieldCheck
            className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
            aria-hidden="true"
          />
          <div>
            <p className="font-semibold">
              No live connectivity is configured.
            </p>
            <p className="mt-1 leading-6">
              Every row is a bundled architecture fixture. Sync,
              Async, Batch, and Real-time labels describe
              conceptual connection patterns only. No database,
              queue, payer, provider, healthcare, identity,
              reporting, monitoring, delivery, or external
              integration service is contacted.
            </p>
          </div>
        </div>
      </aside>

      {loadError !== null ? (
        <div
          className="mt-5 flex items-start gap-2 rounded-lg border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-700 dark:border-warning-700 dark:bg-warning-950 dark:text-warning-100"
          role="alert"
        >
          <AlertCircle
            className="mt-0.5 h-4 w-4 shrink-0"
            aria-hidden="true"
          />
          <span>
            {loadError} The exact bundled inventory is displayed
            instead.
          </span>
        </div>
      ) : null}

      <section
        className="mt-8"
        aria-labelledby="architecture-layers-heading"
      >
        <div className="flex items-start gap-3">
          <Layers3
            className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
            aria-hidden="true"
          />
          <div>
            <h2
              id="architecture-layers-heading"
              className="text-xl font-semibold text-content dark:text-content-inverse"
            >
              Architecture layers
            </h2>
            <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
              The inventory is organized into five conceptual
              layers.
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {layers.map((layerName) => {
            const presentation =
              getLayerPresentation(layerName);
            const LayerIcon = presentation.Icon;
            const selected = layer === layerName;

            return (
              <button
                key={layerName}
                className={`min-h-48 rounded-xl border p-5 text-left shadow-card transition focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-surface-dark ${
                  selected
                    ? 'border-primary-500 bg-primary-50 dark:border-primary-600 dark:bg-primary-950'
                    : 'border-border bg-surface hover:border-primary-300 hover:shadow-elevated dark:border-border-dark dark:bg-surface-dark-muted dark:hover:border-primary-700'
                }`}
                type="button"
                aria-pressed={selected}
                onClick={() => {
                  setLayer((current) =>
                    current === layerName ? '' : layerName,
                  );
                }}
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-100 text-primary-700 dark:bg-primary-900 dark:text-primary-100">
                  <LayerIcon
                    className="h-5 w-5"
                    aria-hidden="true"
                  />
                </span>
                <span className="mt-4 block font-semibold text-content dark:text-content-inverse">
                  {presentation.label}
                </span>
                <span className="mt-2 block text-sm leading-5 text-content-muted dark:text-content-inverse-muted">
                  {presentation.description}
                </span>
                <span className="mt-3 block text-xs font-semibold text-primary-700 dark:text-primary-300">
                  {layerCounts[layerName] ?? 0}{' '}
                  {(layerCounts[layerName] ?? 0) === 1
                    ? 'inventory row'
                    : 'inventory rows'}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section
        className="mt-8 rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted sm:p-6"
        aria-labelledby="inventory-filters-heading"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2
              id="inventory-filters-heading"
              className="text-lg font-semibold text-content dark:text-content-inverse"
            >
              Inventory filters
            </h2>
            <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
              Search names, aliases, statuses, descriptions, or
              connection labels.
            </p>
          </div>

          {filtersActive ? (
            <button
              className="inline-flex min-h-10 items-center justify-center gap-2 self-start rounded-lg px-3 py-2 text-sm font-semibold text-content-muted transition hover:bg-surface-muted hover:text-content focus:outline-none focus:ring-2 focus:ring-primary-500 dark:text-content-inverse-muted dark:hover:bg-surface-dark-raised dark:hover:text-content-inverse"
              type="button"
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
          <div className="sm:col-span-2 lg:col-span-1">
            <label
              className="block text-sm font-medium text-content dark:text-content-inverse"
              htmlFor={searchId}
            >
              Search inventory
            </label>
            <div className="relative mt-2">
              <Search
                className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-content-subtle dark:text-content-inverse-muted"
                aria-hidden="true"
              />
              <input
                id={searchId}
                className="block min-h-11 w-full rounded-lg border border-border-strong bg-surface py-2 pl-10 pr-3 text-sm text-content shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
                type="search"
                value={searchInput}
                maxLength={200}
                autoComplete="off"
                placeholder="Queue, IXIT, SSO, storage…"
                onChange={(event) =>
                  setSearchInput(event.target.value)
                }
              />
            </div>
          </div>

          <div>
            <label
              className="block text-sm font-medium text-content dark:text-content-inverse"
              htmlFor={layerId}
            >
              Architecture layer
            </label>
            <select
              id={layerId}
              className="mt-2 block min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-content shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
              value={layer}
              onChange={(event) =>
                setLayer(event.target.value)
              }
            >
              <option value="">All layers</option>
              {layers.map((layerName) => (
                <option key={layerName} value={layerName}>
                  {getLayerPresentation(layerName).label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              className="block text-sm font-medium text-content dark:text-content-inverse"
              htmlFor={connectionTypeId}
            >
              Connection label
            </label>
            <select
              id={connectionTypeId}
              className="mt-2 block min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-content shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
              value={connectionType}
              onChange={(event) =>
                setConnectionType(event.target.value)
              }
            >
              <option value="">All connection labels</option>
              {connectionTypes.map((type) => (
                <option key={type} value={type}>
                  {getConnectionTypeLabel(type)}
                </option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-2 lg:col-span-3">
            <button
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-primary-600 bg-primary-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-surface-dark sm:w-auto"
              type="submit"
            >
              <Search
                className="h-4 w-4"
                aria-hidden="true"
              />
              Apply search
            </button>
          </div>
        </form>
      </section>

      <section
        className="mt-8"
        aria-labelledby="integration-records-heading"
        aria-busy={loading}
      >
        <h2
          id="integration-records-heading"
          className="text-xl font-semibold text-content dark:text-content-inverse"
        >
          Conceptual integration records
        </h2>
        <p
          className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted"
          aria-live="polite"
        >
          {loading
            ? 'Loading the browser-local integration inventory.'
            : `${filteredItems.length} of ${items.length} simulated ${
                filteredItems.length === 1 ? 'record' : 'records'
              } displayed.`}
        </p>

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
              Loading exact local inventory fixtures
            </p>
          </div>
        ) : null}

        {!loading && filteredItems.length === 0 ? (
          <div
            className="mt-4 rounded-xl border border-border bg-surface p-8 text-center shadow-card dark:border-border-dark dark:bg-surface-dark-muted"
            role="status"
          >
            <FileSearch
              className="mx-auto h-8 w-8 text-content-subtle dark:text-content-inverse-muted"
              aria-hidden="true"
            />
            <h3 className="mt-3 font-semibold text-content dark:text-content-inverse">
              No simulated integrations match
            </h3>
            <p className="mt-2 text-sm text-content-muted dark:text-content-inverse-muted">
              Adjust the search text, architecture layer, or
              connection label.
            </p>
          </div>
        ) : null}

        {!loading && filteredItems.length > 0 ? (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {filteredItems.map((integration, index) => {
              const presentation = getLayerPresentation(
                integration.layer,
              );
              const IntegrationIcon = presentation.Icon;
              const aliases = Array.isArray(integration.aliases)
                ? integration.aliases
                : EMPTY_COLLECTION;
              const integrationConnectionTypes = Array.isArray(
                integration.connectionTypes,
              )
                ? integration.connectionTypes
                : EMPTY_COLLECTION;

              return (
                <article
                  key={getIntegrationKey(integration, index)}
                  className="flex min-h-80 flex-col rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted sm:p-6"
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-100 text-primary-700 dark:bg-primary-900 dark:text-primary-100">
                        <IntegrationIcon
                          className="h-5 w-5"
                          aria-hidden="true"
                        />
                      </span>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold uppercase tracking-wide text-primary-700 dark:text-primary-300">
                          {presentation.label}
                        </p>
                        <h3 className="mt-1 text-base font-semibold text-content dark:text-content-inverse">
                          {integration.name ??
                            'Conceptual integration'}
                        </h3>
                        <p className="mt-1 break-all font-mono text-xs text-content-subtle dark:text-content-inverse-muted">
                          {integration.integrationId ??
                            'local-integration'}
                        </p>
                      </div>
                    </div>
                    <StatusBadge
                      className="self-start"
                      status={
                        integration.networkEnabled === false
                          ? 'SIMULATED'
                          : 'UNKNOWN'
                      }
                      variant="neutral"
                    />
                  </div>

                  <p className="mt-4 text-sm leading-6 text-content-muted dark:text-content-inverse-muted">
                    {integration.description ??
                      'Browser-local conceptual integration fixture.'}
                  </p>

                  <div className="mt-5">
                    <p className="text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
                      Exact fixture status
                    </p>
                    <p className="mt-2 rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 font-mono text-xs font-semibold leading-5 text-primary-900 dark:border-primary-800 dark:bg-primary-950 dark:text-primary-100">
                      {integration.status ??
                        'Status: Simulated — local fixture [Pipeline-aligned]'}
                    </p>
                  </div>

                  <div className="mt-5">
                    <p className="text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
                      Connection labels
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {integrationConnectionTypes.map((type) => (
                        <span
                          key={type}
                          className="inline-flex items-center gap-1.5 rounded-full border border-border-strong bg-surface-muted px-2.5 py-1 text-xs font-semibold text-content-muted dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse-muted"
                        >
                          <Waypoints
                            className="h-3.5 w-3.5"
                            aria-hidden="true"
                          />
                          {getConnectionTypeLabel(type)}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="mt-5">
                    <p className="text-xs font-semibold uppercase tracking-wide text-content-subtle dark:text-content-inverse-muted">
                      Conceptual aliases
                    </p>
                    {aliases.length > 0 ? (
                      <ul className="mt-2 flex flex-wrap gap-2">
                        {aliases.map((alias) => (
                          <li
                            key={alias}
                            className="rounded-md bg-surface-muted px-2.5 py-1 text-xs text-content-muted dark:bg-surface-dark dark:text-content-inverse-muted"
                          >
                            {alias}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 text-xs text-content-muted dark:text-content-inverse-muted">
                        No additional conceptual aliases.
                      </p>
                    )}
                  </div>

                  <div className="mt-auto flex items-center justify-between gap-3 border-t border-border pt-5 text-xs dark:border-border-dark">
                    <span className="font-medium text-content-muted dark:text-content-inverse-muted">
                      Live connectivity
                    </span>
                    <span className="inline-flex items-center gap-1.5 font-semibold text-success-700 dark:text-success-100">
                      <WifiOff
                        className="h-4 w-4"
                        aria-hidden="true"
                      />
                      Not configured
                    </span>
                  </div>
                </article>
              );
            })}
          </div>
        ) : null}
      </section>

      <aside
        className="mt-8 rounded-xl border border-warning-200 bg-warning-50 p-5 text-warning-700 shadow-card dark:border-warning-700 dark:bg-warning-950 dark:text-warning-100 sm:p-6"
        role="note"
        aria-label="Integration inventory disclaimer"
      >
        <div className="flex items-start gap-3">
          <WifiOff
            className="mt-0.5 h-5 w-5 shrink-0"
            aria-hidden="true"
          />
          <div>
            <p className="font-semibold">
              Conceptual architecture only
            </p>
            <p className="mt-1 text-sm leading-6">
              Integration names, aliases, layers, connection
              labels, statuses, and descriptions are supplied
              demonstration fixtures. They do not represent live
              connectivity, successful transmission, production
              architecture, service availability, security
              controls, or operational results.
            </p>
          </div>
        </div>
      </aside>
    </div>
  );
}

IntegrationsPage.propTypes = {
  session: PropTypes.object,
  context: PropTypes.object,
  integrationInventoryFacade: PropTypes.object,
  integrationFacade: PropTypes.object,
  insightsRepository: PropTypes.object,
  initialInventory: PropTypes.shape({
    simulated: PropTypes.bool,
    layers: PropTypes.arrayOf(PropTypes.string),
    connectionTypes: PropTypes.arrayOf(PropTypes.string),
    items: PropTypes.arrayOf(
      PropTypes.shape({
        integrationId: PropTypes.string,
        name: PropTypes.string,
        aliases: PropTypes.arrayOf(PropTypes.string),
        layer: PropTypes.string,
        connectionTypes: PropTypes.arrayOf(PropTypes.string),
        status: PropTypes.string,
        networkEnabled: PropTypes.bool,
        description: PropTypes.string,
      }),
    ),
    disclosure: PropTypes.string,
  }),
};

export const IntegrationInventoryPage = IntegrationsPage;
export const SimulatedIntegrationsPage = IntegrationsPage;
export const ItsIntegrationsPage = IntegrationsPage;
export const LocalIntegrationsPage = IntegrationsPage;

export default IntegrationsPage;