# Claims Explanation Simulator

A privacy-conscious, browser-local demonstration of healthcare claim explanations, including fictional Explanations of Benefits (EOBs), Explanations of Review (EORs), reprint requests, operations workflows, governance controls, monitoring fixtures, and executive insights.

The application is a static React single-page application. It has no application server, API, database, live identity provider, analytics service, or healthcare integration. All records and workflow outcomes are fictional and run locally in the browser.

## Key features

- Seeded Member, CSR, BOS, ITS, and Administrator personas
- Two-step local sign-in using a printed demo password and MFA code
- Role-aware navigation and home workspaces
- Member and claim discovery with local autocomplete and filtering
- Ownership-safe claim and document routes
- EOB and EOR previews with:
  - Financial summaries
  - Service lines
  - Reason codes
  - Appeal guidance
  - Role-aware masking
- Browser-local EOB and EOR reprint requests
- Deterministic nine-stage document pipeline
- Representative static PDF downloads
- CSR dashboard and scripted claims assistant
- BOS request queue, inbound fixtures, nightly batch, rework, review, and error workflows
- ITS monitoring and disconnected integration inventory
- Administrator user, settings, snapshot, and audit controls
- Published executive and productivity fixtures
- Browser-local persistence, migrations, optimistic revisions, and recovery modes
- Responsive, keyboard-accessible, light, dark, and monitoring near-black presentations
- Automated unit, component, browser, network-isolation, accessibility, and responsive tests

## Simulation boundaries

This project is a demonstration, not a production healthcare application.

### The application does not connect to

- Payers or providers
- Healthcare or clinical systems
- Claims-processing systems
- Payment or banking systems
- Identity providers
- Databases or data lakes
- Message queues
- Email, fax, CRM, reporting, or IXIT services
- Monitoring or observability platforms
- Analytics or session-replay services
- AI or language-model services

