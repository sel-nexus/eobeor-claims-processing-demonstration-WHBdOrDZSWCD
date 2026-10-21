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
  Clock3,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Settings,
  ShieldCheck,
  Trash2,
  UserCog,
  Users,
  X,
} from 'lucide-react';
import {
  INITIAL_SETTINGS,
} from '../../../fixtures/seedBundle.js';
import {
  SEEDED_USERS,
} from '../../../fixtures/accounts.js';
import AccessDenied from '../../../platform/components/AccessDenied.jsx';
import ConfirmDialog from '../../../platform/components/ConfirmDialog.jsx';
import StatusBadge from '../../../platform/components/StatusBadge.jsx';
import {
  formatDateTime,
  formatStatus,
} from '../../../platform/utils/formatters.js';
import {
  isPlainObject,
  isPlatformRole,
} from '../../../platform/validation/schemas.js';

const AUTHORIZED_ROLES = new Set(['ADMIN', 'ITS']);
const USER_ADMIN_ROLES = new Set(['ADMIN']);
const USER_ROLES = Object.freeze([
  'MEMBER',
  'CSR',
  'BOS',
  'ITS',
  'ADMIN',
]);
const EMPTY_COLLECTION = Object.freeze([]);
const RESTORE_SETTINGS_CONFIRMATION =
  'RESTORE DEFAULT SETTINGS';

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
    userId:
      typeof source.userId === 'string' &&
      source.userId.trim().length > 0
        ? source.userId.normalize('NFC').trim()
        : typeof source.actorId === 'string' &&
            source.actorId.trim().length > 0
          ? source.actorId.normalize('NFC').trim()
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

  if (Array.isArray(result?.error?.fieldErrors)) {
    error.fieldErrors = result.error.fieldErrors;
  }

  return error;
}

function unwrapServiceResult(result, fallback) {
  if (result?.ok === false) {
    throw createServiceError(result, fallback);
  }

  return result?.ok === true ? result.data : result;
}

function normalizeUserCollection(result) {
  const value = unwrapServiceResult(
    result,
    'Fictional users could not be loaded.',
  );

  if (Array.isArray(value)) {
    return value;
  }

  if (Array.isArray(value?.items)) {
    return value.items;
  }

  if (Array.isArray(value?.users)) {
    return value.users;
  }

  if (value === null || value === undefined) {
    return [];
  }

  throw new TypeError(
    'The local administration service returned an invalid user collection.',
  );
}

function normalizeUserResult(result, fallback) {
  const value = unwrapServiceResult(result, fallback);

  if (isPlainObject(value?.user)) {
    return value.user;
  }

  return isPlainObject(value) ? value : null;
}

function normalizeSettingsResult(result, fallback) {
  const value = unwrapServiceResult(result, fallback);

  if (isPlainObject(value?.settings)) {
    return value.settings;
  }

  return isPlainObject(value) ? value : null;
}

function resolveListUsersMethod(service) {
  if (service === null || service === undefined) {
    return null;
  }

  if (typeof service.listUsers === 'function') {
    return service.listUsers.bind(service);
  }

  if (typeof service.list === 'function') {
    return service.list.bind(service);
  }

  return null;
}

function resolveCreateUserMethod(service) {
  if (service === null || service === undefined) {
    return null;
  }

  if (typeof service.createUser === 'function') {
    return service.createUser.bind(service);
  }

  if (typeof service.create === 'function') {
    return service.create.bind(service);
  }

  return null;
}

function resolveUpdateUserMethod(service) {
  if (service === null || service === undefined) {
    return null;
  }

  if (typeof service.updateUser === 'function') {
    return service.updateUser.bind(service);
  }

  if (typeof service.update === 'function') {
    return service.update.bind(service);
  }

  return null;
}

function resolveDeleteUserMethod(service) {
  if (service === null || service === undefined) {
    return null;
  }

  if (typeof service.deleteUser === 'function') {
    return service.deleteUser.bind(service);
  }

  if (typeof service.remove === 'function') {
    return service.remove.bind(service);
  }

  return null;
}

function resolveReadSettingsMethod(service) {
  if (service === null || service === undefined) {
    return null;
  }

  if (typeof service.getSettings === 'function') {
    return service.getSettings.bind(service);
  }

  if (typeof service.getPlatformSettings === 'function') {
    return service.getPlatformSettings.bind(service);
  }

  if (typeof service.get === 'function') {
    return service.get.bind(service);
  }

  return null;
}

function resolveUpdateSettingsMethod(service) {
  if (service === null || service === undefined) {
    return null;
  }

  if (typeof service.updateSettings === 'function') {
    return service.updateSettings.bind(service);
  }

  if (typeof service.updatePlatformSettings === 'function') {
    return service.updatePlatformSettings.bind(service);
  }

  return null;
}

function resolveRestoreSettingsMethod(service) {
  if (service === null || service === undefined) {
    return null;
  }

  if (typeof service.restoreSettings === 'function') {
    return service.restoreSettings.bind(service);
  }

  if (typeof service.restoreDefaultSettings === 'function') {
    return service.restoreDefaultSettings.bind(service);
  }

  return null;
}

function createEmptyUserForm() {
  return {
    username: '',
    displayName: '',
    role: 'CSR',
    memberId: '',
    active: true,
  };
}

function createUserForm(user) {
  return {
    username:
      typeof user?.username === 'string'
        ? user.username
        : '',
    displayName:
      typeof user?.displayName === 'string'
        ? user.displayName
        : '',
    role: normalizeRole(user?.role) ?? 'CSR',
    memberId:
      typeof user?.memberId === 'string'
        ? user.memberId
        : '',
    active: user?.active !== false,
  };
}

