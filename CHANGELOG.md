# Changelog

All notable changes to the Claims Explanation Simulator are documented in this file.

## [1.0.0] - 2026-10-21

Initial V1 release of the browser-local EOB and EOR claims demonstration.

### Added

#### V1 journeys

- Seeded fictional personas for Member, CSR, BOS, ITS, and Administrator roles.
- Two-step local sign-in using the printed demo password and MFA code.
- Role-aware home workspaces and navigation.
- Local member and claim discovery with autocomplete and filtering.
- Ownership-safe claim, member, and document routes.
- EOB and EOR previews with financial summaries, service lines, reason codes, appeal guidance, and role-aware masking.
- Browser-local reprint request creation and deterministic processing.
- Static representative PDF downloads with versioned filenames and explicit non-authoritative notices.
- Generic access-denied and not-found states that do not disclose protected identifiers.

#### Deferred roadmap implementation

- CSR dashboard with representative KPIs, alerts, recent requests, activity charts, and local audit evidence.
- Deterministic scripted claims assistant with five fixed topics and no model calls.
- BOS request queue with filtering, sorting, bulk selection, independent row processing, and formula-safe CSV export.
- Nine-stage reprint pipeline with compressed playback, checkpoints, pause and resume behavior, manual review, failures, document creation, and local outbound projections.
- AP reprint and 835 inbound fixture processing with exact ordered schemas, allowlisted scenarios, independent row outcomes, retries, and local CDC evidence.
- Ten-step nightly batch workflow with deterministic row scenarios and isolated retries.
- Immediate and nightly claim-rework workflows that retain immutable EOB and EOR versions.
- Manual-review approval, rejection, reason-coded financial adjustments, and retained failure evidence.
- Sanitized error-report viewing, local JSON export, queueing, and closure.
- Completed report portal with role-scoped filters and approved static downloads.
- Member-owned document portal that excludes provider remittance artifacts.
- Simulated fax outbox state transitions with no external transmission.
- Administrator user CRUD for non-seeded fictional accounts.
- Revision-safe demonstration settings updates and default restoration.
- Governed JSON snapshot export, local validation, replacement, and canonical sample restore.
- Masked audit history with filters, pagination, JSON export, and formula-safe CSV export.
- Deterministic monitoring dashboard with KPIs, charts, gauges, alerts, event playback, local refresh, and retained appearance preference.
- Disconnected integration inventory covering data, agent, application, integration, and external architecture layers.
- Local data administration views for conceptual source replicas, aggregate counts, and role-constrained metadata.
- Honest compliance status separating implemented demo behavior from production-only controls.
- Published executive Case A and Case B fixtures retained as separate, unreconciled presentation data.
- Published before-and-after productivity fixtures with supplied steps, error points, staffing, savings, ROI, payback, and speed labels.

#### Deterministic data and persistence

- Canonical fictional fixture bundle for accounts, members, coverages, providers, claims, service lines, reason codes, restrictions, documents, operations, and insights.
- Fixture manifest with record counts, relationships, provenance, required display tokens, artifact metadata, and story traceability.
- Startup fixture-integrity validation.
- Versioned browser-local storage envelope with checksums, commit markers, optimistic revisions, and cross-tab invalidation.
- Platform and operations schema migrations with future-version refusal.
- Revision-safe repositories for users, settings, audits, preferences, fixtures, insights, and operations.
- Bounded browser-local audit retention and centralized defensive masking.
- Idempotent request, pipeline, inbound, batch, review, error-report, and outbound operations.
- Volatile in-memory fallback when browser storage is unavailable.
- Read-only recovery behavior for unsafe or corrupt persisted state.
- Canonical sample-data restoration without clearing unrelated browser namespaces.
- Centralized clock, identifier, formatting, download, permission, timer, and validation utilities.

#### Static artifacts

- Representative EOB PDF for fictional claim `CL2024001`.
- Representative member EOR PDF for fictional claim `CL2024001`.
- Separate provider-scoped remittance EOR PDF containing fictional multi-patient rows.
- Artifact manifest entries with SHA-256 checksums, audience scopes, media types, dates, and fixture versions.
- Same-origin download validation and automatic Blob URL cleanup.
- Required notices stating that artifacts are fictional, are not bills, and are not authoritative claim documents.

