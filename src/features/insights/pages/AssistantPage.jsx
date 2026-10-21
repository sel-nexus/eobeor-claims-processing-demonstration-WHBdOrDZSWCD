import PropTypes from 'prop-types';
import {
  useId,
  useMemo,
  useState,
} from 'react';
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  ClipboardList,
  FileText,
  HelpCircle,
  Link2,
  Loader2,
  MessageSquareText,
  ShieldCheck,
} from 'lucide-react';
import {
  ASSISTANT_SCRIPT_LIST,
} from '../../../fixtures/insights.js';
import AccessDenied from '../../../platform/components/AccessDenied.jsx';
import StatusBadge from '../../../platform/components/StatusBadge.jsx';
import {
  formatDateTime,
} from '../../../platform/utils/formatters.js';
import {
  isPlainObject,
  isPlatformRole,
} from '../../../platform/validation/schemas.js';

const AUTHORIZED_ROLES = new Set(['CSR', 'ADMIN']);
const EMPTY_COLLECTION = Object.freeze([]);
const MAXIMUM_INQUIRY_ID_LENGTH = 200;
const MAXIMUM_NOTE_LENGTH = 240;

const TOPIC_DESCRIPTIONS = Object.freeze({
  EOB:
    'Explain the purpose and common financial fields of an Explanation of Benefits.',
  EOR:
    'Explain the fictional review result, reason codes, and masked payment references.',
  CODE_45:
    'Explain the contractual adjustment represented by processing code 45.',
  REPRESENTATIVE_DOWNLOAD:
    'Explain why the downloadable PDF is a static representative sample.',
  REPRINT_STATUS:
    'Explain the browser-local pending, processing, review, complete, and failed states.',
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

function normalizeResponseResult(result) {
  const value = unwrapServiceResult(
    result,
    'The scripted assistant response could not be created.',
  );
  const response = isPlainObject(value?.response)
    ? value.response
    : value;

  if (
    !isPlainObject(response) ||
    typeof response.responseId !== 'string' ||
    response.responseId.trim().length === 0 ||
    typeof response.topic !== 'string' ||
    typeof response.answer !== 'string' ||
    response.answer.trim().length === 0
  ) {
    throw new TypeError(
      'The local assistant returned an invalid scripted response.',
    );
  }

  return response;
}

function normalizeAttachmentResult(result) {
  const value = unwrapServiceResult(
    result,
    'The scripted response could not be attached to the local inquiry.',
  );
  const attachment = isPlainObject(value?.attachment)
    ? value.attachment
    : value;

  if (
    !isPlainObject(attachment) ||
    typeof attachment.attachmentId !== 'string' ||
    attachment.attachmentId.trim().length === 0
  ) {
    throw new TypeError(
      'The local assistant returned invalid attachment evidence.',
    );
  }

  return {
    attachment,
    inquiryRevision:
      Number.isSafeInteger(value?.inquiryRevision) &&
      value.inquiryRevision >= 0
        ? value.inquiryRevision
        : null,
  };
}

function resolveRespondMethod(service) {
  if (service === null || service === undefined) {
    return null;
  }

  if (typeof service.respond === 'function') {
    return service.respond.bind(service);
  }

  if (typeof service.respondToTopic === 'function') {
    return service.respondToTopic.bind(service);
  }

  return null;
}

function resolveAttachMethod(service) {
  if (service === null || service === undefined) {
    return null;
  }

  if (typeof service.attachResponse === 'function') {
    return service.attachResponse.bind(service);
  }

  if (typeof service.attachAssistantResponse === 'function') {
    return service.attachAssistantResponse.bind(service);
  }

  if (typeof service.attach === 'function') {
    return service.attach.bind(service);
  }

  return null;
}

function normalizeTopic(value) {
  return typeof value === 'string'
    ? value
        .normalize('NFC')
        .trim()
        .replace(/[\s-]+/g, '_')
        .toUpperCase()
    : '';
}

function normalizeInquiryId(value) {
  return typeof value === 'string'
    ? value.normalize('NFC').trim()
    : '';
}

function getInquiryId(inquiry) {
  const value = inquiry?.inquiryId ?? inquiry?.id;

  return typeof value === 'string'
    ? value.normalize('NFC').trim()
    : '';
}

function getInquiryLabel(inquiry) {
  const identifier = getInquiryId(inquiry);

  if (
    typeof inquiry?.displayId === 'string' &&
    inquiry.displayId.trim().length > 0
  ) {
    return inquiry.displayId;
  }

  if (
    typeof inquiry?.title === 'string' &&
    inquiry.title.trim().length > 0
  ) {
    return inquiry.title;
  }

  return identifier || 'Local inquiry';
}

function getInquiryRevision(inquiry) {
  return Number.isSafeInteger(inquiry?.revision) &&
    inquiry.revision >= 0
    ? inquiry.revision
    : 0;
}

function getTopicKey(script, index) {
  return script.topic ?? `assistant-topic-${index}`;
}

/**
 * Deterministic CSR help assistant route.
 *
 * @param {{
 *   session?: Record<string, unknown>|null,
 *   context?: Record<string, unknown>|null,
 *   assistantFacade?: object,
 *   assistantService?: object,
 *   scripts?: readonly Record<string, unknown>[],
 *   initialTopic?: string,
 *   initialInquiryId?: string,
 *   initialInquiryRevision?: number,
 *   initialInquiries?: readonly Record<string, unknown>[],
 *   onResponded?: Function,
 *   onAttached?: Function
 * }} props Component props.
 * @returns {JSX.Element} Scripted assistant page.
 */
export function AssistantPage({
  session = null,
  context = null,
  assistantFacade = null,
  assistantService = null,
  scripts = ASSISTANT_SCRIPT_LIST,
  initialTopic = '',
  initialInquiryId = '',
  initialInquiryRevision = 0,
  initialInquiries = EMPTY_COLLECTION,
  onResponded,
  onAttached,
}) {
  const headingId = useId();
  const topicGroupId = useId();
  const inquiryIdInput = useId();
  const inquiryRevisionId = useId();
  const noteId = useId();
  const feedbackId = useId();
  const accessContext = useMemo(
    () => normalizeContext(context ?? session),
    [context, session],
  );
  const role = accessContext?.role ?? null;
  const authenticated = accessContext !== null;
  const service = assistantFacade ?? assistantService;
  const respond = resolveRespondMethod(service);
  const attach = resolveAttachMethod(service);
  const availableScripts = useMemo(
    () =>
      scripts.filter(
        (script) =>
          isPlainObject(script) &&
          typeof script.topic === 'string' &&
          script.topic.trim().length > 0,
      ),
    [scripts],
  );
  const normalizedInitialTopic = normalizeTopic(initialTopic);
  const [selectedTopic, setSelectedTopic] = useState(() =>
    availableScripts.some(
      (script) =>
        normalizeTopic(script.topic) === normalizedInitialTopic,
    )
      ? normalizedInitialTopic
      : '',
  );
  const [response, setResponse] = useState(null);
  const [responding, setResponding] = useState(false);
  const [inquiryId, setInquiryId] = useState(() =>
    normalizeInquiryId(initialInquiryId),
  );
  const [inquiryRevision, setInquiryRevision] = useState(
    Number.isSafeInteger(initialInquiryRevision) &&
      initialInquiryRevision >= 0
      ? String(initialInquiryRevision)
      : '0',
  );
  const [note, setNote] = useState('');
  const [attaching, setAttaching] = useState(false);
  const [attachment, setAttachment] = useState(null);
  const [operationError, setOperationError] = useState(null);
  const [operationMessage, setOperationMessage] =
    useState(null);
  const selectedScript =
    availableScripts.find(
      (script) =>
        normalizeTopic(script.topic) === selectedTopic,
    ) ?? null;
  const pending = responding || attaching;

  const clearFeedback = () => {
    setOperationError(null);
    setOperationMessage(null);
  };

  const selectTopic = (topic) => {
    setSelectedTopic(normalizeTopic(topic));
    setResponse(null);
    setAttachment(null);
    clearFeedback();
  };

  const handleRespond = async (event) => {
    event.preventDefault();
    clearFeedback();
    setAttachment(null);

    if (selectedScript === null) {
      setOperationError(
        'Select one of the supported scripted help topics.',
      );
      return;
    }

    if (respond === null) {
      setOperationError(
        'The scripted assistant is unavailable in this application composition.',
      );
      return;
    }

    setResponding(true);

    try {
      const result = await Promise.resolve(
        respond({
          topic: normalizeTopic(selectedScript.topic),
        }),
      );
      const nextResponse = normalizeResponseResult(result);

      setResponse(nextResponse);
      setOperationMessage(
        'A deterministic browser-local script was selected. No model or external service was contacted.',
      );

      if (typeof onResponded === 'function') {
        await Promise.resolve(
          onResponded(nextResponse, result),
        );
      }
    } catch (error) {
      setResponse(null);
      setOperationError(
        normalizeErrorMessage(
          error,
          'The scripted assistant response could not be created.',
        ),
      );
    } finally {
      setResponding(false);
    }
  };

  const handleInquirySelection = (value) => {
    const normalizedId = normalizeInquiryId(value);
    const inquiry = initialInquiries.find(
      (candidate) => getInquiryId(candidate) === normalizedId,
    );

    setInquiryId(normalizedId);

    if (inquiry !== undefined) {
      setInquiryRevision(String(getInquiryRevision(inquiry)));
    }

    setAttachment(null);
    clearFeedback();
  };

  const handleAttach = async (event) => {
    event.preventDefault();
    clearFeedback();
    setAttachment(null);

    if (response === null) {
      setOperationError(
        'Create a scripted response before attaching it to an inquiry.',
      );
      return;
    }

    if (attach === null) {
      setOperationError(
        'Inquiry attachment is unavailable in this application composition.',
      );
      return;
    }

    const normalizedInquiryId = normalizeInquiryId(inquiryId);
    const revision = Number(inquiryRevision);
    const normalizedNote = note.normalize('NFC').trim();

    if (
      normalizedInquiryId.length === 0 ||
      normalizedInquiryId.length >
        MAXIMUM_INQUIRY_ID_LENGTH
    ) {
      setOperationError(
        'Inquiry ID must contain 1–200 characters.',
      );
      return;
    }

    if (
      !Number.isSafeInteger(revision) ||
      revision < 0
    ) {
      setOperationError(
        'Expected inquiry revision must be a non-negative whole number.',
      );
      return;
    }

    if (normalizedNote.length > MAXIMUM_NOTE_LENGTH) {
      setOperationError(
        `Attachment note must not exceed ${MAXIMUM_NOTE_LENGTH} characters.`,
      );
      return;
    }

    setAttaching(true);

    try {
      const result = await Promise.resolve(
        attach(normalizedInquiryId, {
          responseId: response.responseId,
          expectedInquiryRevision: revision,
          ...(normalizedNote.length > 0
            ? { note: normalizedNote }
            : {}),
        }),
      );
      const evidence = normalizeAttachmentResult(result);

      setAttachment(evidence.attachment);

      if (evidence.inquiryRevision !== null) {
        setInquiryRevision(
          String(evidence.inquiryRevision),
        );
      }

      setOperationMessage(
        'The scripted response was attached to the browser-local inquiry.',
      );

      if (typeof onAttached === 'function') {
        await Promise.resolve(
          onAttached(
            evidence.attachment,
            evidence.inquiryRevision,
            result,
          ),
        );
      }
    } catch (error) {
      setOperationError(
        normalizeErrorMessage(
          error,
          'The scripted response could not be attached to the local inquiry.',
        ),
      );
    } finally {
      setAttaching(false);
    }
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
              <Bot
                className="h-6 w-6"
                aria-hidden="true"
              />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-primary-700 dark:text-primary-300">
                CSR help assistant
              </p>
              <h1
                id={headingId}
                className="mt-1 text-2xl font-semibold tracking-tight text-content dark:text-content-inverse sm:text-3xl"
              >
                Scripted claims explanations
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-content-muted dark:text-content-inverse-muted sm:text-base">
                Select a fixed EOB, EOR, code 45, representative
                download, or reprint-status explanation for a
                fictional support inquiry.
              </p>
            </div>
          </div>

          <StatusBadge
            status="SCRIPTED"
            variant="neutral"
            label="Scripted demo — no model call"
          />
        </div>
      </header>

      <aside
        className="mt-5 rounded-xl border border-primary-200 bg-primary-50 p-4 text-sm text-primary-900 dark:border-primary-800 dark:bg-primary-950 dark:text-primary-100"
        role="note"
        aria-label="Scripted assistant disclosure"
      >
        <div className="flex items-start gap-3">
          <ShieldCheck
            className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
            aria-hidden="true"
          />
          <div>
            <p className="font-semibold">
              Scripted demo — no model call
            </p>
            <p className="mt-1 leading-6">
              Every answer is selected from an immutable bundled
              script. No prompt, inquiry, claim, member, or answer
              is sent to an AI model, payer, provider, healthcare
              system, or other external service.
            </p>
          </div>
        </div>
      </aside>

      {operationError !== null ? (
        <div
          id={feedbackId}
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

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <section
          className="rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted sm:p-6 xl:col-span-2"
          aria-labelledby="assistant-topics-heading"
          aria-busy={responding}
        >
          <div className="flex items-start gap-3">
            <HelpCircle
              className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
              aria-hidden="true"
            />
            <div>
              <h2
                id="assistant-topics-heading"
                className="text-lg font-semibold text-content dark:text-content-inverse"
              >
                Choose a help topic
              </h2>
              <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
                Free-form prompts are not accepted or retained.
              </p>
            </div>
          </div>

          <form
            className="mt-5"
            onSubmit={handleRespond}
          >
            <fieldset>
              <legend className="sr-only">
                Scripted assistant topics
              </legend>
              <div
                id={topicGroupId}
                className="grid gap-3 sm:grid-cols-2"
              >
                {availableScripts.map((script, index) => {
                  const topic = normalizeTopic(script.topic);
                  const optionId = `${topicGroupId}-${topic}`;
                  const selected = selectedTopic === topic;

                  return (
                    <label
                      key={getTopicKey(script, index)}
                      className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition focus-within:ring-2 focus-within:ring-primary-500 ${
                        selected
                          ? 'border-primary-500 bg-primary-50 dark:border-primary-600 dark:bg-primary-950'
                          : 'border-border bg-surface hover:border-primary-300 hover:bg-surface-muted dark:border-border-dark dark:bg-surface-dark dark:hover:border-primary-700 dark:hover:bg-surface-dark-raised'
                      } ${
                        pending
                          ? 'cursor-not-allowed opacity-60'
                          : ''
                      }`}
                      htmlFor={optionId}
                    >
                      <input
                        id={optionId}
                        className="mt-1 h-4 w-4 shrink-0 border-border-strong text-primary-600 focus:ring-primary-500"
                        type="radio"
                        name={topicGroupId}
                        value={topic}
                        checked={selected}
                        disabled={pending}
                        onChange={() => selectTopic(topic)}
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-content dark:text-content-inverse">
                          {script.title ??
                            topic.replace(/_/g, ' ')}
                        </span>
                        <span className="mt-1 block text-xs leading-5 text-content-muted dark:text-content-inverse-muted">
                          {TOPIC_DESCRIPTIONS[topic] ??
                            'Select this deterministic browser-local explanation.'}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <button
              className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-primary-600 bg-primary-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:focus:ring-offset-surface-dark sm:w-auto"
              type="submit"
              disabled={
                responding ||
                attaching ||
                selectedScript === null
              }
            >
              {responding ? (
                <Loader2
                  className="h-4 w-4 animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              ) : (
                <MessageSquareText
                  className="h-4 w-4"
                  aria-hidden="true"
                />
              )}
              {responding
                ? 'Selecting local script…'
                : 'Show scripted explanation'}
            </button>
          </form>
        </section>

        <aside
          className="rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted sm:p-6"
          aria-labelledby="assistant-boundaries-heading"
        >
          <div className="flex items-start gap-3">
            <FileText
              className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
              aria-hidden="true"
            />
            <div>
              <h2
                id="assistant-boundaries-heading"
                className="text-lg font-semibold text-content dark:text-content-inverse"
              >
                Assistant boundaries
              </h2>
              <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
                Fixed behavior for this local demonstration.
              </p>
            </div>
          </div>

          <ul className="mt-5 space-y-3 text-sm text-content-muted dark:text-content-inverse-muted">
            <li className="rounded-lg bg-surface-muted p-3 dark:bg-surface-dark">
              <span className="block font-semibold text-content dark:text-content-inverse">
                Five supported topics
              </span>
              Answers are selected only by topic identifier.
            </li>
            <li className="rounded-lg bg-surface-muted p-3 dark:bg-surface-dark">
              <span className="block font-semibold text-content dark:text-content-inverse">
                No generated advice
              </span>
              Scripts do not make coverage, payment, benefit,
              appeal, or clinical decisions.
            </li>
            <li className="rounded-lg bg-surface-muted p-3 dark:bg-surface-dark">
              <span className="block font-semibold text-content dark:text-content-inverse">
                Local attachment only
              </span>
              Attachment records remain in browser-local
              fictional inquiry data.
            </li>
          </ul>
        </aside>
      </div>

      <section
        className="mt-6 rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted sm:p-6"
        aria-labelledby="scripted-response-heading"
      >
        <div className="flex items-start gap-3">
          <Bot
            className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
            aria-hidden="true"
          />
          <div>
            <h2
              id="scripted-response-heading"
              className="text-lg font-semibold text-content dark:text-content-inverse"
            >
              Scripted response
            </h2>
            <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
              The selected answer can be attached to one
              browser-local inquiry.
            </p>
          </div>
        </div>

        {response === null ? (
          <div
            className="mt-5 rounded-xl border border-dashed border-border-strong bg-surface-muted p-6 text-center dark:border-border-dark-strong dark:bg-surface-dark"
            role="status"
          >
            <MessageSquareText
              className="mx-auto h-8 w-8 text-content-subtle dark:text-content-inverse-muted"
              aria-hidden="true"
            />
            <p className="mt-3 text-sm font-medium text-content dark:text-content-inverse">
              No script selected yet
            </p>
            <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
              Choose a supported topic to display its fixed local
              explanation.
            </p>
          </div>
        ) : (
          <article className="mt-5 rounded-xl border border-primary-200 bg-primary-50 p-5 dark:border-primary-800 dark:bg-primary-950">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-primary-700 dark:text-primary-300">
                  {selectedScript?.title ??
                    response.topic.replace(/_/g, ' ')}
                </p>
                <p className="mt-3 text-base leading-7 text-primary-900 dark:text-primary-100">
                  {response.answer}
                </p>
              </div>
              <StatusBadge
                className="shrink-0 self-start"
                status="SCRIPTED"
                variant="neutral"
                label="No model call"
              />
            </div>

            <dl className="mt-5 grid gap-3 border-t border-primary-200 pt-4 text-xs dark:border-primary-800 sm:grid-cols-3">
              <div>
                <dt className="font-semibold text-primary-700 dark:text-primary-300">
                  Topic
                </dt>
                <dd className="mt-1 font-mono text-primary-900 dark:text-primary-100">
                  {response.topic}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-primary-700 dark:text-primary-300">
                  Script version
                </dt>
                <dd className="mt-1 font-mono text-primary-900 dark:text-primary-100">
                  {response.scriptVersion ?? 'Bundled fixture'}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-primary-700 dark:text-primary-300">
                  Created
                </dt>
                <dd className="mt-1 text-primary-900 dark:text-primary-100">
                  {formatDateTime(response.createdAt)}
                </dd>
              </div>
            </dl>

            <p className="mt-4 text-xs font-semibold text-primary-700 dark:text-primary-300">
              {response.disclosure ??
                'Scripted demo — no model call'}
            </p>
          </article>
        )}
      </section>

      <section
        className="mt-6 rounded-xl border border-border bg-surface p-5 shadow-card dark:border-border-dark dark:bg-surface-dark-muted sm:p-6"
        aria-labelledby="assistant-attachment-heading"
        aria-busy={attaching}
      >
        <div className="flex items-start gap-3">
          <Link2
            className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-primary-300"
            aria-hidden="true"
          />
          <div>
            <h2
              id="assistant-attachment-heading"
              className="text-lg font-semibold text-content dark:text-content-inverse"
            >
              Attach to a local inquiry
            </h2>
            <p className="mt-1 text-sm text-content-muted dark:text-content-inverse-muted">
              Attach the recent scripted answer with optimistic
              inquiry revision validation.
            </p>
          </div>
        </div>

        <form
          className="mt-5 space-y-5"
          onSubmit={handleAttach}
          noValidate
        >
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label
                className="block text-sm font-medium text-content dark:text-content-inverse"
                htmlFor={inquiryIdInput}
              >
                Inquiry ID
              </label>
              {initialInquiries.length > 0 ? (
                <select
                  id={inquiryIdInput}
                  className="mt-2 block min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-content shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
                  value={inquiryId}
                  disabled={pending}
                  onChange={(event) =>
                    handleInquirySelection(event.target.value)
                  }
                >
                  <option value="">
                    Select a fictional local inquiry
                  </option>
                  {initialInquiries.map((inquiry, index) => {
                    const identifier = getInquiryId(inquiry);

                    return (
                      <option
                        key={
                          identifier ||
                          `assistant-inquiry-${index}`
                        }
                        value={identifier}
                      >
                        {getInquiryLabel(inquiry)}
                        {identifier
                          ? ` — ${identifier}`
                          : ''}
                      </option>
                    );
                  })}
                </select>
              ) : (
                <input
                  id={inquiryIdInput}
                  className="mt-2 block min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 font-mono text-sm text-content shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
                  type="text"
                  value={inquiryId}
                  maxLength={MAXIMUM_INQUIRY_ID_LENGTH}
                  autoComplete="off"
                  disabled={pending}
                  placeholder="inq_1001"
                  onChange={(event) =>
                    handleInquirySelection(event.target.value)
                  }
                />
              )}
              <p className="mt-2 text-xs text-content-subtle dark:text-content-inverse-muted">
                Use a fictional inquiry available to the current
                support session.
              </p>
            </div>

            <div>
              <label
                className="block text-sm font-medium text-content dark:text-content-inverse"
                htmlFor={inquiryRevisionId}
              >
                Expected inquiry revision
              </label>
              <input
                id={inquiryRevisionId}
                className="mt-2 block min-h-11 w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-content shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
                type="number"
                min="0"
                step="1"
                inputMode="numeric"
                value={inquiryRevision}
                disabled={pending}
                onChange={(event) => {
                  setInquiryRevision(event.target.value);
                  setAttachment(null);
                  clearFeedback();
                }}
              />
              <p className="mt-2 text-xs text-content-subtle dark:text-content-inverse-muted">
                A stale revision is rejected instead of
                overwriting newer browser-local inquiry data.
              </p>
            </div>
          </div>

          <div>
            <label
              className="block text-sm font-medium text-content dark:text-content-inverse"
              htmlFor={noteId}
            >
              Attachment note
            </label>
            <textarea
              id={noteId}
              className="mt-2 block min-h-24 w-full resize-y rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-content shadow-sm outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 disabled:opacity-60 dark:border-border-dark-strong dark:bg-surface-dark dark:text-content-inverse"
              value={note}
              maxLength={MAXIMUM_NOTE_LENGTH}
              disabled={pending}
              placeholder="Optional fictional support note"
              onChange={(event) => {
                setNote(event.target.value);
                setAttachment(null);
                clearFeedback();
              }}
            />
            <div className="mt-2 flex items-center justify-between gap-3 text-xs text-content-subtle dark:text-content-inverse-muted">
              <span>
                Use fictional information only.
              </span>
              <span className="tabular-nums">
                {note.length}/{MAXIMUM_NOTE_LENGTH}
              </span>
            </div>
          </div>

          <button
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-primary-600 bg-primary-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:focus:ring-offset-surface-dark sm:w-auto"
            type="submit"
            disabled={pending || response === null}
          >
            {attaching ? (
              <Loader2
                className="h-4 w-4 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : (
              <ClipboardList
                className="h-4 w-4"
                aria-hidden="true"
              />
            )}
            {attaching
              ? 'Attaching locally…'
              : 'Attach scripted response'}
          </button>
        </form>

        {attachment !== null ? (
          <div className="mt-5 rounded-lg border border-success-200 bg-success-50 p-4 dark:border-success-700 dark:bg-surface-dark">
            <div className="flex items-start gap-3">
              <CheckCircle2
                className="mt-0.5 h-5 w-5 shrink-0 text-success-700 dark:text-success-100"
                aria-hidden="true"
              />
              <div className="min-w-0">
                <p className="font-semibold text-success-700 dark:text-success-100">
                  Attachment stored locally
                </p>
                <p className="mt-1 break-all font-mono text-xs text-content-muted dark:text-content-inverse-muted">
                  {attachment.attachmentId}
                </p>
                <p className="mt-2 text-sm text-content-muted dark:text-content-inverse-muted">
                  Inquiry{' '}
                  <span className="font-mono font-semibold text-content dark:text-content-inverse">
                    {attachment.inquiryId ?? inquiryId}
                  </span>
                  {attachment.attachedAt
                    ? ` · ${formatDateTime(
                        attachment.attachedAt,
                      )}`
                    : ''}
                </p>
              </div>
            </div>
          </div>
        ) : null}
      </section>

      <aside
        className="mt-8 rounded-xl border border-warning-200 bg-warning-50 p-5 text-warning-700 shadow-card dark:border-warning-700 dark:bg-warning-950 dark:text-warning-100 sm:p-6"
        role="note"
        aria-label="Assistant response disclaimer"
      >
        <div className="flex items-start gap-3">
          <ShieldCheck
            className="mt-0.5 h-5 w-5 shrink-0"
            aria-hidden="true"
          />
          <div>
            <p className="font-semibold">
              Fictional support explanation only
            </p>
            <p className="mt-1 text-sm leading-6">
              Scripted answers and inquiry attachments are
              deterministic browser-local demonstration records.
              They are not medical, legal, benefit, coverage,
              payment, appeal, or claim-processing advice.
            </p>
          </div>
        </div>
      </aside>
    </div>
  );
}

AssistantPage.propTypes = {
  session: PropTypes.object,
  context: PropTypes.object,
  assistantFacade: PropTypes.object,
  assistantService: PropTypes.object,
  scripts: PropTypes.arrayOf(
    PropTypes.shape({
      topic: PropTypes.string.isRequired,
      title: PropTypes.string,
      answer: PropTypes.string,
      scriptVersion: PropTypes.string,
      disclosure: PropTypes.string,
    }),
  ),
  initialTopic: PropTypes.string,
  initialInquiryId: PropTypes.string,
  initialInquiryRevision: PropTypes.number,
  initialInquiries: PropTypes.arrayOf(PropTypes.object),
  onResponded: PropTypes.func,
  onAttached: PropTypes.func,
};

export const ScriptedAssistantPage = AssistantPage;
export const CsrAssistantPage = AssistantPage;
export const LocalAssistantPage = AssistantPage;

export default AssistantPage;