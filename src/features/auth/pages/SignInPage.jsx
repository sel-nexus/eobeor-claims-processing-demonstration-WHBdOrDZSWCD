import PropTypes from 'prop-types';
import {
  useId,
  useMemo,
  useState,
} from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  KeyRound,
  Loader2,
  LockKeyhole,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import {
  DEMO_CREDENTIAL_NOTICE,
  DEMO_MFA_CODE,
  DEMO_PASSWORD,
  SEEDED_ACCOUNTS,
} from '../../../fixtures/accounts.js';

const SIGN_IN_STEPS = Object.freeze({
  PASSWORD: 'PASSWORD',
  MFA: 'MFA',
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

function getResultErrorMessage(result) {
  if (
    result !== null &&
    typeof result === 'object' &&
    typeof result.error?.message === 'string' &&
    result.error.message.trim().length > 0
  ) {
    return result.error.message;
  }

  return 'The demo credentials could not be validated.';
}

function getResultFieldErrors(result) {
  return Array.isArray(result?.error?.fieldErrors)
    ? result.error.fieldErrors.filter(
        (error) =>
          error !== null &&
          typeof error === 'object' &&
          typeof error.message === 'string' &&
          error.message.trim().length > 0,
      )
    : [];
}

function findAccount(accounts, username) {
  return (
    accounts.find(
      (account) => account.username === username,
    ) ?? null
  );
}

/**
 * Seeded browser-local sign-in route with password and printed MFA steps.
 *
 * @param {{
 *   authFacade?: {signIn: Function},
 *   accounts?: readonly Record<string, unknown>[],
 *   initialUsername?: string,
 *   onSignedIn?: Function,
 *   onSuccess?: Function
 * }} props Component props.
 * @returns {JSX.Element} Sign-in page.
 */
export function SignInPage({
  authFacade = null,
  accounts = SEEDED_ACCOUNTS,
  initialUsername = '',
  onSignedIn,
  onSuccess,
}) {
  const accountId = useId();
  const passwordId = useId();
  const mfaId = useId();
  const errorId = useId();
  const [username, setUsername] = useState(() =>
    accounts.some(
      (account) => account.username === initialUsername,
    )
      ? initialUsername
      : '',
  );
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [step, setStep] = useState(
    SIGN_IN_STEPS.PASSWORD,
  );
  const [pending, setPending] = useState(false);
  const [operationError, setOperationError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState([]);
  const selectedAccount = useMemo(
    () => findAccount(accounts, username),
    [accounts, username],
  );
  const successHandler = onSignedIn ?? onSuccess;

  const clearFeedback = () => {
    setOperationError(null);
    setFieldErrors([]);
  };

  const handleAccountChange = (event) => {
    setUsername(event.target.value);
    setPassword('');
    setMfaCode('');
    setStep(SIGN_IN_STEPS.PASSWORD);
    clearFeedback();
  };

  const handlePasswordStep = (event) => {
    event.preventDefault();
    clearFeedback();

    if (selectedAccount === null) {
      setFieldErrors([
        {
          field: 'username',
          message: 'Select a fictional demo account.',
        },
      ]);
      return;
    }

    if (password.length === 0) {
      setFieldErrors([
        {
          field: 'password',
          message: 'Enter the printed demo password.',
        },
      ]);
      return;
    }

    if (password !== DEMO_PASSWORD) {
      setOperationError(
        'The demo credentials could not be validated.',
      );
      return;
    }

    setStep(SIGN_IN_STEPS.MFA);
  };

  const handleCompanySso = () => {
    clearFeedback();

    if (selectedAccount === null) {
      setFieldErrors([
        {
          field: 'username',
          message:
            'Select a fictional demo account before continuing with company SSO.',
        },
      ]);
      return;
    }

    setPassword(DEMO_PASSWORD);
    setStep(SIGN_IN_STEPS.MFA);
  };

  const handleSignIn = async (event) => {
    event.preventDefault();
    clearFeedback();

    if (selectedAccount === null) {
      setStep(SIGN_IN_STEPS.PASSWORD);
      setFieldErrors([
        {
          field: 'username',
          message: 'Select a fictional demo account.',
        },
      ]);
      return;
    }

    if (mfaCode.length === 0) {
      setFieldErrors([
        {
          field: 'mfaCode',
          message: 'Enter the printed demo verification code.',
        },
      ]);
      return;
    }

    if (
      authFacade === null ||
      typeof authFacade.signIn !== 'function'
    ) {
      setOperationError(
        'Browser-local sign-in is unavailable in this application composition.',
      );
      return;
    }

    setPending(true);

    try {
      const result = await authFacade.signIn({
        username: selectedAccount.username,
        password,
        mfaCode,
        requestedRole: selectedAccount.role,
      });

      if (result?.ok !== true) {
        setOperationError(getResultErrorMessage(result));
        setFieldErrors(getResultFieldErrors(result));
        return;
      }

      if (typeof successHandler === 'function') {
        await Promise.resolve(
          successHandler(
            result.data?.session ?? null,
            result,
          ),
        );
      }
    } catch (error) {
      setOperationError(
        normalizeErrorMessage(
          error,
          'The browser-local demo session could not be created.',
        ),
      );
    } finally {
      setPending(false);
    }
  };

  const passwordError = fieldErrors.find(
    (error) => error.field === 'password',
  );
  const accountError = fieldErrors.find(
    (error) =>
      error.field === 'username' ||
      error.field === 'requestedRole',
  );
  const mfaError = fieldErrors.find(
    (error) => error.field === 'mfaCode',
  );
  const additionalErrors = fieldErrors.filter(
    (error) =>
      ![
        'username',
        'requestedRole',
        'password',
        'mfaCode',
      ].includes(error.field),
  );

  return (
    <main className="min-h-screen bg-surface-muted px-4 py-8 text-content dark:bg-surface-dark dark:text-content-inverse sm:px-6 sm:py-12">
      <div className="mx-auto w-full max-w-lg">
        <div className="mb-6 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary-600 text-white shadow-card">
            <ShieldCheck
              className="h-6 w-6"
              aria-hidden="true"
            />
          </span>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight text-content dark:text-content-inverse sm:text-3xl">
            EOB/EOR Claims Processing
          </h1>
          <p className="mt-2 text-sm leading-6 text-content-muted dark:text-content-inverse-muted">
            Sign in with a seeded fictional persona to explore
            the browser-local demonstration.
          </p>
        </div>

        <section
          className="overflow-hidden rounded-xl border border-border bg-surface shadow-elevated dark:border-border-dark dark:bg-surface-dark-muted"
          aria-labelledby="sign-in-heading"
          aria-busy={pending}
        >
          <div className="border-b border-border px-5 py-5 dark:border-border-dark sm:px-6">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-100 text-primary-700 dark:bg-primary-950 dark:text-primary-100">
                {step === SIGN_IN_STEPS.PASSWORD ? (
                  <LockKeyhole
                    className="h-5 w-5"
                    aria-hidden="true"
                  />
                ) : (
                  <KeyRound
                    className="h-5 w-5"
                    aria-hidden="true"
                  />
                )}
              </span>
              <div>
                <h2
                  id="sign-in-heading"
                  className="text-lg font-semibold text-content dark:text-content-inverse"
                >
                  {step === SIGN_IN_STEPS.PASSWORD
                    ? 'Demo sign in'
                    : 'Verification code'}
                </h2>
                <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
                  Step{' '}
                  {step === SIGN_IN_STEPS.PASSWORD ? '1' : '2'}{' '}
                  of 2
                </p>
              </div>
            </div>
          </div>

          {step === SIGN_IN_STEPS.PASSWORD ? (
            <>
            <form
              className="space-y-5 px-5 py-6 sm:px-6"
              onSubmit={handlePasswordStep}
              noValidate
            >
              <div>
                <label
                  className="block text-sm font-medium text-content dark:text-content-inverse"
                  htmlFor={accountId}
                >
                  Demo account
                </label>
                <select
                  id={accountId}
                  className="mt-2 block min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-content shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
                  value={username}
                  aria-invalid={accountError !== undefined}
                  aria-describedby={
                    accountError !== undefined
                      ? `${accountId}-error`
                      : `${accountId}-hint`
                  }
                  disabled={pending}
                  onChange={handleAccountChange}
                >
                  <option value="">
                    Select a fictional persona
                  </option>
                  {accounts.map((account) => (
                    <option
                      key={account.userId}
                      value={account.username}
                    >
                      {account.personaLabel ??
                        account.displayName}{' '}
                      — {account.role}
                    </option>
                  ))}
                </select>
                {accountError !== undefined ? (
                  <p
                    id={`${accountId}-error`}
                    className="mt-2 text-sm text-danger-700 dark:text-danger-100"
                  >
                    {accountError.message}
                  </p>
                ) : (
                  <p
                    id={`${accountId}-hint`}
                    className="mt-2 text-xs text-content-subtle dark:text-content-inverse-muted"
                  >
                    Choose a seeded account to set the local demo
                    role.
                  </p>
                )}
              </div>

              {selectedAccount !== null ? (
                <div className="rounded-lg border border-primary-200 bg-primary-50 p-4 dark:border-primary-800 dark:bg-primary-950">
                  <div className="flex items-start gap-3">
                    <UserRound
                      className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
                      aria-hidden="true"
                    />
                    <div className="min-w-0">
                      <p className="font-medium text-primary-900 dark:text-primary-100">
                        {selectedAccount.displayName}
                      </p>
                      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-primary-900 dark:text-primary-100">
                        <dt className="font-semibold">
                          Username
                        </dt>
                        <dd className="break-all font-mono">
                          {selectedAccount.username}
                        </dd>
                        <dt className="font-semibold">
                          Demo role
                        </dt>
                        <dd>{selectedAccount.role}</dd>
                      </dl>
                      <p className="mt-2 text-xs leading-5 text-primary-900 dark:text-primary-100">
                        {selectedAccount.personaDescription}
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}

              <div>
                <label
                  className="block text-sm font-medium text-content dark:text-content-inverse"
                  htmlFor={passwordId}
                >
                  Password
                </label>
                <input
                  id={passwordId}
                  className="mt-2 block min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-content shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 disabled:cursor-not-allowed disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
                  type="password"
                  value={password}
                  autoComplete="current-password"
                  disabled={pending}
                  aria-invalid={passwordError !== undefined}
                  aria-describedby={
                    passwordError !== undefined
                      ? `${passwordId}-error`
                      : `${passwordId}-hint`
                  }
                  onChange={(event) => {
                    setPassword(event.target.value);
                    clearFeedback();
                  }}
                />
                {passwordError !== undefined ? (
                  <p
                    id={`${passwordId}-error`}
                    className="mt-2 text-sm text-danger-700 dark:text-danger-100"
                  >
                    {passwordError.message}
                  </p>
                ) : (
                  <p
                    id={`${passwordId}-hint`}
                    className="mt-2 text-sm text-content-muted dark:text-content-inverse-muted"
                  >
                    Printed demo password:{' '}
                    <span className="rounded bg-surface-muted px-1.5 py-0.5 font-mono font-semibold text-content dark:bg-surface-dark-raised dark:text-content-inverse">
                      {DEMO_PASSWORD}
                    </span>
                  </p>
                )}
              </div>

              {operationError !== null ? (
                <div
                  id={errorId}
                  className="rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700 dark:border-danger-700 dark:bg-danger-950 dark:text-danger-100"
                  role="alert"
                >
                  {operationError}
                </div>
              ) : null}

              <button
                className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-primary-600 bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:focus:ring-offset-surface-dark"
                type="submit"
                disabled={pending}
              >
                Continue
              </button>
            </form>
            <div className="space-y-3 px-5 pb-6 sm:px-6">
              <button
                className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-primary-600 bg-surface px-4 py-2 text-sm font-semibold text-primary-700 transition hover:bg-primary-50 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-surface-dark dark:text-primary-200 dark:hover:bg-primary-950 dark:focus:ring-offset-surface-dark"
                type="button"
                disabled={pending}
                onClick={handleCompanySso}
              >
                Continue with company SSO
              </button>
              <p className="text-xs leading-5 text-content-muted dark:text-content-inverse-muted">
                SAML 2.0 and OAuth 2.0 are named here as
                demonstration labels. Company SSO uses the selected
                fictional persona and does not contact an identity
                provider. The next step still asks for the printed
                MFA code.
              </p>
            </div>
            </>
          ) : (
            <form
              className="space-y-5 px-5 py-6 sm:px-6"
              onSubmit={handleSignIn}
              noValidate
            >
              <div className="rounded-lg border border-success-200 bg-success-50 p-4 dark:border-success-700 dark:bg-surface-dark">
                <div className="flex items-start gap-3">
                  <CheckCircle2
                    className="mt-0.5 h-5 w-5 shrink-0 text-success-700 dark:text-success-100"
                    aria-hidden="true"
                  />
                  <div>
                    <p className="text-sm font-semibold text-success-700 dark:text-success-100">
                      Password step complete
                    </p>
                    <p className="mt-1 text-xs text-success-700 dark:text-success-100">
                      Continuing as{' '}
                      {selectedAccount?.displayName ??
                        'the selected demo user'}.
                    </p>
                  </div>
                </div>
              </div>

              <div>
                <label
                  className="block text-sm font-medium text-content dark:text-content-inverse"
                  htmlFor={mfaId}
                >
                  MFA verification code
                </label>
                <input
                  id={mfaId}
                  className="mt-2 block min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 font-mono text-base tracking-[0.3em] text-content shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 disabled:cursor-not-allowed disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={mfaCode}
                  disabled={pending}
                  aria-invalid={mfaError !== undefined}
                  aria-describedby={
                    mfaError !== undefined
                      ? `${mfaId}-error`
                      : `${mfaId}-hint`
                  }
                  onChange={(event) => {
                    setMfaCode(
                      event.target.value
                        .replace(/\D/g, '')
                        .slice(0, 6),
                    );
                    clearFeedback();
                  }}
                />
                {mfaError !== undefined ? (
                  <p
                    id={`${mfaId}-error`}
                    className="mt-2 text-sm text-danger-700 dark:text-danger-100"
                  >
                    {mfaError.message}
                  </p>
                ) : (
                  <p
                    id={`${mfaId}-hint`}
                    className="mt-2 text-sm text-content-muted dark:text-content-inverse-muted"
                  >
                    Printed demo code:{' '}
                    <span className="rounded bg-surface-muted px-1.5 py-0.5 font-mono font-semibold tracking-wider text-content dark:bg-surface-dark-raised dark:text-content-inverse">
                      {DEMO_MFA_CODE}
                    </span>
                  </p>
                )}
              </div>

              {operationError !== null ||
              additionalErrors.length > 0 ? (
                <div
                  id={errorId}
                  className="rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700 dark:border-danger-700 dark:bg-danger-950 dark:text-danger-100"
                  role="alert"
                >
                  {operationError !== null ? (
                    <p>{operationError}</p>
                  ) : null}
                  {additionalErrors.length > 0 ? (
                    <ul className="list-disc space-y-1 pl-5">
                      {additionalErrors.map((error, index) => (
                        <li key={`${error.field}-${index}`}>
                          {error.message}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}

              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <button
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border-strong bg-surface px-4 py-2 text-sm font-semibold text-content transition hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark-muted dark:text-content-inverse dark:hover:bg-surface-dark-raised dark:focus:ring-offset-surface-dark sm:w-auto"
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    setStep(SIGN_IN_STEPS.PASSWORD);
                    setMfaCode('');
                    clearFeedback();
                  }}
                >
                  <ArrowLeft
                    className="h-4 w-4"
                    aria-hidden="true"
                  />
                  Back
                </button>
                <button
                  className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-primary-600 bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:focus:ring-offset-surface-dark"
                  type="submit"
                  disabled={pending}
                >
                  {pending ? (
                    <Loader2
                      className="h-4 w-4 animate-spin motion-reduce:animate-none"
                      aria-hidden="true"
                    />
                  ) : (
                    <ShieldCheck
                      className="h-4 w-4"
                      aria-hidden="true"
                    />
                  )}
                  {pending ? 'Signing in…' : 'Sign in'}
                </button>
              </div>
            </form>
          )}
        </section>

        <aside
          className="mt-5 rounded-xl border border-primary-200 bg-primary-50 p-4 text-sm text-primary-900 dark:border-primary-800 dark:bg-primary-950 dark:text-primary-100"
          role="note"
          aria-label="Demo credential and privacy disclosure"
        >
          <div className="flex items-start gap-3">
            <ShieldCheck
              className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
              aria-hidden="true"
            />
            <div>
              <p className="font-semibold">
                Local demonstration only
              </p>
              <p className="mt-1 leading-6">
                {DEMO_CREDENTIAL_NOTICE}
              </p>
              <p className="mt-1 leading-6">
                No sign-in information is sent to an identity
                provider, payer, healthcare system, or other
                external service. These client-side controls are
                not production authentication or authorization.
              </p>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}

SignInPage.propTypes = {
  authFacade: PropTypes.shape({
    signIn: PropTypes.func.isRequired,
  }),
  accounts: PropTypes.arrayOf(
    PropTypes.shape({
      userId: PropTypes.string.isRequired,
      username: PropTypes.string.isRequired,
      displayName: PropTypes.string.isRequired,
      role: PropTypes.string.isRequired,
      personaLabel: PropTypes.string,
      personaDescription: PropTypes.string,
    }),
  ),
  initialUsername: PropTypes.string,
  onSignedIn: PropTypes.func,
  onSuccess: PropTypes.func,
};

export const AuthenticationPage = SignInPage;
export const DemoSignInPage = SignInPage;

export default SignInPage;