Application code does not use `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `navigator.sendBeacon`, or upload network primitives.

### Security and compliance limitations

- Authentication, MFA, sessions, roles, and permissions are client-side simulations.
- Browser developer tools can alter local state and role checks.
- Browser storage is user-editable and is not secure or durable server storage.
- Audit records are mutable browser-local evidence, not legal or security audit records.
- Snapshot controls are not encrypted backup, immutable retention, or disaster recovery.
- Static PDFs are representative samples, not authoritative claim documents.
- No HIPAA, SOC 2 Type II, PCI DSS, or other certification is claimed.
- Production controls such as server-side authorization, federated identity, encryption at rest, rate limiting, security assessments, and disaster recovery are not provided.
- No real healthcare, identity, financial, or payment information should be entered.

All included people, claims, providers, payments, documents, reports, metrics, and workflow results are fictional.

## Seeded accounts

Use the same printed credentials for every seeded persona:

| Credential | Value |
| --- | --- |
| Password | `demo` |
| MFA verification code | `000000` |

Credentials are checked locally and are not transmitted.

| Persona | Username | Role | Primary workspace |
| --- | --- | --- | --- |
| John Doe | `john.doe` | Member | Claims and documents |
| Jane Smith | `jane.smith` | Member | Claims and documents |
| Customer Service Representative | `csr` | CSR | Member support |
| Business Operations Specialist | `bos` | BOS | Operations |
| IT Support Specialist | `its` | ITS | Platform support |
| Administrator | `administrator` | Admin | Administration |

John Doe is associated with representative claim `CL2024001`. Jane Smith is a separate fictional member and cannot access John Doe’s protected claim or document routes.

## Prerequisites

Use a current Node.js LTS release compatible with Vite 6.

The browser must support:

- Modern JavaScript
- Web Crypto
- Blob URLs
- Browser storage

## Installation

From the repository root:

```bash
npm ci
```

If a lockfile is not available:

```bash
npm install
```

CI and production deployments should use `npm ci` when a committed lockfile is present.

## Environment labels

The application accepts three optional, non-secret Vite build labels:

```text
VITE_APP_VERSION
VITE_REFERENCE_DATE
VITE_FIXTURE_VERSION
```

Copy the example file for local customization:

```bash
cp .env.example .env
```

Example:

```text
VITE_APP_VERSION=1.0.0
VITE_REFERENCE_DATE=2024-01-22
VITE_FIXTURE_VERSION=1
```

Defaults:

| Variable | Default |
| --- | --- |
| `VITE_APP_VERSION` | `1.0.0` |
| `VITE_REFERENCE_DATE` | `2024-01-22` |
| `VITE_FIXTURE_VERSION` | `1` |

These values are embedded in the client bundle and are public metadata. Never place credentials, tokens, member data, claim data, connection strings, or other secrets in a `VITE_*` variable.

Changing `VITE_REFERENCE_DATE` can affect deterministic validation behavior. Changing `VITE_FIXTURE_VERSION` changes displayed provenance only and does not transform fixture records.

## Development

Start the Vite development server:

```bash
npm run dev
```

Vite prints the local development URL.

## Production build

Create a production build:

```bash
npm run build
```

The static output is written to `dist/`. Production source maps are disabled.

Preview the production build:

```bash
npm run preview
```

To use the host and port configured for Playwright:

```bash
npm run preview -- --host 127.0.0.1 --port 4173
```

## Validation and testing

### Lint

```bash
npm run lint
```

Lint rules enforce important application boundaries, including:

- No direct application use of network primitives
- No direct `localStorage` access outside the storage gateway
- No invalid imports from infrastructure layers into UI layers

### Unit and component tests

```bash
npm run test
```

Equivalent command:

```bash
npm run test:unit
```

Watch mode:

```bash
npm run test:unit:watch
```

Tests use deterministic time, deterministic crypto, browser API mocks, and fail-fast network guards.

### Browser acceptance tests

```bash
npm run test:browser
```

Equivalent command:

```bash
npm run test:e2e
```

Playwright builds the application and starts the configured Vite preview server. Projects include:

- Desktop Chromium
- 320-pixel phone emulation
- Offline Chromium

The browser suite covers:

- Seeded persona journeys
- Role and ownership denial
- Claim and document workflows
- Operations and governance workflows
- Static downloads
- Network isolation
- Console privacy
- Accessibility smoke checks
- Responsive layouts

### Complete quality gate

```bash
npm run check
```

This runs:

1. ESLint
2. Unit and component tests
3. Production build
4. Playwright browser tests

## Representative workflows

### Member claim and document journey

1. Open `/signin`.
2. Select `john.doe`.
3. Enter password `demo`.
4. Select **Continue**.
5. Enter MFA code `000000`.
6. Select **Sign in**.
7. Open **Claims**.
8. Search for `CL2024001`.
9. Review the financial summary and service details.
10. Open the representative EOB or EOR.
11. Confirm the document displays `This is not a bill.`
12. Use **Download static sample** to download the approved representative PDF.

Representative files are versioned and served from `/documents/`.

### Member reprint request

1. Sign in as `john.doe`.
2. Open claim `CL2024001`.
3. Select **Request EOB or EOR**.
4. Choose EOB, EOR, or both.
5. Create the request.
6. Review compressed deterministic pipeline playback.
7. Open the retained representative document versions after completion.

The request, pipeline, documents, and outbound projections remain browser-local.

### Ownership denial

1. Sign in as `jane.smith`.
2. Navigate directly to `/claims/CL2024001`.
3. Confirm the generic **Access unavailable** state.
4. Navigate to `/documents/DOC-EOB-CL2024001-V1`.
5. Confirm no protected claim, member, payment, or document details are disclosed.

### CSR support journey

1. Sign in as `csr`.
2. Open `/csr` to review representative KPIs, alerts, activity, and recent requests.
3. Open `/claims` to search authorized fictional claims.
4. Open `/assistant`.
5. Select one of the five fixed topics.
6. Display the scripted explanation.

The assistant uses immutable bundled text and makes no model call.

### BOS operations journey

Sign in as `bos` and use:

| Route | Workflow |
| --- | --- |
| `/operations/queue` | Filter, sort, select, process, and export local request rows |
| `/operations/inbound` | Process approved AP reprint and 835 fixtures |
| `/operations/batch` | Run the deterministic ten-step nightly batch |
| `/operations/rework` | Create immediate or nightly claim rework |
| `/operations/reviews` | Approve, reject, or adjust fictional review evidence |
| `/operations/reports` | Filter completed reports and download approved samples |
| `/operations/errors/ERROR-QUALITY-CL2024003-001` | Export, queue, or close a sanitized error report |
| `/executive` | Review separate published Case A and Case B fixtures |
| `/productivity` | Review published before-and-after productivity fixtures |

Inbound file controls match selected filenames to allowlisted bundled fixtures. Arbitrary file content is not uploaded, transmitted, or used as a live feed.

### ITS platform journey

Sign in as `its` and use:

| Route | Workflow |
| --- | --- |
| `/monitoring` | Review and advance deterministic monitoring fixtures |
| `/integrations` | Search disconnected conceptual integrations |
| `/audit` | Review role-scoped masked audit evidence |
| `/admin/settings` | Update permitted demonstration settings |
| `/admin/snapshots` | Export permitted platform diagnostics |
| `/compliance` | Review implemented demo behavior and production-only controls |

Monitoring refresh advances local fixture state and does not read infrastructure telemetry.

### Administrator journey

Sign in as `administrator` and use:

| Route | Workflow |
| --- | --- |
| `/admin/users` | Create, update, and remove non-seeded fictional users |
| `/admin/settings` | Update or restore demonstration settings |
| `/admin/snapshots` | Export, validate, apply, or restore governed local data |
| `/admin/data` | Review conceptual data sources and local metadata |
| `/audit` | Filter and export masked audit history |
| `/monitoring` | Review deterministic monitoring |
| `/integrations` | Review conceptual integration inventory |

Seeded users cannot be removed. Destructive operations require exact typed confirmation.

## Static representative documents

The project includes three prepackaged PDFs:

```text
public/documents/EOB_CL2024001_123456789_20240120_v1.pdf
public/documents/EOR_CL2024001_123456789_20240122_v1.pdf
public/documents/EOR_REMITTANCE_DEMO_20240122_v1.pdf
```

The provider remittance sample is segregated from Member and CSR access because it contains multiple fictional patient rows.

Every representative artifact includes explicit notices that it:

- Contains fictional data
- Is not a bill
- Is not an authoritative claim document
- Must not be used for healthcare or payment decisions

Published versioned artifacts are treated as immutable. If an artifact changes, create a new filename and update its manifest metadata and SHA-256 checksum.

## Tech stack

- JavaScript and JSX
- React 19
- React DOM 19
- Vite 6
- React Router 6
- Zustand 5
- Tailwind CSS 3
- Lucide React
- Recharts
- PropTypes
- Vitest
- React Testing Library
- Playwright
- axe-core
- ESLint 9

## Architecture

The application uses a static, layered frontend architecture:

```text
Browser UI
  ├─ React pages and reusable components
  ├─ React Router route guards
  ├─ Capability and ownership permission service
  ├─ Feature facades and deterministic services
  ├─ Revision-safe repositories and Zustand stores
  ├─ Versioned browser-local storage gateway
  └─ Bundled fictional fixtures and same-origin static PDFs
