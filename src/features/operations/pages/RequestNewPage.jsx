import PropTypes from 'prop-types';
import {
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  FileText,
  Loader2,
  ShieldCheck,
} from 'lucide-react';
import {
  useNavigate,
  useSearchParams,
} from 'react-router-dom';
import RequestForm from '../components/RequestForm.jsx';
import AccessDenied from '../../../platform/components/AccessDenied.jsx';
import { generateUuid } from '../../../platform/utils/ids.js';
import {
  isPlainObject,
  isPlatformRole,
} from '../../../platform/validation/schemas.js';

const CREATE_REQUEST_ROLES = new Set([
  'MEMBER',
  'CSR',
  'BOS',
  'ADMIN',
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

function normalizeIdentifier(value) {
  return typeof value === 'string'
    ? value.normalize('NFC').trim().toUpperCase()
    : '';
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
        ? normalizeIdentifier(source.memberId)
        : null,
  };
}

function unwrapClaimResult(result) {
  if (result?.ok === false) {
    throw new Error(
      result.error?.message ??
        'The fictional claim could not be loaded.',
    );
  }

  const value = result?.ok === true ? result.data : result;

  if (isPlainObject(value?.claim)) {
    return value.claim;
  }

  return isPlainObject(value) ? value : null;
}

function resolveClaimReader(service) {
  if (service === null || service === undefined) {
    return null;
  }

  if (typeof service.getClaimByNumber === 'function') {
    return service.getClaimByNumber.bind(service);
  }

  if (typeof service.resolveClaim === 'function') {
    return service.resolveClaim.bind(service);
  }

  if (typeof service.findClaimByNumber === 'function') {
    return service.findClaimByNumber.bind(service);
  }

  if (typeof service.getClaim === 'function') {
    return service.getClaim.bind(service);
  }

  return null;
}

async function readContextualClaim(
  service,
  claimNumber,
  accessContext,
) {
  const reader = resolveClaimReader(service);

  if (reader === null) {
    return null;
  }

  const result = await Promise.resolve(
    reader(claimNumber, accessContext, 'REPRINT_REQUEST'),
  );

  return unwrapClaimResult(result);
}

function resolveCreateMethod(service) {
  if (service === null || service === undefined) {
    return null;
  }

  if (typeof service.createRequest === 'function') {
    return service.createRequest.bind(service);
  }

  if (typeof service.create === 'function') {
    return service.create.bind(service);
  }

  return null;
}

function getCreatedRequest(result) {
  const value = result?.ok === true ? result.data : result;

  if (isPlainObject(value?.request)) {
    return value.request;
  }

  return isPlainObject(value) ? value : null;
}

/**
 * Contextual browser-local reprint request creation route.
 *
 * @param {{
 *   session?: Record<string, unknown>|null,
 *   context?: Record<string, unknown>|null,
 *   requestService?: object,
 *   fixtureGateway?: object,
 *   fixtureRepository?: object,
 *   claimService?: object,
 *   discoveryService?: object,
 *   initialClaimNumber?: string,
 *   initialMemberId?: string,
 *   initialRequestType?: string,
 *   initialPriority?: string,
 *   processNow?: boolean,
 *   disabled?: boolean,
 *   onCreated?: Function,
 *   onSuccess?: Function,
 *   onNavigate?: Function
 * }} props Component props.
 * @returns {JSX.Element} Reprint request creation page.
 */
export function RequestNewPage({
  session = null,
  context = null,
  requestService = null,
  fixtureGateway = null,
  fixtureRepository = null,
  claimService = null,
  discoveryService = null,
  initialClaimNumber = '',
  initialMemberId = '',
  initialRequestType = 'EOB',
  initialPriority = 'NORMAL',
  processNow = true,
  disabled = false,
  onCreated,
  onSuccess,
  onNavigate,
}) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const accessContext = useMemo(
    () => normalizeContext(context ?? session),
    [context, session],
  );
  const role = accessContext?.role ?? null;
  const memberOwnedId =
    role === 'MEMBER'
      ? accessContext?.memberId ?? ''
      : '';
  const queryClaimNumber = normalizeIdentifier(
    searchParams.get('claimNumber'),
  );
  const queryMemberId = normalizeIdentifier(
    searchParams.get('memberId'),
  );
  const queryRequestType =
    normalizeIdentifier(searchParams.get('requestType')) ||
    normalizeIdentifier(initialRequestType) ||
    'EOB';
  const queryPriority =
    normalizeIdentifier(searchParams.get('priority')) ||
    normalizeIdentifier(initialPriority) ||
    'NORMAL';
  const contextualClaimNumber =
    normalizeIdentifier(initialClaimNumber) ||
    queryClaimNumber;
  const contextualMemberId =
    memberOwnedId ||
    normalizeIdentifier(initialMemberId) ||
    queryMemberId;
  const contextualClaimService =
    fixtureGateway ??
    fixtureRepository ??
    claimService ??
    discoveryService;
  const [values, setValues] = useState(() => ({
    claimNumber: contextualClaimNumber,
    memberId: contextualMemberId,
    requestType: ['EOB', 'EOR', 'BOTH'].includes(
      queryRequestType,
    )
      ? queryRequestType
      : 'EOB',
    priority: ['URGENT', 'HIGH', 'NORMAL'].includes(
      queryPriority,
    )
      ? queryPriority
      : 'NORMAL',
  }));
  const [contextLoading, setContextLoading] = useState(
    contextualClaimNumber.length > 0 &&
      resolveClaimReader(contextualClaimService) !== null,
  );
  const [contextError, setContextError] = useState(null);
  const [ownershipDenied, setOwnershipDenied] =
    useState(false);
  const [createdRequest, setCreatedRequest] = useState(null);
  const [navigationError, setNavigationError] =
    useState(null);
  const authenticated = accessContext !== null;
  const permissionAllowed =
    role !== null && CREATE_REQUEST_ROLES.has(role);

  useEffect(() => {
    let active = true;

    const loadClaimContext = async () => {
      if (
        contextualClaimNumber.length === 0 ||
        resolveClaimReader(contextualClaimService) === null
      ) {
        setContextLoading(false);
        return;
      }

      setContextLoading(true);
      setContextError(null);
      setOwnershipDenied(false);

      try {
        const claim = await readContextualClaim(
          contextualClaimService,
          contextualClaimNumber,
          accessContext,
        );

        if (!active) {
          return;
        }

        if (claim === null) {
          setContextError(
            'The contextual claim is unavailable for the current demo role. You may enter another authorized fictional claim.',
          );
          return;
        }

        const claimMemberId = normalizeIdentifier(
          claim.memberId,
        );

        if (
          role === 'MEMBER' &&
          (memberOwnedId.length === 0 ||
            claimMemberId !== memberOwnedId)
        ) {
          setOwnershipDenied(true);
          return;
        }

        setValues((current) => ({
          ...current,
          claimNumber:
            normalizeIdentifier(claim.claimNumber) ||
            contextualClaimNumber,
          memberId:
            role === 'MEMBER'
              ? memberOwnedId
              : claimMemberId || current.memberId,
          requestType:
            Array.isArray(claim.documentTypes) &&
            claim.documentTypes.length === 1 &&
            ['EOB', 'EOR'].includes(claim.documentTypes[0])
              ? claim.documentTypes[0]
              : current.requestType,
        }));
      } catch (error) {
        if (active) {
          setContextError(
            normalizeErrorMessage(
              error,
              'The contextual fictional claim could not be loaded.',
            ),
          );
        }
      } finally {
        if (active) {
          setContextLoading(false);
        }
      }
    };

    loadClaimContext().catch((error) => {
      if (active) {
        setContextLoading(false);
        setContextError(
          normalizeErrorMessage(
            error,
            'The contextual fictional claim could not be loaded.',
          ),
        );
      }
    });

    return () => {
      active = false;
    };
  }, [
    accessContext,
    contextualClaimNumber,
    contextualClaimService,
    memberOwnedId,
    role,
  ]);

  const handleFormChange = (nextValues) => {
    setValues({
      ...nextValues,
      memberId:
        role === 'MEMBER'
          ? memberOwnedId
          : nextValues.memberId,
    });
    setContextError(null);
    setNavigationError(null);
    setCreatedRequest(null);
  };

  const handleSubmit = async (command) => {
    const createRequest = resolveCreateMethod(requestService);

    if (createRequest === null) {
      throw new Error(
        'Reprint request creation is unavailable in this application composition.',
      );
    }

    const result = await Promise.resolve(
      createRequest(
        {
          ...command,
          sourceType: 'WEB',
          sourceDetail:
            role === 'MEMBER'
              ? 'Member portal demonstration'
              : 'Authorized internal demonstration',
          processNow,
          idempotencyKey: generateUuid(),
        },
        accessContext,
      ),
    );

    return result;
  };

  const handleCreated = async (result, command) => {
    const request = getCreatedRequest(result);

    if (
      request === null ||
      typeof request.requestId !== 'string' ||
      request.requestId.trim().length === 0
    ) {
      throw new Error(
        'The local service returned an invalid reprint request.',
      );
    }

    const requestId = request.requestId.trim();
    const href = `/operations/requests/${encodeURIComponent(
      requestId,
    )}`;
    const destination = {
      type: 'REPRINT_REQUEST',
      href,
      requestId,
      request,
      command,
      processNow,
    };

    setCreatedRequest(request);
    setNavigationError(null);

    try {
      if (typeof onCreated === 'function') {
        await Promise.resolve(
          onCreated(request, result, command),
        );
      }

      if (typeof onSuccess === 'function') {
        await Promise.resolve(
          onSuccess(request, result, command),
        );
      }

      if (typeof onNavigate === 'function') {
        await Promise.resolve(
          onNavigate(destination, result),
        );
      } else {
        navigate(href);
      }
    } catch (error) {
      const message = normalizeErrorMessage(
        error,
        'The request was created locally, but its processing page could not be opened.',
      );

      setNavigationError(message);
      throw new Error(message);
    }
  };

  if (!authenticated) {
    return <AccessDenied authenticated={false} />;
  }

  if (
    role === 'MEMBER' &&
    accessContext.memberId === null
  ) {
    return <AccessDenied authenticated />;
  }

  if (ownershipDenied) {
    return <AccessDenied authenticated />;
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
      <header className="max-w-3xl">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-100 text-primary-700 dark:bg-primary-900 dark:text-primary-100">
            <FileText
              className="h-6 w-6"
              aria-hidden="true"
            />
          </span>
          <div>
            <p className="text-sm font-semibold text-primary-700 dark:text-primary-300">
              Browser-local document operations
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-content dark:text-content-inverse sm:text-3xl">
              Create a reprint request
            </h1>
            <p className="mt-3 text-sm leading-6 text-content-muted dark:text-content-inverse-muted sm:text-base">
              Create an EOB, EOR, or combined request for an
              authorized fictional claim. The request and its
              processing history remain in browser-local
              demonstration data.
            </p>
          </div>
        </div>
      </header>

      <aside
        className="mt-6 rounded-xl border border-primary-200 bg-primary-50 p-4 text-sm text-primary-900 dark:border-primary-800 dark:bg-primary-950 dark:text-primary-100"
        role="note"
        aria-label="Reprint processing disclosure"
      >
        <div className="flex items-start gap-3">
          <ShieldCheck
            className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
            aria-hidden="true"
          />
          <div>
            <p className="font-semibold">
              Deterministic local processing
            </p>
            <p className="mt-1 leading-6">
              Claim ownership and demo-role permissions are checked
              when the request is submitted. Successful requests
              open the local processing route. No payer, provider,
              healthcare, document-delivery, payment, or identity
              system is contacted.
            </p>
          </div>
        </div>
      </aside>

      {contextLoading ? (
        <div
          className="mt-6 rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center gap-3">
            <Loader2
              className="h-5 w-5 animate-spin text-primary-600 motion-reduce:animate-none"
              aria-hidden="true"
            />
            <p className="text-sm font-medium text-content dark:text-content-inverse">
              Checking the contextual fictional claim
            </p>
          </div>
        </div>
      ) : null}

      {contextError !== null ? (
        <div
          className="mt-6 rounded-lg border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-700 dark:border-warning-700 dark:bg-warning-950 dark:text-warning-100"
          role="alert"
        >
          {contextError}
        </div>
      ) : null}

      {navigationError !== null ? (
        <div
          className="mt-6 rounded-lg border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700 dark:border-danger-700 dark:bg-danger-950 dark:text-danger-100"
          role="alert"
        >
          {navigationError}
        </div>
      ) : null}

      {createdRequest !== null ? (
        <div
          className="mt-6 rounded-lg border border-success-200 bg-success-50 px-4 py-3 text-sm text-success-700 dark:border-success-700 dark:bg-surface-dark dark:text-success-100"
          role="status"
        >
          Reprint request{' '}
          <span className="font-mono font-semibold">
            {createdRequest.displayId ??
              createdRequest.requestId}
          </span>{' '}
          was created locally.
        </div>
      ) : null}

      <section
        className="mt-6 rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted sm:p-6"
        aria-label="Create reprint request form"
      >
        <RequestForm
          values={values}
          context={accessContext}
          permissionAllowed={permissionAllowed}
          permissionFeedback={
            role === 'ITS'
              ? 'The ITS demo role may view platform diagnostics but cannot create claim reprint requests.'
              : 'Your current demo role cannot create a reprint request.'
          }
          disabled={disabled || contextLoading}
          onChange={handleFormChange}
          onSubmit={handleSubmit}
          onSuccess={handleCreated}
        />
      </section>
    </div>
  );
}

RequestNewPage.propTypes = {
  session: PropTypes.object,
  context: PropTypes.object,
  requestService: PropTypes.object,
  fixtureGateway: PropTypes.object,
  fixtureRepository: PropTypes.object,
  claimService: PropTypes.object,
  discoveryService: PropTypes.object,
  initialClaimNumber: PropTypes.string,
  initialMemberId: PropTypes.string,
  initialRequestType: PropTypes.string,
  initialPriority: PropTypes.string,
  processNow: PropTypes.bool,
  disabled: PropTypes.bool,
  onCreated: PropTypes.func,
  onSuccess: PropTypes.func,
  onNavigate: PropTypes.func,
};

export const CreateRequestPage = RequestNewPage;
export const ReprintRequestPage = RequestNewPage;
export const NewReprintRequestPage = RequestNewPage;

export default RequestNewPage;