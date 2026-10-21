import { expect, test } from '@playwright/test';
import axe from 'axe-core';

const DEMO_PASSWORD = 'demo';
const DEMO_MFA_CODE = '000000';

const JOHN_PERSONA = Object.freeze({
  username: 'john.doe',
  homeHeading: 'Your claims and documents',
});

const FORBIDDEN_CONSOLE_VALUES = Object.freeze([
  DEMO_MFA_CODE,
  '123456789',
  '987654321',
  'PAY-DEMO-0001',
  'PAY-DEMO-0002',
  'John Doe',
  'Jane Smith',
  'CL2024001',
  'CL2024002',
]);

const RESPONSIVE_ROUTES = Object.freeze([
  Object.freeze({
    path: '/',
    heading: 'Your claims and documents',
  }),
  Object.freeze({
    path: '/claims',
    heading: 'Search members and claims',
  }),
  Object.freeze({
    path: '/claims/CL2024001',
    heading: 'CL2024001',
  }),
  Object.freeze({
    path: '/documents/DOC-EOB-CL2024001-V1',
    heading: 'Explanation of Benefits',
  }),
]);

const RESPONSIVE_VIEWPORTS = Object.freeze([
  Object.freeze({
    name: 'phone-320',
    width: 320,
    height: 568,
  }),
  Object.freeze({
    name: 'phone-375',
    width: 375,
    height: 667,
  }),
  Object.freeze({
    name: 'tablet-768',
    width: 768,
    height: 1024,
  }),
  Object.freeze({
    name: 'desktop-1440',
    width: 1440,
    height: 900,
  }),
]);

function isPermittedStaticRequest(request) {
  const url = new URL(request.url());
  const applicationOrigin = new URL(
    'http://127.0.0.1:4173',
  ).origin;
  const method = request.method().toUpperCase();
  const resourceType = request.resourceType();

  return (
    url.origin === applicationOrigin &&
    ['GET', 'HEAD'].includes(method) &&
    ![
      'eventsource',
      'fetch',
      'ping',
      'websocket',
      'xhr',
    ].includes(resourceType)
  );
}

async function installNetworkIsolation(context, page) {
  const state = {
    consoleMessages: [],
    consoleErrors: [],
    pageErrors: [],
    staticRequests: [],
    networkViolations: [],
    webSockets: [],
  };

  await context.setOffline(false);

  await context.route('**/*', async (route) => {
    const request = route.request();

    if (isPermittedStaticRequest(request)) {
      state.staticRequests.push({
        method: request.method(),
        resourceType: request.resourceType(),
        url: request.url(),
      });
      await route.continue();
      return;
    }

    state.networkViolations.push({
      method: request.method(),
      resourceType: request.resourceType(),
      url: request.url(),
    });
    await route.abort('blockedbyclient');
  });

  page.on('console', (message) => {
    const entry = {
      type: message.type(),
      text: message.text(),
    };

    state.consoleMessages.push(entry);

    if (message.type() === 'error') {
      state.consoleErrors.push(entry);
    }
  });

  page.on('pageerror', (error) => {
    state.pageErrors.push(error.message);
  });

  page.on('websocket', (socket) => {
    state.webSockets.push(socket.url());
  });

  await page.addInitScript(() => {
    const attempts = [];

    Object.defineProperty(
      globalThis,
      '__networkIsolationAttempts',
      {
        configurable: true,
        get() {
          return attempts.slice();
        },
      },
    );

    const block = (kind) => {
      attempts.push(kind);
      throw new Error(
        `${kind} is disabled in this browser-local demonstration.`,
      );
    };

    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value(_input, init = {}) {
        const upload =
          typeof globalThis.FormData === 'function' &&
          init?.body instanceof globalThis.FormData;

        return block(upload ? 'UPLOAD' : 'FETCH');
      },
    });

    Object.defineProperty(globalThis, 'XMLHttpRequest', {
      configurable: true,
      writable: true,
      value: function BlockedXMLHttpRequest() {
        return block('XHR');
      },
    });

    Object.defineProperty(globalThis, 'WebSocket', {
      configurable: true,
      writable: true,
      value: function BlockedWebSocket() {
        return block('WEBSOCKET');
      },
    });

    Object.defineProperty(globalThis, 'EventSource', {
      configurable: true,
      writable: true,
      value: function BlockedEventSource() {
        return block('EVENTSOURCE');
      },
    });

    if (
      globalThis.navigator !== undefined &&
      globalThis.navigator !== null
    ) {
      Object.defineProperty(
        globalThis.navigator,
        'sendBeacon',
        {
          configurable: true,
          writable: true,
          value() {
            return block('BEACON');
          },
        },
      );
    }
  });

  return state;
}