function createSettingsForm(settings) {
  return {
    retentionYears:
      settings?.retentionYears === undefined
        ? ''
        : String(settings.retentionYears),
    autoApproveAmount:
      settings?.autoApproveAmount === undefined
        ? ''
        : String(settings.autoApproveAmount),
    sessionTimeoutMinutes:
      settings?.sessionTimeoutMinutes === undefined
        ? ''
        : String(settings.sessionTimeoutMinutes),
  };
}

function validateUserForm(form) {
  const errors = [];
  const username = form.username
    .normalize('NFC')
    .trim()
    .toLocaleLowerCase('en-US');
  const displayName = form.displayName.normalize('NFC').trim();
  const memberId = form.memberId.normalize('NFC').trim();

  if (!/^[a-z0-9._-]{3,40}$/.test(username)) {
    errors.push({
      field: 'username',
      message:
        'Username must contain 3–40 lowercase letters, numbers, periods, underscores, or hyphens.',
    });
  }

  if (
    displayName.length < 2 ||
    displayName.length > 80
  ) {
    errors.push({
      field: 'displayName',
      message: 'Display name must contain 2–80 characters.',
    });
  }

  if (!USER_ROLES.includes(form.role)) {
    errors.push({
      field: 'role',
      message: 'Select a supported demo role.',
    });
  }

  if (
    form.role === 'MEMBER' &&
    (memberId.length === 0 || memberId.length > 200)
  ) {
    errors.push({
      field: 'memberId',
      message:
        'Member ID is required for a member role and must not exceed 200 characters.',
    });
  }

  return {
    errors,
    values: {
      username,
      displayName,
      role: form.role,
      memberId: form.role === 'MEMBER' ? memberId : null,
      active: form.active,
    },
  };
}

function validateSettingsForm(form) {
  const retentionYears = Number(form.retentionYears);
  const autoApproveAmount = Number(form.autoApproveAmount);
  const sessionTimeoutMinutes = Number(
    form.sessionTimeoutMinutes,
  );
  const errors = [];

  if (
    !Number.isInteger(retentionYears) ||
    retentionYears < 1 ||
    retentionYears > 10
  ) {
    errors.push({
      field: 'retentionYears',
      message:
        'Retention years must be a whole number between 1 and 10.',
    });
  }

  if (
    !Number.isFinite(autoApproveAmount) ||
    autoApproveAmount < 0 ||
    autoApproveAmount > 10000 ||
    !Number.isInteger(Math.round(autoApproveAmount * 100))
  ) {
    errors.push({
      field: 'autoApproveAmount',
      message:
        'Auto-approval amount must be between 0 and 10000 with at most two decimal places.',
    });
  }

  if (
    !Number.isInteger(sessionTimeoutMinutes) ||
    sessionTimeoutMinutes < 2 ||
    sessionTimeoutMinutes > 240
  ) {
    errors.push({
      field: 'sessionTimeoutMinutes',
      message:
        'Session timeout must be a whole number between 2 and 240 minutes.',
    });
  }

  return {
    errors,
    values: {
      retentionYears,
      autoApproveAmount,
      sessionTimeoutMinutes,
    },
  };
}

function getFieldError(errors, field) {
  return errors.find((error) => error.field === field);
}

function getUserKey(user, index) {
  return user.userId ?? user.username ?? `admin-user-${index}`;
}

/**
 * User and rule administration route for browser-local fictional data.
 *
 * @param {{
 *   session?: Record<string, unknown>|null,
 *   context?: Record<string, unknown>|null,
 *   adminFacade?: object,
 *   adminService?: object,
 *   settingsService?: object,
 *   initialUsers?: readonly Record<string, unknown>[],
 *   initialSettings?: Record<string, unknown>,
 *   onUserCreated?: Function,
 *   onUserUpdated?: Function,
 *   onUserDeleted?: Function,
 *   onSettingsUpdated?: Function,
 *   onSettingsRestored?: Function
 * }} props Component props.
 * @returns {JSX.Element} Administration page.
 */