#### Accessibility and responsive behavior

- Semantic headings, labels, status text, live regions, and keyboard-operable controls.
- Focus-managed confirmation and session-warning dialogs.
- Skip-to-content navigation and responsive authenticated application shell.
- Reduced-motion support.
- Light, dark, and monitoring near-black presentation states.
- Core member journeys designed without horizontal overflow from 320px through desktop widths.
- Print rules that remove navigation and dialog chrome from representative document output.

#### Testing and quality

- Unit tests for authentication, permissions, persistence, migrations, fixture integrity, masking, administration, snapshots, audits, insights, documents, requests, pipelines, inbound processing, batches, reviews, errors, and bulk operations.
- React Testing Library coverage for sign-in, document previews, and pipeline controls.
- Playwright acceptance journeys for seeded personas, governance, insights, operations, privacy, downloads, and access denial.
- Axe smoke checks for serious and critical WCAG violations on core routes.
- Responsive checks at 320px, 375px, 768px, and 1440px.
- Network-isolation tests covering fetch, XHR, WebSocket, EventSource, beacon, and upload primitives.
- Console privacy checks for fictional identifiers and credential values.
- ESLint restrictions against direct network primitives, direct `localStorage` access outside the storage gateway, and invalid layer imports.
- Production builds without source maps.

#### Setup and deployment

- Vite 6 and React 19 single-page application setup.
- Tailwind CSS theme with responsive and dark-mode support.
- Vitest configuration with deterministic time, crypto, browser API mocks, and fail-fast network guards.
- Playwright projects for desktop Chromium, 320px phone emulation, and offline Chromium.
- Vercel SPA rewrite configuration.
- Optional non-secret build labels:
  - `VITE_APP_VERSION`
  - `VITE_REFERENCE_DATE`
  - `VITE_FIXTURE_VERSION`
- Development and validation commands:
  - `npm run dev`
  - `npm run build`
  - `npm run preview`
  - `npm run lint`
  - `npm run test`
  - `npm run test:browser`
  - `npm run check`

### Security and privacy characteristics

- No application API, payer, provider, identity, healthcare, payment, monitoring, reporting, CRM, email, fax, queue, database, or integration service is connected.
- Application code does not use fetch, XHR, WebSocket, EventSource, beacon, or upload primitives.
- Demo credentials are validated locally and are not transmitted.
- Sensitive values are masked before audit persistence and role-scoped presentation.
- Member claim and document access requires matching fictional ownership.
- Provider remittance artifacts are segregated from member and CSR document access.
- Production builds disable privacy-safe diagnostic logging.
- Unknown and unauthorized protected resources use non-disclosing responses.

### Known simulation boundaries

- Authentication, MFA, sessions, roles, and permissions are client-side demonstrations and are not production security controls.
- Browser storage is user-editable, best-effort, and not secure or durable server storage.
- Role checks can be altered through browser developer tools.
- All records, metrics, charts, timings, alerts, outcomes, audits, and reports are fictional fixtures.
- Pipeline and batch minute labels are representative productivity values, not measured runtime duration.
- Monitoring refresh advances deterministic local state and does not read infrastructure telemetry.
- Integration statuses and connection labels describe conceptual architecture only.
- Scripted assistant responses are fixed local text and do not call an AI model.
- Static PDFs are representative samples and are not authoritative claim documents.
- Fax, email, CRM, reporting, IXIT, queue, and delivery states are local metadata only; no transmission occurs.
- Executive and productivity figures are supplied presentation fixtures and are not calculated from local claim records.
- Conflicting published figures are intentionally not reconciled.
- Audit events are mutable browser-local evidence and are not immutable legal, security, or compliance audit records.
- Snapshot controls are not encrypted backup, immutable retention, or disaster recovery.
- No HIPAA, SOC 2 Type II, PCI DSS, or other regulatory or security certification is claimed.
- Production-only controls such as federated identity, server-side authorization, encryption at rest, rate limiting, security assessments, and disaster recovery are not provided.