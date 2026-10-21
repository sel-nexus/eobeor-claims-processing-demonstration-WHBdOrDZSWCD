# Deployment and Operations Guide

The Claims Explanation Simulator is a static Vite and React single-page application. It has no application server, API routes, serverless functions, edge functions, middleware, or live integrations. All application workflows use bundled fictional fixtures, same-origin static assets, and browser-local state.

## Deployment model

The production deployment consists of:

- `index.html`
- Vite-generated, content-hashed files under `dist/assets/`
- Representative static PDF files under `dist/documents/`
- Client-side routing handled by React Router
- A Vercel rewrite that returns `index.html` for extensionless SPA routes

The application does not require:

- A database
- An API server
- Serverless or edge functions
- Secrets
- Runtime environment variables
- Authentication, payer, provider, healthcare, payment, monitoring, reporting, queue, fax, email, CRM, or identity integrations

The browser must support modern JavaScript, Web Crypto, Blob URLs, and browser storage. If browser storage is unavailable, the application uses a volatile in-memory fallback for the current page session.

## Prerequisites

Use a supported Node.js release compatible with Vite 6. A current Node.js LTS release is recommended.

Install dependencies from the repository root:

```bash
npm ci
```

If no lockfile is available in a local checkout, use:

```bash
npm install
```

CI and production deployments should use `npm ci` whenever a committed lockfile is present.

## Environment labels

The application accepts three optional, non-secret Vite build labels:

```text
VITE_APP_VERSION
VITE_REFERENCE_DATE
VITE_FIXTURE_VERSION
```

Copy `.env.example` only for local development when custom labels are needed:

```bash
cp .env.example .env
```

Example:

```text
VITE_APP_VERSION=1.0.0
VITE_REFERENCE_DATE=2024-01-22
VITE_FIXTURE_VERSION=1
```

These values are embedded into the client bundle at build time. They are public metadata and must not contain credentials, tokens, member data, claim data, connection strings, or other secrets.

When omitted, the application uses these defaults:

| Variable | Default |
| --- | --- |
| `VITE_APP_VERSION` | `1.0.0` |
| `VITE_REFERENCE_DATE` | `2024-01-22` |
| `VITE_FIXTURE_VERSION` | `1` |

Changing `VITE_REFERENCE_DATE` can affect deterministic validation behavior. Changing `VITE_FIXTURE_VERSION` changes displayed provenance only; it does not automatically transform fixture records.

## Local validation commands

### Development server

```bash
npm run dev
```

Vite prints the local development URL.

### Production build

```bash
npm run build
```

The production output is written to `dist/`. Production source maps are disabled.

### Production preview

```bash
npm run preview
```

For the same host and port used by Playwright:

```bash
npm run preview -- --host 127.0.0.1 --port 4173
```

### Lint

```bash
npm run lint
```

Lint rules prohibit direct application use of network primitives and direct `localStorage` access outside the storage gateway.

### Unit and component tests

```bash
npm run test
```

Or:

```bash
npm run test:unit
```

### Browser acceptance tests

```bash
npm run test:browser
```

Playwright builds the application and starts the Vite preview server configured in `playwright.config.js`.

The browser suite covers:

- Seeded persona journeys
- Role and ownership denial
- Operations workflows
- Governance and insights workflows
- Static downloads
- Network isolation
- Console privacy
- Accessibility smoke checks
- Responsive layouts at supported widths
- An offline Chromium project

### Complete quality gate

```bash
npm run check
```

This executes:

1. ESLint
2. Unit and component tests
3. Production build
4. Playwright browser tests

A deployment candidate should not be promoted unless `npm run check` succeeds.

## Vercel deployment

### Project settings

Import the repository into Vercel and configure:

| Setting | Value |
| --- | --- |
| Framework preset | Vite |
| Install command | `npm ci` |
| Build command | `npm run build` |
| Output directory | `dist` |
| Development command | `npm run dev` |

If Vercel detects Vite automatically, the generated defaults should match these values.

Add any optional build labels in the Vercel project environment settings. Apply the same labels to Production, Preview, and Development only when consistent fixture provenance is desired across those environments.

Do not add secrets. This application has no legitimate runtime use for API keys, service credentials, database credentials, healthcare credentials, or identity-provider secrets.

### CLI deployment

