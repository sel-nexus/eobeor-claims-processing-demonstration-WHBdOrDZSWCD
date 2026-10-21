import PropTypes from 'prop-types';
import {
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import {
  ChevronRight,
  FileSearch,
  Loader2,
  Search,
  ShieldCheck,
  UserRound,
  X,
} from 'lucide-react';
import StatusBadge from '../../../platform/components/StatusBadge.jsx';
import {
  formatCurrency,
  formatDate,
} from '../../../platform/utils/formatters.js';

const ENTITY_TYPES = Object.freeze({
  ALL: 'ALL',
  MEMBER: 'MEMBER',
  CLAIM: 'CLAIM',
});

const EMPTY_RESULTS = Object.freeze({
  members: Object.freeze([]),
  claims: Object.freeze([]),
  memberTotal: 0,
  claimTotal: 0,
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

function normalizePagedResult(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    !Array.isArray(value.items)
  ) {
    throw new TypeError(
      'The local discovery service returned an invalid result.',
    );
  }

  return {
    items: value.items,
    total:
      Number.isSafeInteger(value.total) && value.total >= 0
        ? value.total
        : value.items.length,
  };
}

function getSuggestionLabel(suggestion) {
  if (
    typeof suggestion?.label === 'string' &&
    suggestion.label.trim().length > 0
  ) {
    return suggestion.label;
  }

  if (
    typeof suggestion?.data?.displayName === 'string' &&
    suggestion.data.displayName.trim().length > 0
  ) {
    return suggestion.data.displayName;
  }

  return 'Fictional member';
}

function getMemberResultKey(member, index) {
  return (
    member.memberId ??
    member.displayName ??
    `member-result-${index}`
  );
}

function getClaimResultKey(claim, index) {
  return (
    claim.claimNumber ??
    `claim-result-${index}`
  );
}

function createMemberDestination(member) {
  const searchValue =
    typeof member.displayName === 'string'
      ? member.displayName
      : '';

  return {
    type: ENTITY_TYPES.MEMBER,
    href: `/claims?search=${encodeURIComponent(searchValue)}`,
    member,
  };
}

function createClaimDestination(claim) {
  const claimNumber =
    typeof claim.claimNumber === 'string'
      ? claim.claimNumber
      : '';

  return {
    type: ENTITY_TYPES.CLAIM,
    href: `/claims/${encodeURIComponent(claimNumber)}`,
    claim,
  };
}

/**
 * Local member and claim discovery route.
 *
 * @param {{
 *   discoveryService: {
 *     searchMembers: Function,
 *     searchClaims: Function,
 *     autocomplete?: Function
 *   },
 *   session?: Record<string, unknown>|null,
 *   context?: Record<string, unknown>,
 *   initialQuery?: string,
 *   onNavigate?: Function
 * }} props Component props.
 * @returns {JSX.Element} Member and claim search page.
 */
export function SearchPage({
  discoveryService,
  session = null,
  context,
  initialQuery = '',
  onNavigate,
}) {
  const queryId = useId();
  const entityTypeId = useId();
  const memberId = useId();
  const statusId = useId();
  const providerId = useId();
  const eligibilityId = useId();
  const suggestionListId = useId();
  const resultsHeadingId = useId();
  const searchSequenceRef = useRef(0);
  const [query, setQuery] = useState(initialQuery);
  const [entityType, setEntityType] = useState(
    ENTITY_TYPES.ALL,
  );
  const [memberFilter, setMemberFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [providerFilter, setProviderFilter] = useState('');
  const [eligibilityFilter, setEligibilityFilter] =
    useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [suggestionsOpen, setSuggestionsOpen] =
    useState(false);
  const [suggestionLoading, setSuggestionLoading] =
    useState(false);
  const [suggestionError, setSuggestionError] =
    useState(null);
  const [results, setResults] = useState(EMPTY_RESULTS);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchPending, setSearchPending] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [navigationPending, setNavigationPending] =
    useState(null);
  const accessContext = context ?? session ?? undefined;
  const hasFilters =
    query.trim().length > 0 ||
    entityType !== ENTITY_TYPES.ALL ||
    memberFilter.trim().length > 0 ||
    statusFilter.length > 0 ||
    providerFilter.trim().length > 0 ||
    eligibilityFilter.length > 0;

  useEffect(() => {
    const normalizedQuery = query.trim();

    if (
      normalizedQuery.length < 2 ||
      typeof discoveryService.autocomplete !== 'function'
    ) {
      setSuggestions([]);
      setSuggestionsOpen(false);
      setSuggestionLoading(false);
      setSuggestionError(null);
      return undefined;
    }

    let active = true;
    const timer = globalThis.setTimeout(async () => {
      setSuggestionLoading(true);
      setSuggestionError(null);

      try {
        const result = await Promise.resolve(
          discoveryService.autocomplete(
            {
              query: normalizedQuery,
              entityTypes: [ENTITY_TYPES.MEMBER],
              limit: 6,
            },
            accessContext,
          ),
        );

        if (!active) {
          return;
        }

        const nextSuggestions = Array.isArray(result?.items)
          ? result.items
          : [];

        setSuggestions(nextSuggestions);
        setSuggestionsOpen(nextSuggestions.length > 0);
      } catch (error) {
        if (!active) {
          return;
        }

        setSuggestions([]);
        setSuggestionsOpen(false);
        setSuggestionError(
          normalizeErrorMessage(
            error,
            'Member-name suggestions are temporarily unavailable.',
          ),
        );
      } finally {
        if (active) {
          setSuggestionLoading(false);
        }
      }
    }, 250);

    return () => {
      active = false;
      globalThis.clearTimeout(timer);
    };
  }, [accessContext, discoveryService, query]);

  const runSearch = async () => {
    const sequence = searchSequenceRef.current + 1;

    searchSequenceRef.current = sequence;
    setSearchPending(true);
    setSearchError(null);
    setSuggestionsOpen(false);

    const claimQuery = {
      query: query.trim(),
      page: 1,
      limit: 50,
      ...(memberFilter.trim().length === 0
        ? {}
        : { memberId: memberFilter.trim() }),
      ...(statusFilter.length === 0
        ? {}
        : { status: statusFilter }),
      ...(providerFilter.trim().length === 0
        ? {}
        : { providerId: providerFilter.trim() }),
      ...(eligibilityFilter.length === 0
        ? {}
        : {
            eligibleForReprint:
              eligibilityFilter === 'TRUE',
          }),
    };
    const memberQuery = {
      query: query.trim(),
      page: 1,
      limit: 50,
    };

    try {
      const shouldSearchMembers =
        entityType !== ENTITY_TYPES.CLAIM;
      const shouldSearchClaims =
        entityType !== ENTITY_TYPES.MEMBER;
      const [memberValue, claimValue] = await Promise.all([
        shouldSearchMembers
          ? Promise.resolve(
              discoveryService.searchMembers(
                memberQuery,
                accessContext,
              ),
            )
          : Promise.resolve({
              items: [],
              total: 0,
            }),
        shouldSearchClaims
          ? Promise.resolve(
              discoveryService.searchClaims(
                claimQuery,
                accessContext,
              ),
            )
          : Promise.resolve({
              items: [],
              total: 0,
            }),
      ]);

      if (searchSequenceRef.current !== sequence) {
        return;
      }

      const memberResult = normalizePagedResult(memberValue);
      const claimResult = normalizePagedResult(claimValue);

      setResults({
        members: memberResult.items,
        claims: claimResult.items,
        memberTotal: memberResult.total,
        claimTotal: claimResult.total,
      });
      setHasSearched(true);
    } catch (error) {
      if (searchSequenceRef.current !== sequence) {
        return;
      }

      setResults(EMPTY_RESULTS);
      setHasSearched(true);
      setSearchError(
        normalizeErrorMessage(
          error,
          'The browser-local member and claim search could not be completed.',
        ),
      );
    } finally {
      if (searchSequenceRef.current === sequence) {
        setSearchPending(false);
      }
    }
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    runSearch().catch((error) => {
      setSearchPending(false);
      setSearchError(
        normalizeErrorMessage(
          error,
          'The browser-local member and claim search could not be completed.',
        ),
      );
    });
  };

  const clearSearch = () => {
    searchSequenceRef.current += 1;
    setQuery('');
    setEntityType(ENTITY_TYPES.ALL);
    setMemberFilter('');
    setStatusFilter('');
    setProviderFilter('');
    setEligibilityFilter('');
    setSuggestions([]);
    setSuggestionsOpen(false);
    setSuggestionError(null);
    setResults(EMPTY_RESULTS);
    setHasSearched(false);
    setSearchPending(false);
    setSearchError(null);
  };

  const handleNavigation = async (
    event,
    destination,
    navigationKey,
  ) => {
    if (typeof onNavigate !== 'function') {
      return;
    }

    event.preventDefault();
    setNavigationPending(navigationKey);
    setSearchError(null);

    try {
      await Promise.resolve(
        onNavigate(destination, event),
      );
    } catch (error) {
      setSearchError(
        normalizeErrorMessage(
          error,
          'The selected local record could not be opened.',
        ),
      );
    } finally {
      setNavigationPending(null);
    }
  };

  const totalResults =
    results.memberTotal + results.claimTotal;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
      <header className="max-w-3xl">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-100 text-primary-700 dark:bg-primary-900 dark:text-primary-100">
            <Search
              className="h-6 w-6"
              aria-hidden="true"
            />
          </span>
          <div>
            <p className="text-sm font-semibold text-primary-700 dark:text-primary-300">
              Local discovery
            </p>
            <h1 className="text-2xl font-semibold tracking-tight text-content dark:text-content-inverse sm:text-3xl">
              Search members and claims
            </h1>
          </div>
        </div>
        <p className="mt-4 text-sm leading-6 text-content-muted dark:text-content-inverse-muted sm:text-base">
          Search authorized fictional member and claim fixtures.
          Results are filtered for the current demo role before
          they are displayed.
        </p>
      </header>

      <aside
        className="mt-6 rounded-xl border border-primary-200 bg-primary-50 p-4 text-sm text-primary-900 dark:border-primary-800 dark:bg-primary-950 dark:text-primary-100"
        role="note"
        aria-label="Local search disclosure"
      >
        <div className="flex items-start gap-3">
          <ShieldCheck
            className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
            aria-hidden="true"
          />
          <div>
            <p className="font-semibold">
              Browser-local search only
            </p>
            <p className="mt-1 leading-6">
              Searches use prepackaged fictional fixtures and
              browser-local indexes. No payer, provider, identity,
              healthcare, or external search service is contacted.
            </p>
          </div>
        </div>
      </aside>

      <section
        className="mt-6 rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted sm:p-6"
        aria-labelledby="search-fields-heading"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2
              id="search-fields-heading"
              className="text-lg font-semibold text-content dark:text-content-inverse"
            >
              Search fields
            </h2>
            <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
              Use any combination of the six local search fields.
            </p>
          </div>
          {hasFilters ? (
            <button
              className="inline-flex min-h-10 items-center justify-center gap-2 self-start rounded-lg px-3 py-2 text-sm font-semibold text-content-muted transition hover:bg-surface-muted hover:text-content focus:outline-none focus:ring-2 focus:ring-primary-500 dark:text-content-inverse-muted dark:hover:bg-surface-dark-raised dark:hover:text-content-inverse"
              type="button"
              disabled={searchPending}
              onClick={clearSearch}
            >
              <X className="h-4 w-4" aria-hidden="true" />
              Clear fields
            </button>
          ) : null}
        </div>

        <form
          className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3"
          onSubmit={handleSubmit}
        >
          <div className="relative sm:col-span-2 lg:col-span-3">
            <label
              className="block text-sm font-medium text-content dark:text-content-inverse"
              htmlFor={queryId}
            >
              1. Name or record text
            </label>
            <div className="relative mt-2">
              <Search
                className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-content-subtle dark:text-content-inverse-muted"
                aria-hidden="true"
              />
              <input
                id={queryId}
                className="block min-h-11 w-full rounded-lg border border-border-strong bg-surface py-2 pl-10 pr-10 text-sm text-content shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
                type="search"
                value={query}
                autoComplete="off"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={suggestionsOpen}
                aria-controls={suggestionListId}
                aria-describedby={`${queryId}-hint`}
                placeholder="Member name, claim number, provider, or status"
                disabled={searchPending}
                onFocus={() => {
                  if (suggestions.length > 0) {
                    setSuggestionsOpen(true);
                  }
                }}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setSearchError(null);
                }}
              />
              {suggestionLoading ? (
                <Loader2
                  className="absolute right-3 top-3.5 h-4 w-4 animate-spin text-primary-600 motion-reduce:animate-none"
                  aria-label="Loading member suggestions"
                />
              ) : null}
            </div>
            <p
              id={`${queryId}-hint`}
              className="mt-2 text-xs text-content-subtle dark:text-content-inverse-muted"
            >
              Indexed text includes member names and IDs, claim
              numbers, provider names and IDs, and claim status.
            </p>

            {suggestionsOpen ? (
              <ul
                id={suggestionListId}
                className="absolute z-20 mt-2 max-h-64 w-full overflow-auto rounded-lg border border-border bg-surface p-1 shadow-elevated dark:border-border-dark dark:bg-surface-dark-raised"
                role="listbox"
                aria-label="Fictional member-name suggestions"
              >
                {suggestions.map((suggestion, index) => {
                  const label =
                    getSuggestionLabel(suggestion);

                  return (
                    <li
                      key={
                        suggestion.value ??
                        `${label}-${index}`
                      }
                      role="option"
                      aria-selected="false"
                    >
                      <button
                        className="flex min-h-11 w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm text-content transition hover:bg-primary-50 focus:bg-primary-50 focus:outline-none dark:text-content-inverse dark:hover:bg-primary-950 dark:focus:bg-primary-950"
                        type="button"
                        onClick={() => {
                          setQuery(label);
                          setSuggestionsOpen(false);
                          setSuggestionError(null);
                        }}
                      >
                        <UserRound
                          className="h-4 w-4 shrink-0 text-primary-700 dark:text-primary-300"
                          aria-hidden="true"
                        />
                        <span className="min-w-0">
                          <span className="block truncate font-medium">
                            {label}
                          </span>
                          <span className="block truncate text-xs text-content-subtle dark:text-content-inverse-muted">
                            Fictional member suggestion
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}

            {suggestionError !== null ? (
              <p className="mt-2 text-xs text-warning-700 dark:text-warning-100">
                {suggestionError}
              </p>
            ) : null}
          </div>

          <div>
            <label
              className="block text-sm font-medium text-content dark:text-content-inverse"
              htmlFor={entityTypeId}
            >
              2. Record type
            </label>
            <select
              id={entityTypeId}
              className="mt-2 block min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-content shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
              value={entityType}
              disabled={searchPending}
              onChange={(event) => {
                setEntityType(event.target.value);
                setSearchError(null);
              }}
            >
              <option value={ENTITY_TYPES.ALL}>
                Members and claims
              </option>
              <option value={ENTITY_TYPES.MEMBER}>
                Members only
              </option>
              <option value={ENTITY_TYPES.CLAIM}>
                Claims only
              </option>
            </select>
          </div>

          <div>
            <label
              className="block text-sm font-medium text-content dark:text-content-inverse"
              htmlFor={memberId}
            >
              3. Member ID
            </label>
            <input
              id={memberId}
              className="mt-2 block min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 font-mono text-sm text-content shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
              type="text"
              value={memberFilter}
              autoComplete="off"
              disabled={
                searchPending ||
                entityType === ENTITY_TYPES.MEMBER
              }
              placeholder="Exact fictional ID"
              onChange={(event) => {
                setMemberFilter(event.target.value);
                setSearchError(null);
              }}
            />
          </div>

          <div>
            <label
              className="block text-sm font-medium text-content dark:text-content-inverse"
              htmlFor={statusId}
            >
              4. Claim status
            </label>
            <select
              id={statusId}
              className="mt-2 block min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-content shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
              value={statusFilter}
              disabled={
                searchPending ||
                entityType === ENTITY_TYPES.MEMBER
              }
              onChange={(event) => {
                setStatusFilter(event.target.value);
                setSearchError(null);
              }}
            >
              <option value="">Any status</option>
              <option value="PROCESSED">Processed</option>
              <option value="PAID">Paid</option>
              <option value="DENIED">Denied</option>
              <option value="PENDING_REVIEW">
                Pending review
              </option>
              <option value="COMPLETE">Complete</option>
            </select>
          </div>

          <div>
            <label
              className="block text-sm font-medium text-content dark:text-content-inverse"
              htmlFor={providerId}
            >
              5. Provider ID
            </label>
            <input
              id={providerId}
              className="mt-2 block min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 font-mono text-sm text-content shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
              type="text"
              value={providerFilter}
              autoComplete="off"
              disabled={
                searchPending ||
                entityType === ENTITY_TYPES.MEMBER
              }
              placeholder="Exact fictional provider ID"
              onChange={(event) => {
                setProviderFilter(event.target.value);
                setSearchError(null);
              }}
            />
          </div>

          <div>
            <label
              className="block text-sm font-medium text-content dark:text-content-inverse"
              htmlFor={eligibilityId}
            >
              6. Reprint eligibility
            </label>
            <select
              id={eligibilityId}
              className="mt-2 block min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-content shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
              value={eligibilityFilter}
              disabled={
                searchPending ||
                entityType === ENTITY_TYPES.MEMBER
              }
              onChange={(event) => {
                setEligibilityFilter(event.target.value);
                setSearchError(null);
              }}
            >
              <option value="">Any eligibility</option>
              <option value="TRUE">
                Eligible for reprint
              </option>
              <option value="FALSE">
                Not eligible for reprint
              </option>
            </select>
          </div>

          <div className="sm:col-span-2 lg:col-span-3">
            <button
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-primary-600 bg-primary-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:focus:ring-offset-surface-dark sm:w-auto"
              type="submit"
              disabled={searchPending}
            >
              {searchPending ? (
                <Loader2
                  className="h-4 w-4 animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              ) : (
                <Search
                  className="h-4 w-4"
                  aria-hidden="true"
                />
              )}
              {searchPending
                ? 'Searching locally…'
                : 'Search local fixtures'}
            </button>
          </div>
        </form>

        {searchError !== null ? (
          <div
            className="mt-5 rounded-lg border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700 dark:border-danger-700 dark:bg-danger-950 dark:text-danger-100"
            role="alert"
          >
            {searchError}
          </div>
        ) : null}
      </section>

      <section
        className="mt-8"
        aria-labelledby={resultsHeadingId}
        aria-busy={searchPending}
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2
              id={resultsHeadingId}
              className="text-xl font-semibold text-content dark:text-content-inverse"
            >
              Search results
            </h2>
            <p
              className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted"
              aria-live="polite"
            >
              {hasSearched
                ? `${totalResults} authorized fictional ${
                    totalResults === 1 ? 'record' : 'records'
                  } found.`
                : 'Enter search criteria to find authorized fictional records.'}
            </p>
          </div>
        </div>

        {searchPending ? (
          <div
            className="mt-5 rounded-xl border border-border bg-surface p-8 text-center shadow-card dark:border-border-dark dark:bg-surface-dark-muted"
            role="status"
          >
            <Loader2
              className="mx-auto h-7 w-7 animate-spin text-primary-600 motion-reduce:animate-none"
              aria-hidden="true"
            />
            <p className="mt-3 text-sm font-medium text-content dark:text-content-inverse">
              Searching browser-local fixtures
            </p>
          </div>
        ) : null}

        {!searchPending &&
        hasSearched &&
        totalResults === 0 &&
        searchError === null ? (
          <div
            className="mt-5 rounded-xl border border-border bg-surface p-8 text-center shadow-card dark:border-border-dark dark:bg-surface-dark-muted"
            role="status"
          >
            <FileSearch
              className="mx-auto h-8 w-8 text-content-subtle dark:text-content-inverse-muted"
              aria-hidden="true"
            />
            <h3 className="mt-3 font-semibold text-content dark:text-content-inverse">
              No authorized records found
            </h3>
            <p className="mt-2 text-sm text-content-muted dark:text-content-inverse-muted">
              Adjust the local search text or filters. Records
              outside the current demo role&apos;s access scope
              are not disclosed.
            </p>
          </div>
        ) : null}

        {!searchPending && results.members.length > 0 ? (
          <div className="mt-5">
            <h3 className="flex items-center gap-2 text-base font-semibold text-content dark:text-content-inverse">
              <UserRound
                className="h-5 w-5 text-primary-700 dark:text-primary-300"
                aria-hidden="true"
              />
              Members ({results.memberTotal})
            </h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {results.members.map((member, index) => {
                const destination =
                  createMemberDestination(member);
                const resultKey = getMemberResultKey(
                  member,
                  index,
                );
                const pending =
                  navigationPending === resultKey;

                return (
                  <a
                    key={resultKey}
                    className="group flex min-h-40 flex-col rounded-xl border border-border bg-surface p-5 shadow-card transition hover:border-primary-300 hover:shadow-elevated focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:border-border-dark dark:bg-surface-dark-muted dark:hover:border-primary-700 dark:focus:ring-offset-surface-dark"
                    href={destination.href}
                    aria-busy={pending}
                    onClick={(event) => {
                      handleNavigation(
                        event,
                        destination,
                        resultKey,
                      ).catch((error) => {
                        setSearchError(
                          normalizeErrorMessage(
                            error,
                            'The selected local record could not be opened.',
                          ),
                        );
                      });
                    }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-100 text-primary-700 dark:bg-primary-900 dark:text-primary-100">
                        <UserRound
                          className="h-4 w-4"
                          aria-hidden="true"
                        />
                      </span>
                      {typeof member.active === 'boolean' ? (
                        <StatusBadge
                          status={
                            member.active
                              ? 'ACTIVE'
                              : 'INACTIVE'
                          }
                        />
                      ) : null}
                    </div>
                    <p className="mt-4 font-semibold text-content dark:text-content-inverse">
                      {member.displayName ??
                        'Fictional member'}
                    </p>
                    <p className="mt-1 break-all font-mono text-xs text-content-subtle dark:text-content-inverse-muted">
                      Member ID: {member.memberId ?? 'Restricted'}
                    </p>
                    <span className="mt-auto inline-flex items-center gap-2 pt-4 text-sm font-semibold text-primary-700 group-hover:text-primary-800 dark:text-primary-300 dark:group-hover:text-primary-100">
                      {pending
                        ? 'Opening…'
                        : 'View associated claims'}
                      {pending ? (
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
                    </span>
                  </a>
                );
              })}
            </div>
          </div>
        ) : null}

        {!searchPending && results.claims.length > 0 ? (
          <div className="mt-7">
            <h3 className="flex items-center gap-2 text-base font-semibold text-content dark:text-content-inverse">
              <FileSearch
                className="h-5 w-5 text-primary-700 dark:text-primary-300"
                aria-hidden="true"
              />
              Claims ({results.claimTotal})
            </h3>
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              {results.claims.map((claim, index) => {
                const destination =
                  createClaimDestination(claim);
                const resultKey = getClaimResultKey(
                  claim,
                  index,
                );
                const pending =
                  navigationPending === resultKey;

                return (
                  <a
                    key={resultKey}
                    className="group rounded-xl border border-border bg-surface p-5 shadow-card transition hover:border-primary-300 hover:shadow-elevated focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:border-border-dark dark:bg-surface-dark-muted dark:hover:border-primary-700 dark:focus:ring-offset-surface-dark"
                    href={destination.href}
                    aria-busy={pending}
                    onClick={(event) => {
                      handleNavigation(
                        event,
                        destination,
                        resultKey,
                      ).catch((error) => {
                        setSearchError(
                          normalizeErrorMessage(
                            error,
                            'The selected local record could not be opened.',
                          ),
                        );
                      });
                    }}
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="font-mono text-base font-semibold text-content dark:text-content-inverse">
                          {claim.claimNumber ??
                            'Restricted claim'}
                        </p>
                        <p className="mt-1 truncate text-sm text-content-muted dark:text-content-inverse-muted">
                          {claim.memberName ??
                            'Authorized fictional member'}
                          {claim.providerName
                            ? ` · ${claim.providerName}`
                            : ''}
                        </p>
                      </div>
                      <StatusBadge
                        status={claim.status ?? 'UNKNOWN'}
                      />
                    </div>

                    <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
                      <div>
                        <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                          Service date
                        </dt>
                        <dd className="mt-1 font-medium text-content dark:text-content-inverse">
                          {formatDate(
                            claim.serviceDateFrom,
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                          Claim type
                        </dt>
                        <dd className="mt-1 font-medium text-content dark:text-content-inverse">
                          {claim.claimType ?? '—'}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                          Billed
                        </dt>
                        <dd className="mt-1 font-medium text-content dark:text-content-inverse">
                          {formatCurrency(
                            claim.billedAmount,
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                          Reprint
                        </dt>
                        <dd className="mt-1 font-medium text-content dark:text-content-inverse">
                          {claim.eligibleForReprint === true
                            ? 'Eligible'
                            : 'Not eligible'}
                        </dd>
                      </div>
                    </dl>

                    <span className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-primary-700 group-hover:text-primary-800 dark:text-primary-300 dark:group-hover:text-primary-100">
                      {pending
                        ? 'Opening…'
                        : 'Open claim'}
                      {pending ? (
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
                    </span>
                  </a>
                );
              })}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

SearchPage.propTypes = {
  discoveryService: PropTypes.shape({
    searchMembers: PropTypes.func.isRequired,
    searchClaims: PropTypes.func.isRequired,
    autocomplete: PropTypes.func,
  }).isRequired,
  session: PropTypes.object,
  context: PropTypes.object,
  initialQuery: PropTypes.string,
  onNavigate: PropTypes.func,
};

export const MemberClaimSearchPage = SearchPage;
export const DiscoverySearchPage = SearchPage;

export default SearchPage;