```

There is no server-side runtime.

### Main architectural responsibilities

- **Pages and components** render role-aware workflows and accessible state.
- **Router guards** enforce route capability and role checks before protected content renders.
- **Permission services** centralize role, ownership, and restriction decisions.
- **Facades** expose permission-checked application operations.
- **Feature services** implement deterministic requests, pipelines, batches, reviews, exports, and simulations.
- **Repositories** normalize state and enforce revision-safe mutations.
- **Storage gateway** owns direct browser storage access, checksums, commit markers, and invalidation events.
- **Fixtures** provide immutable fictional baseline data and representative artifacts.
- **Validation modules** check fixture integrity, snapshots, schemas, calculations, and cross-record references.

## Folder structure

```text
.
├── e2e/
│   ├── governance-insights.spec.js
│   ├── journey.spec.js
│   ├── network-accessibility.spec.js
│   └── operations.spec.js
├── public/
│   ├── documents/
│   │   ├── EOB_CL2024001_123456789_20240120_v1.pdf
│   │   ├── EOR_CL2024001_123456789_20240122_v1.pdf
│   │   └── EOR_REMITTANCE_DEMO_20240122_v1.pdf
│   └── favicon.svg
├── src/
│   ├── features/
│   │   ├── auth/
│   │   ├── discovery/
│   │   ├── governance/
│   │   ├── home/
│   │   ├── insights/
│   │   └── operations/
│   ├── fixtures/
│   │   ├── accounts.js
│   │   ├── documents.js
│   │   ├── fixtureManifest.js
│   │   ├── insights.js
│   │   ├── membersClaims.js
│   │   ├── operations.js
│   │   └── seedBundle.js
│   ├── platform/
│   │   ├── components/
│   │   ├── config/
│   │   ├── contracts/
│   │   ├── hooks/
│   │   ├── persistence/
│   │   ├── repositories/
│   │   ├── security/
│   │   ├── services/
│   │   ├── stores/
│   │   ├── time/
│   │   ├── utils/
│   │   └── validation/
│   ├── test/
│   │   └── setup.js
│   ├── App.jsx
│   ├── index.css
│   ├── main.jsx
│   └── router.jsx
├── DEPLOYMENT.md
├── eslint.config.js
├── playwright.config.js
├── tailwind.config.js
├── vercel.json
├── vite.config.js
└── vitest.config.js
```

## Browser-local persistence

The primary storage namespace is:

```text
eob-eor-demo.v1
```

The committed root key is:

```text
eob-eor-demo.v1.root
```

Persisted data uses:

- Platform schema versions
- Operations schema versions
- Root revisions
- Checksums
- Commit markers
- Optimistic concurrency checks
- Cross-tab invalidation
- Platform and operations migrations

The application refuses:

- Invalid JSON
- Invalid persistence envelopes
- Checksum mismatches
- Unsupported future schemas
- Unsafe snapshot data
- Invalid cross-record references
- Stale optimistic revisions

The application does not call `localStorage.clear()` and does not remove unrelated browser namespaces.

## Storage recovery

The platform supports three recovery modes:

| Mode | Behavior |
| --- | --- |
| `NONE` | Validated persistence is available |
| `VOLATILE` | Changes continue in memory and may be lost when the page closes |
| `READ_ONLY` | Unsafe persisted data was detected and protected mutations are disabled |

If browser storage is unavailable at startup, the application creates a temporary in-memory gateway for the current page session.

### Quota or persistence recovery

If storage reaches quota or becomes unavailable:

1. Avoid repeatedly invoking destructive actions.
2. Export an authorized JSON snapshot if possible.
3. Preserve the downloaded snapshot locally.
4. Remove unnecessary fictional browser-local data if appropriate.
5. Retry persistence only through an explicit user action.
6. Use the Administrator sample-restore workflow if recovery is not possible.
7. Confirm unrelated origin storage was not cleared.

### Snapshot controls

Authorized users can export browser-local JSON snapshots. Administrator-only controls validate and replace governed data.

Snapshot validation:

- Runs locally
- Enforces a maximum size
- Requires safe JSON-compatible data
- Validates supported format and schema versions
- Validates checksums
- Rejects dangerous property names
- Validates operations references
- Does not mutate local data before explicit replacement

Required confirmations:

```text
REPLACE LOCAL DEMO DATA
```

```text
RESTORE SAMPLE DATA
```

Snapshot files can contain fictional member, claim, document, operations, audit, preference, and insight records. Treat exported snapshots as sensitive demonstration artifacts and do not upload them to support tools, analytics systems, issue trackers, or external storage as part of normal operation.

## Accessibility

The application includes:

- Semantic heading structure
- Explicit form labels and validation feedback
- Keyboard-operable controls
- Focus-managed confirmation dialogs
- Focus-managed session-expiry warnings
- Skip-to-content navigation
- Text and icon status indicators
- Live regions for asynchronous status changes
- Reduced-motion support
- Responsive layouts from 320 pixels through desktop widths
- Light, dark, and monitoring near-black presentation states
- Print rules that remove navigation and dialog chrome

Playwright runs axe smoke checks for serious and critical WCAG violations on core routes.

## Network isolation and privacy verification

The browser test suite blocks and detects:

- `fetch`
- `XMLHttpRequest`
- `WebSocket`
- `EventSource`
- `navigator.sendBeacon`
- Upload requests

Permitted runtime requests are limited to same-origin static `GET` or `HEAD` resources such as JavaScript, CSS, images, fonts, and representative PDFs.

Production builds disable privacy-safe diagnostic logging. The application does not emit raw errors, credentials, member identifiers, claim identifiers, payment references, or session values to a remote service.

## Deployment

The application deploys as static files only:

- `index.html`
- Content-hashed assets under `dist/assets/`
- Representative PDFs under `dist/documents/`
- Client-side routes handled by React Router
- A Vercel rewrite for extensionless SPA paths

It does not require:

- API routes
- Serverless functions
- Edge functions
- Middleware
- A database
- Runtime secrets
- Runtime environment variables

### Vercel

Vercel platform link:

https://vercel.com/

Create a Vercel project:

https://vercel.com/new

Recommended project settings:

| Setting | Value |
| --- | --- |
| Framework preset | Vite |
| Install command | `npm ci` |
| Build command | `npm run build` |
| Output directory | `dist` |
| Development command | `npm run dev` |

The repository includes `vercel.json` with an extension-safe SPA rewrite. Requests containing file extensions are not rewritten, preserving direct JavaScript, CSS, image, and PDF delivery.

A public production deployment URL is not defined in this repository. Use the deployment URL generated for the configured Vercel project.

For complete deployment, caching, rollback, migration, zero-function, and smoke-test guidance, see [DEPLOYMENT.md](./DEPLOYMENT.md).

## Operational verification

After deployment, verify at minimum:

1. `/signin` loads directly.
2. A nested extensionless route refreshes successfully.
3. Each representative PDF opens directly.
4. JavaScript and CSS assets return their expected media types.
5. No Vercel Functions or Edge Functions are generated.
6. No external requests occur.
7. No protected identifiers or credentials appear in the browser console.
8. Member ownership denial remains non-disclosing.
9. Static downloads retain versioned filenames.
10. Serious and critical accessibility checks remain clear.

## Additional documentation

- [Deployment and Operations Guide](./DEPLOYMENT.md)
- [Changelog](./CHANGELOG.md)
- [.env.example](./.env.example)

## License

Private and proprietary.

Copyright © 2026. All rights reserved.

This source code, its fictional fixtures, representative documents, designs, workflows, and documentation are confidential proprietary materials. No permission is granted to use, copy, modify, distribute, publish, sublicense, or create derivative works except under an explicit written agreement with the project owner.