With the Vercel CLI installed outside this project, a preview deployment can be created with:

```bash
vercel
```

A production deployment can be promoted with:

```bash
vercel --prod
```

The Vercel CLI is not a project dependency and is not required by the application build.

## SPA rewrite behavior

The repository includes this Vercel rewrite:

```json
{
  "rewrites": [
    {
      "source": "/((?!.*\\.).*)",
      "destination": "/index.html"
    }
  ]
}
```

The rewrite sends extensionless requests to the SPA entry point. This allows direct navigation and browser refreshes for routes such as:

```text
/signin
/claims
/claims/CL2024001
/documents/DOC-EOB-CL2024001-V1
/operations/queue
/admin/settings
```

Requests containing a file extension are not rewritten. This preserves direct static asset delivery for paths such as:

```text
/assets/index-<hash>.js
/documents/EOB_CL2024001_123456789_20240120_v1.pdf
/favicon.svg
```

Keep this distinction when changing `vercel.json`. A catch-all rewrite that also captures static files can cause JavaScript, CSS, PDF, or image requests to receive `index.html` instead of the requested asset.

Unknown extensionless routes are handled by the application’s non-disclosing not-found page.

## Static artifact caching

Vite emits JavaScript and CSS assets with content hashes:

```text
assets/[name]-[hash].js
assets/[name]-[hash][extname]
```

These files are safe candidates for long-lived immutable caching because their URLs change when their contents change.

Representative PDFs use explicit dates and version suffixes, for example:

```text
EOB_CL2024001_123456789_20240120_v1.pdf
EOR_CL2024001_123456789_20240122_v1.pdf
EOR_REMITTANCE_DEMO_20240122_v1.pdf
```

Treat a published versioned artifact as immutable. If its contents change:

1. Create a new versioned filename.
2. Update the artifact manifest.
3. Update the SHA-256 checksum.
4. Update document metadata that references the artifact.
5. Run the fixture-integrity tests and full quality gate.
6. Retain the prior artifact when older retained document versions still reference it.

Do not replace PDF contents in place while retaining the same filename and checksum metadata.

The current `vercel.json` configures only SPA rewrites. It does not define custom cache headers. If custom headers are introduced, use this policy:

- `index.html`: revalidate frequently so new deployments become visible.
- Content-hashed files under `/assets/`: long-lived immutable caching.
- Versioned files under `/documents/`: long-lived caching only when artifact filenames are never reused.
- Non-versioned metadata: short-lived caching or revalidation.

Validate header changes against preview deployments before production promotion.

## Static artifact verification

After building, verify that the expected PDFs are present:

```bash
test -f dist/documents/EOB_CL2024001_123456789_20240120_v1.pdf
test -f dist/documents/EOR_CL2024001_123456789_20240122_v1.pdf
test -f dist/documents/EOR_REMITTANCE_DEMO_20240122_v1.pdf
```

Verify that the build does not contain source maps:

```bash
if find dist -type f -name '*.map' | grep -q .; then
  echo "Unexpected production source maps found"
  exit 1
fi
```

The fixture manifest contains expected SHA-256 values. Any artifact change must update the corresponding manifest checksum and pass:

```bash
npm run test:unit
```

## Zero-function verification

This project is intended to deploy as static files only. Verify that no Vercel Function or Edge Function is created.

### Repository checks

The repository should not contain deployment handlers in conventional function locations such as:

```text
api/
functions/
server/
```

It should not contain framework server routes, middleware, or server-only entry points.

A simple source check can be included in CI:

```bash
for directory in api functions server; do
  if [ -d "$directory" ]; then
    echo "Unexpected server directory: $directory"
    exit 1
  fi
done
```

### Build-output checks

After `npm run build`, the output should contain only static files:

```bash
find dist -type f -print | sort
```

There should be no function bundle, server manifest, server entry point, or executable backend artifact.

### Vercel deployment checks

After deployment:

1. Open the deployment in the Vercel dashboard.
2. Review the deployment build output.
3. Confirm that no Functions or Edge Functions are listed.
4. Confirm that only static assets and rewrites are present.
5. Open an extensionless application route directly.
6. Open each representative PDF directly.
7. Confirm that static asset requests return the expected media types.

The following are deployment failures:

- A generated Vercel Function
- An Edge Function or middleware bundle
- An API route
- A deployment-time requirement for secrets
- A runtime call to an external service
- A PDF request returning HTML
- A JavaScript or CSS asset request returning HTML

## Network-isolation verification

The application intentionally does not use:

- `fetch`
- `XMLHttpRequest`
- `WebSocket`
- `EventSource`
- `navigator.sendBeacon`
- Upload network primitives

Run the browser isolation suite before promotion:

```bash
npm run test:browser
```

For a manual production check:

1. Open browser developer tools.
2. Clear the Network panel.
3. Navigate through sign-in, claims, documents, operations, governance, and monitoring routes.
4. Trigger local exports and representative downloads.
5. Confirm that requests are limited to same-origin static `GET` or `HEAD` resources.
6. Confirm that no API, analytics, identity, monitoring, storage, payer, provider, or healthcare endpoint is contacted.

Static module, stylesheet, font, image, and PDF requests are expected. Application API requests are not.

## CI/CD quality gates

A recommended pipeline uses these stages.

### 1. Install

```bash
npm ci
```

### 2. Static checks

```bash
npm run lint
```

This protects important boundaries, including:

- No direct application network primitives
- No direct browser storage access outside the gateway
- No invalid UI-to-infrastructure imports

### 3. Unit and component tests

```bash
npm run test:unit
```

Tests run with deterministic time, deterministic crypto, browser API mocks, and fail-fast network guards.

### 4. Production build

```bash
npm run build
```

### 5. Build inspection

```bash
test -f dist/index.html
test -d dist/assets
test -d dist/documents

if find dist -type f -name '*.map' | grep -q .; then
  echo "Unexpected source maps found"
  exit 1
fi
```

### 6. Browser acceptance tests

```bash
npm run test:browser
```

### 7. Preview deployment smoke test

On the Vercel preview URL, verify:

- `/signin` loads directly.
- A nested extensionless route returns the SPA.
- Static PDFs download successfully.
- No functions are generated.
- No external network requests occur.
- No protected identifiers or credentials appear in the browser console.
- Serious and critical accessibility checks remain clear.

### 8. Production promotion

Promote the exact preview deployment that passed the quality gates. Avoid rebuilding with different environment labels during promotion.

## Rollback

Vercel deployments are immutable. Roll back by promoting a previously verified deployment in the Vercel dashboard or by redeploying a known-good commit.

Before rollback, consider browser-local schema compatibility.

The platform persistence schema is currently:

```text
1.0.0
```

The operations persistence schema is currently:

```text
1
```

The application refuses unsupported future schema versions. This prevents an older deployment from overwriting browser-local data created by a newer deployment.

A rollback can therefore produce a read-only recovery state if the older client encounters newer browser-local data. Before deploying a release that changes a persistence schema:

1. Export an authorized JSON snapshot from the newer release.
2. Document the forward and backward compatibility policy.
3. Add and test all required migrations.
4. Test rollback behavior against data written by the newer release.
5. Confirm that an older release fails safely instead of overwriting newer data.

Do not solve rollback incompatibility by clearing all browser storage automatically.

If rollback users encounter incompatible browser-local state, use an authorized Administrator workflow to export evidence and restore canonical sample data after reviewing the destructive confirmation.

## Browser-local storage and migration behavior

The primary storage namespace is:

```text
eob-eor-demo.v1
```

The committed root key is:

```text
eob-eor-demo.v1.root
```

Persisted state uses:

- Schema versions
- Root revisions
- Checksums
- Commit markers
- Optimistic concurrency checks
- Cross-tab invalidation
- Platform and operations migrations

Current-version persisted state is normalized during hydration. Supported older state is migrated without mutating the source object before commit.

The application refuses:

- Invalid JSON
- Invalid envelopes
- Checksum mismatches
- Unsupported future schemas
- Unsafe snapshot data
- Invalid cross-record references
- Stale optimistic revisions

Storage recovery modes include:

- `NONE`: validated persistence is available.
- `VOLATILE`: changes continue in memory but may be lost when the page closes.
- `READ_ONLY`: unsafe persisted state was detected and protected mutations are disabled.

Browser storage is best-effort, user-editable, and is not secure or durable server storage.

## Snapshot operations

Authorized roles can export browser-local JSON snapshots. Administrator-only controls validate, apply, and restore governed data.