async function signIn(page, persona = JOHN_PERSONA) {
  await page.goto('/signin');

  await expect(
    page.getByRole('heading', {
      name: 'EOB/EOR Claims Processing',
    }),
  ).toBeVisible();

  await page
    .getByLabel('Demo account')
    .selectOption(persona.username);
  await page.getByLabel('Password').fill(DEMO_PASSWORD);
  await page
    .getByRole('button', { name: 'Continue' })
    .click();

  await expect(
    page.getByRole('heading', {
      name: 'Verification code',
    }),
  ).toBeVisible();

  await page
    .getByLabel('MFA verification code')
    .fill(DEMO_MFA_CODE);
  await page
    .getByRole('button', { name: 'Sign in' })
    .click();

  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole('heading', {
      name: persona.homeHeading,
    }),
  ).toBeVisible();
}

async function runAxeSmokeCheck(page, routeLabel) {
  await page.addScriptTag({
    content: axe.source,
  });

  const violations = await page.evaluate(async () => {
    const result = await globalThis.axe.run(
      globalThis.document,
      {
        runOnly: {
          type: 'tag',
          values: [
            'wcag2a',
            'wcag2aa',
            'wcag21a',
            'wcag21aa',
          ],
        },
      },
    );

    return result.violations
      .filter((violation) =>
        ['critical', 'serious'].includes(
          violation.impact,
        ),
      )
      .map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        description: violation.description,
        targets: violation.nodes.flatMap((node) =>
          node.target.map((target) => String(target)),
        ),
      }));
  });

  expect(
    violations,
    `${routeLabel} has serious or critical axe violations:\n${JSON.stringify(
      violations,
      null,
      2,
    )}`,
  ).toEqual([]);
}

async function expectNoHorizontalOverflow(
  page,
  viewportName,
  routePath,
) {
  const dimensions = await page.evaluate(() => ({
    bodyClientWidth: globalThis.document.body.clientWidth,
    bodyScrollWidth: globalThis.document.body.scrollWidth,
    rootClientWidth:
      globalThis.document.documentElement.clientWidth,
    rootScrollWidth:
      globalThis.document.documentElement.scrollWidth,
  }));

  expect(
    dimensions.bodyScrollWidth,
    `${viewportName} ${routePath} body overflowed horizontally`,
  ).toBeLessThanOrEqual(dimensions.bodyClientWidth + 1);
  expect(
    dimensions.rootScrollWidth,
    `${viewportName} ${routePath} document overflowed horizontally`,
  ).toBeLessThanOrEqual(dimensions.rootClientWidth + 1);
}

function expectConsolePrivacy(state) {
  const consoleText = state.consoleMessages
    .map((message) => message.text)
    .join('\n');

  FORBIDDEN_CONSOLE_VALUES.forEach((value) => {
    expect(consoleText).not.toContain(value);
  });

  expect(state.consoleErrors).toEqual([]);
  expect(state.pageErrors).toEqual([]);
}

function expectNetworkIsolation(state) {
  expect(state.networkViolations).toEqual([]);
  expect(state.webSockets).toEqual([]);
  expect(state.staticRequests.length).toBeGreaterThan(0);
}