export function AdminPage({
  session = null,
  context = null,
  adminFacade = null,
  adminService = null,
  settingsService = null,
  initialUsers = SEEDED_USERS,
  initialSettings = INITIAL_SETTINGS,
  onUserCreated,
  onUserUpdated,
  onUserDeleted,
  onSettingsUpdated,
  onSettingsRestored,
}) {
  const headingId = useId();
  const usernameId = useId();
  const displayNameId = useId();
  const userRoleId = useId();
  const memberIdInput = useId();
  const retentionId = useId();
  const approvalId = useId();
  const timeoutId = useId();
  const accessContext = useMemo(
    () => normalizeContext(context ?? session),
    [context, session],
  );
  const role = accessContext?.role ?? null;
  const authenticated = accessContext !== null;
  const canManageUsers =
    role !== null && USER_ADMIN_ROLES.has(role);
  const service = adminFacade ?? adminService;
  const settingsApi = settingsService ?? service;
  const listUsers = useMemo(
    () => resolveListUsersMethod(service),
    [service],
  );
  const readSettings = useMemo(
    () => resolveReadSettingsMethod(settingsApi),
    [settingsApi],
  );
  const [users, setUsers] = useState(initialUsers);
  const [settings, setSettings] = useState(initialSettings);
  const [settingsForm, setSettingsForm] = useState(() =>
    createSettingsForm(initialSettings),
  );
  const [userForm, setUserForm] = useState(
    createEmptyUserForm,
  );
  const [editingUserId, setEditingUserId] = useState(null);
  const [creatingUser, setCreatingUser] = useState(false);
  const [deleteCandidate, setDeleteCandidate] = useState(null);
  const [restoreDialogOpen, setRestoreDialogOpen] =
    useState(false);
  const [loading, setLoading] = useState(
    (canManageUsers && listUsers !== null) ||
      readSettings !== null,
  );
  const [pendingAction, setPendingAction] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [operationError, setOperationError] = useState(null);
  const [operationMessage, setOperationMessage] =
    useState(null);
  const [fieldErrors, setFieldErrors] = useState([]);

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

      setLoading(true);
      setLoadError(null);

      try {
        const [userResult, settingsResult] = await Promise.all([
          canManageUsers && listUsers !== null
            ? Promise.resolve(
                listUsers({
                  page: 1,
                  limit: 100,
                }),
              )
            : Promise.resolve(null),
          readSettings !== null
            ? Promise.resolve(readSettings())
            : Promise.resolve(null),
        ]);

        if (!active) {
          return;
        }

        if (userResult !== null) {
          setUsers(normalizeUserCollection(userResult));
        } else {
          setUsers(initialUsers);
        }

        if (settingsResult !== null) {
          const loadedSettings = normalizeSettingsResult(
            settingsResult,
            'Local demonstration settings could not be loaded.',
          );

          if (loadedSettings !== null) {
            setSettings(loadedSettings);
            setSettingsForm(
              createSettingsForm(loadedSettings),
            );
          }
        } else {
          setSettings(initialSettings);
          setSettingsForm(
            createSettingsForm(initialSettings),
          );
        }
      } catch (error) {
        if (active) {
          setUsers(initialUsers);
          setSettings(initialSettings);
          setSettingsForm(
            createSettingsForm(initialSettings),
          );
          setLoadError(
            normalizeErrorMessage(
              error,
              'Local administration data could not be loaded.',
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
            'Local administration data could not be loaded.',
          ),
        );
      }
    });

    return () => {
      active = false;
    };
  }, [
    authenticated,
    canManageUsers,
    initialSettings,
    initialUsers,
    listUsers,
    readSettings,
    role,
  ]);

  const clearFeedback = (field = null) => {
    setOperationError(null);
    setOperationMessage(null);

    if (field === null) {
      setFieldErrors([]);
    } else {
      setFieldErrors((current) =>
        current.filter((error) => error.field !== field),
      );
    }
  };

  const startCreateUser = () => {
    setCreatingUser(true);
    setEditingUserId(null);
    setUserForm(createEmptyUserForm());
    clearFeedback();
  };

  const startEditUser = (user) => {
    setCreatingUser(false);
    setEditingUserId(user.userId);
    setUserForm(createUserForm(user));
    clearFeedback();
  };

  const closeUserForm = () => {
    setCreatingUser(false);
    setEditingUserId(null);
    setUserForm(createEmptyUserForm());
    setFieldErrors([]);
    setOperationError(null);
  };

  const saveUser = async (event) => {
    event.preventDefault();

    if (!canManageUsers) {
      return;
    }

    const validation = validateUserForm(userForm);

    if (validation.errors.length > 0) {
      setFieldErrors(validation.errors);
      setOperationError(
        'Fictional user validation failed.',
      );
      return;
    }

    const editingUser = users.find(
      (user) => user.userId === editingUserId,
    );
    const createUser = resolveCreateUserMethod(service);
    const updateUser = resolveUpdateUserMethod(service);

    if (
      editingUserId === null &&
      createUser === null
    ) {
      setOperationError(
        'Fictional user creation is unavailable in this application composition.',
      );
      return;
    }

    if (
      editingUserId !== null &&
      (updateUser === null || editingUser === undefined)
    ) {
      setOperationError(
        'Fictional user editing is unavailable in this application composition.',
      );
      return;
    }

    setPendingAction(
      editingUserId === null ? 'CREATE_USER' : 'UPDATE_USER',
    );
    clearFeedback();

    try {
      let result;

      if (editingUserId === null) {
        result = await Promise.resolve(
          createUser(validation.values),
        );
      } else {
        result = await Promise.resolve(
          updateUser(editingUserId, {
            ...validation.values,
            expectedRevision: editingUser.revision,
          }),
        );
      }

      const user = normalizeUserResult(
        result,
        editingUserId === null
          ? 'The fictional user could not be created.'
          : 'The fictional user could not be updated.',
      );

      if (user === null) {
        throw new Error(
          'The local administration service returned invalid user data.',
        );
      }

      if (editingUserId === null) {
        setUsers((current) => [...current, user]);
        setOperationMessage(
          `Fictional user ${user.username} was created locally.`,
        );

        if (typeof onUserCreated === 'function') {
          await Promise.resolve(
            onUserCreated(user, result),
          );
        }
      } else {
        setUsers((current) =>
          current.map((candidate) =>
            candidate.userId === editingUserId
              ? user
              : candidate,
          ),
        );
        setOperationMessage(
          `Fictional user ${user.username} was updated locally.`,
        );

        if (typeof onUserUpdated === 'function') {
          await Promise.resolve(
            onUserUpdated(user, result),
          );
        }
      }

      setCreatingUser(false);
      setEditingUserId(null);
      setUserForm(createEmptyUserForm());
      setFieldErrors([]);
    } catch (error) {
      setOperationError(
        normalizeErrorMessage(
          error,
          editingUserId === null
            ? 'The fictional user could not be created.'
            : 'The fictional user could not be updated.',
        ),
      );
      setFieldErrors(
        Array.isArray(error?.fieldErrors)
          ? error.fieldErrors
          : [],
      );
    } finally {
      setPendingAction(null);
    }
  };

  const deleteUser = async () => {
    if (!canManageUsers || deleteCandidate === null) {
      throw new Error(
        'The fictional user is unavailable for removal.',
      );
    }

    const removeUser = resolveDeleteUserMethod(service);

    if (removeUser === null) {
      throw new Error(
        'Fictional user removal is unavailable in this application composition.',
      );
    }

    setPendingAction('DELETE_USER');
    setOperationError(null);
    setOperationMessage(null);

    try {
      const result = await Promise.resolve(
        removeUser(deleteCandidate.userId, {
          expectedRevision: deleteCandidate.revision,
          confirmation: `REMOVE ${deleteCandidate.username}`,
        }),
      );

      unwrapServiceResult(
        result,
        'The fictional user could not be removed.',
      );

      setUsers((current) =>
        current.filter(
          (user) => user.userId !== deleteCandidate.userId,
        ),
      );
      setOperationMessage(
        `Fictional user ${deleteCandidate.username} was removed locally.`,
      );

      if (typeof onUserDeleted === 'function') {
        await Promise.resolve(
          onUserDeleted(deleteCandidate, result),
        );
      }

      setDeleteCandidate(null);
    } catch (error) {
      const message = normalizeErrorMessage(
        error,
        'The fictional user could not be removed.',
      );

      setOperationError(message);
      throw new Error(message);
    } finally {
      setPendingAction(null);
    }
  };

  const saveSettings = async (event) => {
    event.preventDefault();

    const validation = validateSettingsForm(settingsForm);

    if (validation.errors.length > 0) {
      setFieldErrors(validation.errors);
      setOperationError(
        'Demonstration settings validation failed.',
      );
      return;
    }

    const updateSettings =
      resolveUpdateSettingsMethod(settingsApi);

    if (updateSettings === null) {
      setOperationError(
        'Settings updates are unavailable in this application composition.',
      );
      return;
    }

    setPendingAction('UPDATE_SETTINGS');
    clearFeedback();

    try {
      const result = await Promise.resolve(
        updateSettings({
          changes: validation.values,
          expectedRevision: settings.revision,
        }),
      );
      const updatedSettings = normalizeSettingsResult(
        result,
        'Local demonstration settings could not be updated.',
      );

      if (updatedSettings === null) {
        throw new Error(
          'The local administration service returned invalid settings data.',
        );
      }

      setSettings(updatedSettings);
      setSettingsForm(
        createSettingsForm(updatedSettings),
      );
      setOperationMessage(
        'Local demonstration settings were updated.',
      );

      if (typeof onSettingsUpdated === 'function') {
        await Promise.resolve(
          onSettingsUpdated(updatedSettings, result),
        );
      }
    } catch (error) {
      setOperationError(
        normalizeErrorMessage(
          error,
          'Local demonstration settings could not be updated.',
        ),
      );
      setFieldErrors(
        Array.isArray(error?.fieldErrors)
          ? error.fieldErrors
          : [],
      );
    } finally {
      setPendingAction(null);
    }
  };

  const restoreSettings = async () => {
    if (role !== 'ADMIN') {
      throw new Error(
        'Only the Administrator demo role can restore default settings.',
      );
    }

    const restore =
      resolveRestoreSettingsMethod(settingsApi);

    if (restore === null) {
      throw new Error(
        'Default settings restore is unavailable in this application composition.',
      );
    }

    setPendingAction('RESTORE_SETTINGS');
    setOperationError(null);
    setOperationMessage(null);

    try {
      const result = await Promise.resolve(
        restore({
          expectedRevision: settings.revision,
          confirmation: RESTORE_SETTINGS_CONFIRMATION,
        }),
      );
      const restoredSettings = normalizeSettingsResult(
        result,
        'Default demonstration settings could not be restored.',
      );

      if (restoredSettings === null) {
        throw new Error(
          'The local administration service returned invalid settings data.',
        );
      }

      setSettings(restoredSettings);
      setSettingsForm(
        createSettingsForm(restoredSettings),
      );
      setFieldErrors([]);
      setOperationMessage(
        'Default demonstration settings were restored locally.',
      );

      if (typeof onSettingsRestored === 'function') {
        await Promise.resolve(
          onSettingsRestored(restoredSettings, result),
        );
      }

      setRestoreDialogOpen(false);
    } catch (error) {
      const message = normalizeErrorMessage(
        error,
        'Default demonstration settings could not be restored.',
      );

      setOperationError(message);
      throw new Error(message);
    } finally {
      setPendingAction(null);
    }
  };

  if (!authenticated) {
    return <AccessDenied authenticated={false} />;
  }

  if (role === null || !AUTHORIZED_ROLES.has(role)) {
    return <AccessDenied authenticated />;
  }

  const usernameError = getFieldError(
    fieldErrors,
    'username',
  );
  const displayNameError = getFieldError(
    fieldErrors,
    'displayName',
  );
  const roleError = getFieldError(fieldErrors, 'role');
  const memberIdError = getFieldError(
    fieldErrors,
    'memberId',
  );
  const retentionError = getFieldError(
    fieldErrors,
    'retentionYears',
  );
  const approvalError = getFieldError(
    fieldErrors,
    'autoApproveAmount',
  );
  const timeoutError = getFieldError(
    fieldErrors,
    'sessionTimeoutMinutes',
  );
  const userFormOpen =
    creatingUser || editingUserId !== null;
  const pending = pendingAction !== null;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
      <header
        className="overflow-hidden rounded-2xl border border-primary-200 bg-primary-50 shadow-card dark:border-primary-800 dark:bg-primary-950"
        aria-labelledby={headingId}
      >
        <div className="grid gap-5 px-5 py-6 sm:px-7 sm:py-8 lg:grid-cols-[1fr_auto] lg:items-center">
          <div className="flex min-w-0 items-start gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-600 text-white shadow-sm">
              <UserCog
                className="h-6 w-6"
                aria-hidden="true"
              />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-primary-700 dark:text-primary-300">
                Browser-local governance
              </p>
              <h1
                id={headingId}
                className="mt-1 text-2xl font-semibold tracking-tight text-content dark:text-content-inverse sm:text-3xl"
              >
                User and rule administration
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-content-muted dark:text-content-inverse-muted sm:text-base">
                Manage fictional local users and permitted
                demonstration settings without contacting an
                identity, payer, healthcare, or external
                administration system.
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
        aria-label="Administration disclosure"
      >
        <div className="flex items-start gap-3">
          <ShieldCheck
            className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
            aria-hidden="true"
          />
          <div>
            <p className="font-semibold">
              Client-side demonstration controls
            </p>
            <p className="mt-1 leading-6">
              Users, roles, retention, auto-approval, and session
              timeout values are fictional browser-local data.
              These controls are not production identity,
              authorization, compliance, or policy enforcement.
            </p>
            {role === 'ITS' ? (
              <p className="mt-1 leading-6">
                ITS may update permitted demonstration settings.
                Fictional user creation, role assignment, removal,
                and default restoration remain Administrator-only.
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
          {loadError} Bundled local values are displayed where
          available.
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

      {loading ? (
        <div
          className="mt-6 flex items-center gap-3 rounded-xl border border-border bg-surface p-5 text-sm text-content-muted shadow-card dark:border-border-dark dark:bg-surface-dark-muted dark:text-content-inverse-muted"
          role="status"
          aria-live="polite"
        >
          <Loader2
            className="h-5 w-5 animate-spin text-primary-600 motion-reduce:animate-none"
            aria-hidden="true"
          />
          Loading browser-local administration data
        </div>
      ) : null}

      {canManageUsers ? (
        <section
          className="mt-8"
          aria-labelledby="fictional-users-heading"
          aria-busy={
            pendingAction === 'CREATE_USER' ||
            pendingAction === 'UPDATE_USER' ||
            pendingAction === 'DELETE_USER'
          }
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex items-start gap-3">
              <Users
                className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
                aria-hidden="true"
              />
              <div>
                <h2
                  id="fictional-users-heading"
                  className="text-xl font-semibold text-content dark:text-content-inverse"
                >
                  Fictional users and roles
                </h2>
                <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
                  Create or edit non-production personas. Seeded
                  users cannot be removed.
                </p>
              </div>
            </div>

            <button
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-primary-600 bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:focus:ring-offset-surface-dark"
              type="button"
              disabled={pending || userFormOpen}
              onClick={startCreateUser}
            >
              <Plus
                className="h-4 w-4"
                aria-hidden="true"
              />
              Create fictional user
            </button>
          </div>

          {userFormOpen ? (
            <form
              className="mt-5 rounded-xl border border-primary-200 bg-primary-50 p-5 shadow-card dark:border-primary-800 dark:bg-primary-950 sm:p-6"
              onSubmit={saveUser}
              noValidate
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-lg font-semibold text-content dark:text-content-inverse">
                    {editingUserId === null
                      ? 'Create fictional user'
                      : 'Edit fictional user'}
                  </h3>
                  <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
                    Role assignments affect only client-side demo
                    route and action visibility.
                  </p>
                </div>
                <button
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-content-muted transition hover:bg-surface focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-60 dark:text-content-inverse-muted dark:hover:bg-surface-dark"
                  type="button"
                  aria-label="Close fictional user form"
                  disabled={pending}
                  onClick={closeUserForm}
                >
                  <X className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>

              <div className="mt-5 grid gap-5 sm:grid-cols-2">
                <div>
                  <label
                    className="block text-sm font-medium text-content dark:text-content-inverse"
                    htmlFor={usernameId}
                  >
                    Username
                  </label>
                  <input
                    id={usernameId}
                    className="mt-2 block min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 font-mono text-sm text-content shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
                    type="text"
                    value={userForm.username}
                    maxLength={40}
                    autoComplete="off"
                    disabled={pending}
                    aria-invalid={usernameError !== undefined}
                    onChange={(event) => {
                      setUserForm((current) => ({
                        ...current,
                        username: event.target.value
                          .toLocaleLowerCase('en-US'),
                      }));
                      clearFeedback('username');
                    }}
                  />
                  {usernameError !== undefined ? (
                    <p className="mt-2 text-sm text-danger-700 dark:text-danger-100">
                      {usernameError.message}
                    </p>
                  ) : null}
                </div>

                <div>
                  <label
                    className="block text-sm font-medium text-content dark:text-content-inverse"
                    htmlFor={displayNameId}
                  >
                    Display name
                  </label>
                  <input
                    id={displayNameId}
                    className="mt-2 block min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-content shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
                    type="text"
                    value={userForm.displayName}
                    maxLength={80}
                    disabled={pending}
                    aria-invalid={
                      displayNameError !== undefined
                    }
                    onChange={(event) => {
                      setUserForm((current) => ({
                        ...current,
                        displayName: event.target.value,
                      }));
                      clearFeedback('displayName');
                    }}
                  />
                  {displayNameError !== undefined ? (
                    <p className="mt-2 text-sm text-danger-700 dark:text-danger-100">
                      {displayNameError.message}
                    </p>
                  ) : null}
                </div>

                <div>
                  <label
                    className="block text-sm font-medium text-content dark:text-content-inverse"
                    htmlFor={userRoleId}
                  >
                    Demo role
                  </label>
                  <select
                    id={userRoleId}
                    className="mt-2 block min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-content shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
                    value={userForm.role}
                    disabled={pending}
                    aria-invalid={roleError !== undefined}
                    onChange={(event) => {
                      const nextRole = event.target.value;

                      setUserForm((current) => ({
                        ...current,
                        role: nextRole,
                        memberId:
                          nextRole === 'MEMBER'
                            ? current.memberId
                            : '',
                      }));
                      clearFeedback('role');
                    }}
                  >
                    {USER_ROLES.map((userRole) => (
                      <option key={userRole} value={userRole}>
                        {formatStatus(userRole)}
                      </option>
                    ))}
                  </select>
                  {roleError !== undefined ? (
                    <p className="mt-2 text-sm text-danger-700 dark:text-danger-100">
                      {roleError.message}
                    </p>
                  ) : null}
                </div>

                <div>
                  <label
                    className="block text-sm font-medium text-content dark:text-content-inverse"
                    htmlFor={memberIdInput}
                  >
                    Member ID
                  </label>
                  <input
                    id={memberIdInput}
                    className="mt-2 block min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 font-mono text-sm text-content shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 disabled:cursor-not-allowed disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
                    type="text"
                    value={userForm.memberId}
                    maxLength={200}
                    disabled={pending || userForm.role !== 'MEMBER'}
                    aria-invalid={memberIdError !== undefined}
                    placeholder={
                      userForm.role === 'MEMBER'
                        ? 'Fictional member ID'
                        : 'Not used for this role'
                    }
                    onChange={(event) => {
                      setUserForm((current) => ({
                        ...current,
                        memberId: event.target.value,
                      }));
                      clearFeedback('memberId');
                    }}
                  />
                  {memberIdError !== undefined ? (
                    <p className="mt-2 text-sm text-danger-700 dark:text-danger-100">
                      {memberIdError.message}
                    </p>
                  ) : null}
                </div>
              </div>

              <label className="mt-5 flex min-h-11 items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-sm font-medium text-content dark:border-border-dark dark:bg-surface-dark dark:text-content-inverse">
                <input
                  className="h-4 w-4 rounded border-border-strong text-primary-600 focus:ring-primary-500"
                  type="checkbox"
                  checked={userForm.active}
                  disabled={pending}
                  onChange={(event) => {
                    setUserForm((current) => ({
                      ...current,
                      active: event.target.checked,
                    }));
                    clearFeedback();
                  }}
                />
                Active fictional user
              </label>

              <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row">
                <button
                  className="inline-flex min-h-10 items-center justify-center rounded-lg border border-border-strong bg-surface px-4 py-2 text-sm font-semibold text-content transition hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
                  type="button"
                  disabled={pending}
                  onClick={closeUserForm}
                >
                  Cancel
                </button>
                <button
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-primary-600 bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-60"
                  type="submit"
                  disabled={pending}
                >
                  {pendingAction === 'CREATE_USER' ||
                  pendingAction === 'UPDATE_USER' ? (
                    <Loader2
                      className="h-4 w-4 animate-spin motion-reduce:animate-none"
                      aria-hidden="true"
                    />
                  ) : (
                    <Save
                      className="h-4 w-4"
                      aria-hidden="true"
                    />
                  )}
                  {pendingAction === 'CREATE_USER'
                    ? 'Creating locally…'
                    : pendingAction === 'UPDATE_USER'
                      ? 'Saving locally…'
                      : editingUserId === null
                        ? 'Create user'
                        : 'Save user'}
                </button>
              </div>
            </form>
          ) : null}

          {users.length === 0 ? (
            <div
              className="mt-5 rounded-xl border border-border bg-surface p-6 text-center shadow-card dark:border-border-dark dark:bg-surface-dark-muted"
              role="status"
            >
              <p className="text-sm text-content-muted dark:text-content-inverse-muted">
                No fictional users are available.
              </p>
            </div>
          ) : (
            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              {users.map((user, index) => {
                const self =
                  accessContext.userId === user.userId;
                const deleteDisabled =
                  user.systemSeed === true || self;

                return (
                  <article
                    key={getUserKey(user, index)}
                    className="rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <h3 className="font-semibold text-content dark:text-content-inverse">
                          {user.displayName}
                        </h3>
                        <p className="mt-1 break-all font-mono text-xs text-content-subtle dark:text-content-inverse-muted">
                          {user.username} · {user.userId}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <StatusBadge
                          status={user.role}
                          variant="neutral"
                        />
                        <StatusBadge
                          status={
                            user.active === false
                              ? 'INACTIVE'
                              : 'ACTIVE'
                          }
                        />
                      </div>
                    </div>

                    <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                          Member ID
                        </dt>
                        <dd className="mt-1 break-all font-mono font-medium text-content dark:text-content-inverse">
                          {user.memberId ?? 'Not applicable'}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                          Revision
                        </dt>
                        <dd className="mt-1 font-medium text-content dark:text-content-inverse">
                          {user.revision ?? '—'}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                          Account type
                        </dt>
                        <dd className="mt-1 font-medium text-content dark:text-content-inverse">
                          {user.systemSeed === true
                            ? 'Seeded persona'
                            : 'Locally created'}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-content-subtle dark:text-content-inverse-muted">
                          Updated
                        </dt>
                        <dd className="mt-1 font-medium text-content dark:text-content-inverse">
                          {formatDateTime(user.updatedAt)}
                        </dd>
                      </div>
                    </dl>

                    <div className="mt-5 flex flex-col gap-2 border-t border-border pt-4 dark:border-border-dark sm:flex-row">
                      <button
                        className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border-strong bg-surface px-4 py-2 text-sm font-semibold text-content transition hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
                        type="button"
                        disabled={pending || userFormOpen}
                        onClick={() => startEditUser(user)}
                      >
                        <Pencil
                          className="h-4 w-4"
                          aria-hidden="true"
                        />
                        Edit user
                      </button>
                      <button
                        className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-danger-600 bg-surface px-4 py-2 text-sm font-semibold text-danger-700 transition hover:bg-danger-50 focus:outline-none focus:ring-2 focus:ring-danger-500 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-surface-dark dark:text-danger-100"
                        type="button"
                        disabled={
                          pending ||
                          userFormOpen ||
                          deleteDisabled
                        }
                        title={
                          user.systemSeed === true
                            ? 'Seeded fictional users cannot be removed.'
                            : self
                              ? 'The active fictional user cannot remove their own account.'
                              : undefined
                        }
                        onClick={() => {
                          clearFeedback();
                          setDeleteCandidate(user);
                        }}
                      >
                        <Trash2
                          className="h-4 w-4"
                          aria-hidden="true"
                        />
                        {user.systemSeed === true
                          ? 'Seeded user'
                          : self
                            ? 'Current user'
                            : 'Remove user'}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      ) : null}

      <section
        className="mt-8 rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted sm:p-6"
        aria-labelledby="demo-settings-heading"
        aria-busy={
          pendingAction === 'UPDATE_SETTINGS' ||
          pendingAction === 'RESTORE_SETTINGS'
        }
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <Settings
              className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
              aria-hidden="true"
            />
            <div>
              <h2
                id="demo-settings-heading"
                className="text-xl font-semibold text-content dark:text-content-inverse"
              >
                Demonstration rules and session settings
              </h2>
              <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
                Configure permitted browser-local retention,
                auto-approval, and inactivity values.
              </p>
            </div>
          </div>

          {role === 'ADMIN' ? (
            <button
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-warning-700 bg-warning-50 px-4 py-2 text-sm font-semibold text-warning-700 transition hover:bg-warning-100 focus:outline-none focus:ring-2 focus:ring-warning-500 disabled:opacity-60 dark:bg-warning-950 dark:text-warning-100"
              type="button"
              disabled={pending}
              onClick={() => {
                clearFeedback();
                setRestoreDialogOpen(true);
              }}
            >
              <RotateCcw
                className="h-4 w-4"
                aria-hidden="true"
              />
              Restore defaults
            </button>
          ) : null}
        </div>

        <form
          className="mt-6 space-y-6"
          onSubmit={saveSettings}
          noValidate
        >
          <div className="grid gap-5 md:grid-cols-3">
            <div>
              <label
                className="block text-sm font-medium text-content dark:text-content-inverse"
                htmlFor={retentionId}
              >
                Retention years
              </label>
              <input
                id={retentionId}
                className="mt-2 block min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-content shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
                type="number"
                min="1"
                max="10"
                step="1"
                inputMode="numeric"
                value={settingsForm.retentionYears}
                disabled={pending}
                aria-invalid={retentionError !== undefined}
                onChange={(event) => {
                  setSettingsForm((current) => ({
                    ...current,
                    retentionYears: event.target.value,
                  }));
                  clearFeedback('retentionYears');
                }}
              />
              <p className="mt-2 text-xs text-content-subtle dark:text-content-inverse-muted">
                Demo range: 1–10 years.
              </p>
              {retentionError !== undefined ? (
                <p className="mt-2 text-sm text-danger-700 dark:text-danger-100">
                  {retentionError.message}
                </p>
              ) : null}
            </div>

            <div>
              <label
                className="block text-sm font-medium text-content dark:text-content-inverse"
                htmlFor={approvalId}
              >
                Auto-approval amount
              </label>
              <div className="relative mt-2">
                <span
                  className="pointer-events-none absolute left-3 top-2.5 text-sm text-content-subtle dark:text-content-inverse-muted"
                  aria-hidden="true"
                >
                  $
                </span>
                <input
                  id={approvalId}
                  className="block min-h-11 w-full rounded-lg border border-border-strong bg-surface py-2 pl-7 pr-3 text-sm text-content shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
                  type="number"
                  min="0"
                  max="10000"
                  step="0.01"
                  inputMode="decimal"
                  value={settingsForm.autoApproveAmount}
                  disabled={pending}
                  aria-invalid={approvalError !== undefined}
                  onChange={(event) => {
                    setSettingsForm((current) => ({
                      ...current,
                      autoApproveAmount: event.target.value,
                    }));
                    clearFeedback('autoApproveAmount');
                  }}
                />
              </div>
              <p className="mt-2 text-xs text-content-subtle dark:text-content-inverse-muted">
                Demo range: $0–$10,000.
              </p>
              {approvalError !== undefined ? (
                <p className="mt-2 text-sm text-danger-700 dark:text-danger-100">
                  {approvalError.message}
                </p>
              ) : null}
            </div>

            <div>
              <label
                className="block text-sm font-medium text-content dark:text-content-inverse"
                htmlFor={timeoutId}
              >
                Session timeout
              </label>
              <div className="relative mt-2">
                <Clock3
                  className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-content-subtle dark:text-content-inverse-muted"
                  aria-hidden="true"
                />
                <input
                  id={timeoutId}
                  className="block min-h-11 w-full rounded-lg border border-border-strong bg-surface py-2 pl-10 pr-3 text-sm text-content shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
                  type="number"
                  min="2"
                  max="240"
                  step="1"
                  inputMode="numeric"
                  value={settingsForm.sessionTimeoutMinutes}
                  disabled={pending}
                  aria-invalid={timeoutError !== undefined}
                  onChange={(event) => {
                    setSettingsForm((current) => ({
                      ...current,
                      sessionTimeoutMinutes:
                        event.target.value,
                    }));
                    clearFeedback(
                      'sessionTimeoutMinutes',
                    );
                  }}
                />
              </div>
              <p className="mt-2 text-xs text-content-subtle dark:text-content-inverse-muted">
                Demo range: 2–240 minutes.
              </p>
              {timeoutError !== undefined ? (
                <p className="mt-2 text-sm text-danger-700 dark:text-danger-100">
                  {timeoutError.message}
                </p>
              ) : null}
            </div>
          </div>

          <aside
            className="rounded-lg border border-primary-200 bg-primary-50 p-4 text-sm text-primary-900 dark:border-primary-800 dark:bg-primary-950 dark:text-primary-100"
            role="note"
          >
            <p className="font-semibold">
              Local rules only
            </p>
            <p className="mt-1 leading-6">
              Retention and auto-approval values influence
              deterministic fictional validation. Session timeout
              controls browser-local inactivity behavior and may
              shorten the current demo session.
            </p>
            <p className="mt-2 text-xs">
              Current settings revision:{' '}
              <span className="font-mono font-semibold">
                {settings.revision ?? '—'}
              </span>
              {settings.updatedAt
                ? ` · Updated ${formatDateTime(
                    settings.updatedAt,
                  )}`
                : ''}
            </p>
          </aside>

          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <button
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border-strong bg-surface px-4 py-2 text-sm font-semibold text-content transition hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
              type="button"
              disabled={pending}
              onClick={() => {
                setSettingsForm(
                  createSettingsForm(settings),
                );
                clearFeedback();
              }}
            >
              <RotateCcw
                className="h-4 w-4"
                aria-hidden="true"
              />
              Reset unsaved values
            </button>
            <button
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-primary-600 bg-primary-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-60"
              type="submit"
              disabled={pending}
            >
              {pendingAction === 'UPDATE_SETTINGS' ? (
                <Loader2
                  className="h-4 w-4 animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              ) : (
                <Save
                  className="h-4 w-4"
                  aria-hidden="true"
                />
              )}
              {pendingAction === 'UPDATE_SETTINGS'
                ? 'Saving locally…'
                : 'Save demonstration settings'}
            </button>
          </div>
        </form>
      </section>

      <aside
        className="mt-8 rounded-xl border border-warning-200 bg-warning-50 p-5 text-warning-700 shadow-card dark:border-warning-700 dark:bg-warning-950 dark:text-warning-100 sm:p-6"
        role="note"
        aria-label="Governance limitations"
      >
        <div className="flex items-start gap-3">
          <ShieldCheck
            className="mt-0.5 h-5 w-5 shrink-0"
            aria-hidden="true"
          />
          <div>
            <p className="font-semibold">
              Not production governance
            </p>
            <p className="mt-1 text-sm leading-6">
              User records, role assignments, settings, and
              revisions can be changed through browser developer
              tools and local storage. They do not provide secure
              identity, server-side authorization, regulatory
              compliance, durable policy storage, or external
              enforcement.
            </p>
          </div>
        </div>
      </aside>

      <ConfirmDialog
        open={deleteCandidate !== null}
        title="Remove this fictional user?"
        description={
          deleteCandidate === null
            ? 'This removes a browser-local fictional user.'
            : `This removes ${deleteCandidate.displayName} from browser-local demonstration data. This action does not affect any real identity system.`
        }
        confirmLabel="Remove fictional user"
        cancelLabel="Cancel"
        confirmationText={
          deleteCandidate === null
            ? undefined
            : `REMOVE ${deleteCandidate.username}`
        }
        destructive
        loading={pendingAction === 'DELETE_USER'}
        onConfirm={deleteUser}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteCandidate(null);
          }
        }}
      />

      <ConfirmDialog
        open={restoreDialogOpen}
        title="Restore default demonstration settings?"
        description="This replaces the current browser-local retention, auto-approval, and session timeout values with the configured fictional defaults."
        confirmLabel="Restore default settings"
        cancelLabel="Cancel"
        confirmationText={RESTORE_SETTINGS_CONFIRMATION}
        destructive
        loading={pendingAction === 'RESTORE_SETTINGS'}
        onConfirm={restoreSettings}
        onOpenChange={setRestoreDialogOpen}
      />
    </div>
  );
}

AdminPage.propTypes = {
  session: PropTypes.object,
  context: PropTypes.object,
  adminFacade: PropTypes.object,
  adminService: PropTypes.object,
  settingsService: PropTypes.object,
  initialUsers: PropTypes.arrayOf(PropTypes.object),
  initialSettings: PropTypes.object,
  onUserCreated: PropTypes.func,
  onUserUpdated: PropTypes.func,
  onUserDeleted: PropTypes.func,
  onSettingsUpdated: PropTypes.func,
  onSettingsRestored: PropTypes.func,
};

export const UserAdministrationPage = AdminPage;
export const GovernanceAdminPage = AdminPage;
export const LocalAdminPage = AdminPage;

export default AdminPage;