Snapshot validation:

- Runs locally
- Enforces a maximum file size
- Requires safe JSON-compatible data
- Validates supported schema and format versions
- Validates checksums
- Rejects dangerous property names
- Validates operations references
- Does not mutate data before explicit replacement

Snapshot replacement requires the exact confirmation:

```text
REPLACE LOCAL DEMO DATA
```

Canonical sample restore requires:

```text
RESTORE SAMPLE DATA
```

Snapshot files can contain fictional member, claim, document, operations, audit, preference, and insight records. Treat exported files as sensitive demonstration artifacts even though they contain no real healthcare data.

Do not upload snapshots to support tools, analytics services, issue trackers, or external storage as part of normal operation.

## Disaster and quota recovery

This application does not provide production backup or disaster recovery.

If browser storage reaches quota or becomes unavailable:

1. Do not repeatedly invoke destructive actions.
2. Export an authorized snapshot if the application still permits it.
3. Preserve the downloaded snapshot locally.
4. Remove unnecessary fictional browser-local data if appropriate.
5. Retry persistence only through an explicit user action.
6. If recovery is not possible, use the Administrator sample-restore workflow.
7. Confirm that unrelated browser namespaces are not cleared.

Never add code that automatically calls `localStorage.clear()` or removes unrelated origin data.

## Operational smoke test

After a production deployment, perform at least the following checks.

### Public entry

- Open `/signin`.
- Confirm the heading `Claims Explanation Simulator`.
- Confirm the printed demo password and MFA guidance.
- Confirm the no-transmission disclosure.

### Member journey

- Sign in as `john.doe`.
- Open `/claims`.
- Search for `CL2024001`.
- Open the EOB and EOR previews.
- Confirm `This is not a bill.`
- Download the representative static sample.
- Confirm the downloaded filename is versioned.

### Ownership denial

- Sign in as `jane.smith`.
- Navigate directly to `/claims/CL2024001`.
- Confirm `Access unavailable`.
- Confirm no protected record details are displayed.

### Internal role journeys

- CSR: open `/csr` and `/assistant`.
- BOS: open `/operations/queue`, `/operations/inbound`, and `/operations/batch`.
- ITS: open `/monitoring` and `/integrations`.
- Administrator: open `/admin/users`, `/admin/settings`, `/admin/snapshots`, and `/audit`.

### Static assets and routing

- Refresh a nested SPA route.
- Open each PDF directly.
- Confirm JavaScript and CSS assets return their expected content types.
- Confirm no extension-bearing asset request is rewritten to `index.html`.

### Privacy and isolation

- Confirm no external requests.
- Confirm no console errors.
- Confirm demo credentials and fictional protected identifiers are absent from console output.
- Confirm exports and downloads remain local.

## Monitoring and observability limitations

The monitoring dashboard is a deterministic fixture. Its refresh behavior advances browser-local state and does not read infrastructure telemetry.

Do not connect production analytics, session replay, error collection, monitoring, or logging services without a separate privacy and security review. Such integrations would change the project’s stated network-isolation and privacy characteristics.

Production builds disable privacy-safe diagnostic logging. The application does not emit raw errors, member identifiers, claim identifiers, payment references, credentials, or session values to a remote service.

## Privacy and security notes

- All included people, claims, providers, payments, documents, metrics, and operations are fictional.
- Static PDFs are representative samples and are not authoritative claim documents.
- Demo authentication, MFA, sessions, roles, and permissions are client-side simulations.
- Browser developer tools can alter browser-local state and role checks.
- No HIPAA, SOC 2 Type II, PCI DSS, or other certification is claimed.
- No real healthcare, identity, financial, or payment data should be entered.
- No secrets should be configured through `VITE_*` variables.
- No data should be transmitted to external services.
- Browser-local audit records are mutable demonstration evidence, not legal or security audit records.
- Snapshot controls are not encrypted backup, immutable retention, or disaster recovery.
- Fax, email, CRM, reporting, queue, IXIT, and delivery states are local metadata only.
- Static artifact filenames contain fictional identifiers and should still be handled according to the demonstration’s privacy expectations.

Any deployment change that introduces a backend, external request, telemetry service, upload, runtime secret, live identity provider, database, queue, or healthcare integration requires a new architecture, threat model, privacy review, test strategy, and deployment guide.