test.describe('Network isolation, privacy, accessibility, and responsive acceptance', () => {
  test('blocks fetch, XHR, WebSocket, beacon, EventSource, and upload primitives', async ({
    context,
    page,
  }) => {
    const state = await installNetworkIsolation(context, page);

    await page.goto('/signin');

    const result = await page.evaluate(async () => {
      const outcomes = {};

      const capture = async (name, operation) => {
        try {
          await operation();
          outcomes[name] = 'allowed';
        } catch (error) {
          outcomes[name] =
            error instanceof Error
              ? error.message
              : String(error);
        }
      };

      await capture('fetch', () =>
        globalThis.fetch('/api/claims'),
      );
      await capture('xhr', () => {
        const request = new globalThis.XMLHttpRequest();

        request.open('GET', '/api/claims');
        request.send();
      });
      await capture('websocket', () => {
        new globalThis.WebSocket(
          'ws://127.0.0.1:4173/live',
        );
      });
      await capture('beacon', () =>
        globalThis.navigator.sendBeacon(
          '/api/audit',
          'fixture',
        ),
      );
      await capture('eventsource', () => {
        new globalThis.EventSource('/api/events');
      });
      await capture('upload', () => {
        const body = new globalThis.FormData();

        body.append(
          'file',
          new globalThis.Blob(['fictional']),
          'fictional.txt',
        );

        return globalThis.fetch('/api/upload', {
          method: 'POST',
          body,
        });
      });

      return {
        outcomes,
        attempts:
          globalThis.__networkIsolationAttempts,
      };
    });

    expect(result.attempts).toEqual([
      'FETCH',
      'XHR',
      'WEBSOCKET',
      'BEACON',
      'EVENTSOURCE',
      'UPLOAD',
    ]);

    Object.entries(result.outcomes).forEach(
      ([primitive, message]) => {
        expect(
          message,
          `${primitive} unexpectedly remained available`,
        ).toContain(
          'is disabled in this browser-local demonstration.',
        );
      },
    );

    expectConsolePrivacy(state);
    expectNetworkIsolation(state);
  });

  test('keeps sign-in, claim, and document paths private and free of serious axe violations', async ({
    context,
    page,
  }) => {
    const state = await installNetworkIsolation(context, page);

    await page.goto('/signin');
    await expect(
      page.getByRole('heading', {
        name: 'EOB/EOR Claims Processing',
      }),
    ).toBeVisible();
    await runAxeSmokeCheck(page, 'Sign-in route');

    await signIn(page);
    await runAxeSmokeCheck(page, 'Member home route');

    await page.goto('/claims/CL2024001');
    await expect(
      page.getByRole('heading', {
        name: 'CL2024001',
      }),
    ).toBeVisible();
    await runAxeSmokeCheck(page, 'Claim detail route');

    await page.goto(
      '/documents/DOC-EOB-CL2024001-V1',
    );
    await expect(
      page
        .getByRole('heading', {
          name: 'Explanation of Benefits',
        })
        .first(),
    ).toBeVisible();
    await expect(
      page.getByText(
        'Representative demo document generated from a static sample; not an authoritative claim document.',
        { exact: true },
      ),
    ).toBeVisible();
    await runAxeSmokeCheck(
      page,
      'Representative document route',
    );

    const downloadPromise = page.waitForEvent('download');

    await page
      .getByRole('button', {
        name: 'Download static sample',
      })
      .click();

    const dialog = page.getByRole('alertdialog');

    await expect(dialog).toBeVisible();
    await dialog
      .getByRole('button', {
        name: 'Download static sample',
      })
      .click();

    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(
      /^EOB_CL2024001_123456789_\d{8}_v1\.pdf$/,
    );

    expectConsolePrivacy(state);
    expectNetworkIsolation(state);
  });

  test('renders core member paths without horizontal overflow at 320, 375, 768, and 1440 pixels', async ({
    context,
    page,
  }) => {
    const state = await installNetworkIsolation(context, page);

    await signIn(page);

    for (const viewport of RESPONSIVE_VIEWPORTS) {
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });

      for (const route of RESPONSIVE_ROUTES) {
        await page.goto(route.path);

        await expect(
          page
            .getByRole('heading', {
              name: route.heading,
              exact: true,
            })
            .first(),
        ).toBeVisible();

        await expectNoHorizontalOverflow(
          page,
          viewport.name,
          route.path,
        );
      }
    }

    expectConsolePrivacy(state);
    expectNetworkIsolation(state);
  });
});