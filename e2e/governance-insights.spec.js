import { expect, test } from '@playwright/test';

const DEMO_PASSWORD = 'demo';
const DEMO_MFA_CODE = '000000';

const PERSONAS = Object.freeze({
  ADMIN: Object.freeze({
    username: 'administrator',
    homeHeading: 'Administration workspace',
  }),
  BOS: Object.freeze({
    username: 'bos',
    homeHeading: 'Operations workspace',
  }),
  CSR: Object.freeze({
    username: 'csr',
    homeHeading: 'Member support workspace',
  }),
  ITS: Object.freeze({
    username: 'its',
    homeHeading: 'Platform support workspace',
  }),
});

async function signIn(page, persona) {
  await page.goto('/signin');

  await expect(
    page.getByRole('heading', {
      name: 'Claims Explanation Simulator',
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

test.describe('Governance and insights acceptance journeys', () => {
  test.beforeEach(async ({ context }) => {
    await context.setOffline(false);
  });

  test('administrator creates, updates, and removes a fictional local user', async ({
    page,
  }) => {
    await signIn(page, PERSONAS.ADMIN);
    await page.goto('/admin/users');

    await expect(
      page.getByRole('heading', {
        name: 'User and rule administration',
      }),
    ).toBeVisible();

    const createButton = page.getByRole('button', {
      name: 'Create fictional user',
    });

    await expect(createButton).toBeEnabled();
    await createButton.click();

    await page
      .getByLabel('Username')
      .fill('governance.test');
    await page
      .getByLabel('Display name')
      .fill('Governance Test User');
    await page
      .getByLabel('Demo role')
      .selectOption('BOS');

    await page
      .getByRole('button', {
        name: 'Create user',
      })
      .click();

    await expect(
      page.getByText(
        'Fictional user governance.test was created locally.',
        { exact: true },
      ),
    ).toBeVisible();

    let userCard = page.locator('article').filter({
      hasText: 'governance.test',
    });

    await expect(userCard).toHaveCount(1);
    await expect(
      userCard.getByText('Governance Test User', {
        exact: true,
      }),
    ).toBeVisible();

    await userCard
      .getByRole('button', {
        name: 'Edit user',
      })
      .click();

    await page
      .getByLabel('Display name')
      .fill('Governance Test Lead');
    await page
      .getByLabel('Demo role')
      .selectOption('ADMIN');
    await page
      .getByRole('button', {
        name: 'Save user',
      })
      .click();

    await expect(
      page.getByText(
        'Fictional user governance.test was updated locally.',
        { exact: true },
      ),
    ).toBeVisible();

    userCard = page.locator('article').filter({
      hasText: 'governance.test',
    });

    await expect(
      userCard.getByText('Governance Test Lead', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      userCard.getByText('Admin', {
        exact: true,
      }),
    ).toBeVisible();

    await userCard
      .getByRole('button', {
        name: 'Remove user',
      })
      .click();

    const removeDialog = page.getByRole('alertdialog');

    await expect(removeDialog).toBeVisible();
    await removeDialog
      .getByLabel(
        'Type the confirmation text to continue',
      )
      .fill('REMOVE governance.test');
    await removeDialog
      .getByRole('button', {
        name: 'Remove fictional user',
      })
      .click();

    await expect(
      page.getByText(
        'Fictional user governance.test was removed locally.',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.locator('article').filter({
        hasText: 'governance.test',
      }),
    ).toHaveCount(0);
  });

  test('administrator updates and restores demonstration settings', async ({
    page,
  }) => {
    await signIn(page, PERSONAS.ADMIN);
    await page.goto('/admin/settings');

    await expect(
      page.getByRole('heading', {
        name: 'Demonstration rules and session settings',
      }),
    ).toBeVisible();

    await page.getByLabel('Retention years').fill('8');
    await page
      .getByLabel('Auto-approval amount')
      .fill('750');
    await page.getByLabel('Session timeout').fill('45');

    await page
      .getByRole('button', {
        name: 'Save demonstration settings',
      })
      .click();

    await expect(
      page.getByText(
        'Local demonstration settings were updated.',
        { exact: true },
      ),
    ).toBeVisible();

    await expect(
      page.getByLabel('Retention years'),
    ).toHaveValue('8');
    await expect(
      page.getByLabel('Auto-approval amount'),
    ).toHaveValue('750');
    await expect(
      page.getByLabel('Session timeout'),
    ).toHaveValue('45');

    await page
      .getByRole('button', {
        name: 'Restore defaults',
      })
      .click();

    const restoreDialog = page.getByRole('alertdialog');

    await expect(restoreDialog).toBeVisible();
    await restoreDialog
      .getByLabel(
        'Type the confirmation text to continue',
      )
      .fill('RESTORE DEFAULT SETTINGS');
    await restoreDialog
      .getByRole('button', {
        name: 'Restore default settings',
      })
      .click();

    await expect(
      page.getByText(
        'Default demonstration settings were restored locally.',
        { exact: true },
      ),
    ).toBeVisible();

    await expect(
      page.getByLabel('Retention years'),
    ).toHaveValue('7');
    await expect(
      page.getByLabel('Auto-approval amount'),
    ).toHaveValue('500');
    await expect(
      page.getByLabel('Session timeout'),
    ).toHaveValue('30');
  });

  test('administrator exports, validates, applies, and restores browser-local snapshots', async ({
    page,
  }) => {
    await signIn(page, PERSONAS.ADMIN);
    await page.goto('/admin/snapshots');

    await expect(
      page.getByRole('heading', {
        name: 'Snapshots and sample restore',
      }),
    ).toBeVisible();

    const downloadPromise = page.waitForEvent('download');

    await page
      .getByRole('button', {
        name: 'Export JSON snapshot',
      })
      .click();

    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(
      /^eob-eor-demo-snapshot-\d{8}T\d{6}Z\.json$/,
    );

    await expect(
      page.getByText(
        'The governed demo data snapshot was exported locally. No file was transmitted.',
        { exact: true },
      ),
    ).toBeVisible();

    const downloadedPath = await download.path();

    expect(downloadedPath).not.toBeNull();

    await page
      .locator('input[type="file"]')
      .setInputFiles(downloadedPath);

    await expect(
      page.getByRole('heading', {
        name: 'Snapshot validation passed',
      }),
    ).toBeVisible({
      timeout: 15_000,
    });

    await expect(
      page.getByText(
        'The snapshot passed local validation. No browser-local data has been replaced.',
        { exact: true },
      ),
    ).toBeVisible();

    await page
      .getByRole('button', {
        name: 'Replace local demo data',
      })
      .click();

    const applyDialog = page.getByRole('alertdialog');

    await expect(applyDialog).toBeVisible();
    await applyDialog
      .getByLabel(
        'Type the confirmation text to continue',
      )
      .fill('REPLACE LOCAL DEMO DATA');
    await applyDialog
      .getByRole('button', {
        name: 'Replace local demo data',
      })
      .click();

    await expect(
      page.getByText(
        /The validated snapshot replaced governed browser-local data\./,
      ),
    ).toBeVisible({
      timeout: 15_000,
    });

    await page
      .getByRole('button', {
        name: 'Restore sample data',
      })
      .click();

    const restoreDialog = page.getByRole('alertdialog');

    await expect(restoreDialog).toBeVisible();
    await restoreDialog
      .getByLabel(
        'Type the confirmation text to continue',
      )
      .fill('RESTORE SAMPLE DATA');
    await restoreDialog
      .getByRole('button', {
        name: 'Restore sample data',
      })
      .click();

    await expect(
      page.getByText(
        /Canonical fictional sample data was restored/,
      ),
    ).toBeVisible({
      timeout: 15_000,
    });
  });

  test('administrator filters masked audit history and exports formula-safe local evidence', async ({
    page,
  }) => {
    await signIn(page, PERSONAS.ADMIN);
    await page.goto('/audit');

    await expect(
      page.getByRole('heading', {
        name: 'Masked audit history',
      }),
    ).toBeVisible();

    await page.getByLabel('Action').fill('SIGN_IN');
    await page
      .getByRole('button', {
        name: 'Apply audit filters',
      })
      .click();

    await expect(
      page.getByText(
        '1 authorized masked event found.',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', {
        name: 'Sign in',
      }),
    ).toBeVisible();
    await expect(
      page.getByText('Administrator', {
        exact: true,
      }),
    ).toHaveCount(0);

    const downloadPromise = page.waitForEvent('download');

    await page
      .getByRole('button', {
        name: 'Export CSV',
      })
      .click();

    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(
      /^audit-events-demo-\d{8}T\d{6}Z\.csv$/,
    );

    await expect(
      page.getByText(
        '1 masked fictional audit event was exported locally as CSV.',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByText(
        'Export notice: Fictional demo data',
        { exact: true },
      ),
    ).toBeVisible();
  });

  test('ITS refreshes deterministic monitoring, changes appearance, and filters disconnected integrations', async ({
    page,
  }) => {
    await signIn(page, PERSONAS.ITS);
    await page.goto('/monitoring');

    await expect(
      page.getByRole('heading', {
        name: 'Monitoring dashboard',
      }),
    ).toBeVisible();
    await expect(
      page.getByText(
        'Simulated fixture — no monitoring service is connected',
      ),
    ).toBeVisible();
    await expect(
      page.getByText('CDC Healthy', { exact: true }),
    ).toBeVisible();

    await page
      .getByRole('button', {
        name: 'Use near-black mode',
      })
      .click();

    await expect(
      page.getByRole('button', {
        name: 'Use light mode',
      }),
    ).toBeVisible();
    await expect(
      page.getByText(
        'Near-black monitoring mode was retained in browser-local preferences.',
        { exact: true },
      ),
    ).toBeVisible();

    await page
      .getByRole('button', {
        name: 'Refresh local fixture',
      })
      .click();

    await expect(
      page.getByText(
        'The deterministic monitoring fixture advanced by one local interval.',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', {
        name: 'Simulated monitoring interval advanced',
      }),
    ).toBeVisible();

    await page.goto('/integrations');

    await expect(
      page.getByRole('heading', {
        name: 'Integration inventory',
      }),
    ).toBeVisible();
    await expect(
      page.getByText(
        'No live connectivity is configured.',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByText('Network enabled: No', {
        exact: true,
      }),
    ).toBeVisible();

    await page
      .getByLabel('Architecture layer')
      .selectOption('INTEGRATION');
    await page
      .getByLabel('Connection label')
      .selectOption('ASYNC');
    await page
      .getByLabel('Search inventory')
      .fill('IXIT');
    await page
      .getByRole('button', {
        name: 'Apply search',
      })
      .click();

    await expect(
      page.getByRole('heading', {
        name: 'IXIT reporting handoff',
      }),
    ).toBeVisible();
    await expect(
      page.getByText(
        'Status: Simulated — local outbound record [Pipeline-aligned]',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByText('Live connectivity', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText('Not configured', {
        exact: true,
      }),
    ).toBeVisible();
  });

  test('CSR uses a deterministic assistant and reviews the representative support dashboard', async ({
    page,
  }) => {
    await signIn(page, PERSONAS.CSR);
    await page.goto('/assistant');

    await expect(
      page.getByRole('heading', {
        name: 'Scripted claims explanations',
      }),
    ).toBeVisible();
    await expect(
      page.getByText('Scripted demo — no model call', {
        exact: true,
      }).first(),
    ).toBeVisible();

    await page
      .getByRole('radio', {
        name: /Explain code 45/,
      })
      .check();
    await page
      .getByRole('button', {
        name: 'Show scripted explanation',
      })
      .click();

    await expect(
      page.getByText(
        "Code 45 indicates the charge exceeds the payer's allowed amount. In this fictional EOB fixture, the remaining patient responsibility reflects the displayed deductible application.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByText(
        'A deterministic browser-local script was selected. No model or external service was contacted.',
        { exact: true },
      ),
    ).toBeVisible();

    await expect(
      page.getByRole('button', {
        name: 'Attach scripted response',
      }),
    ).toBeEnabled();

    await page.goto('/csr');

    await expect(
      page.getByRole('heading', {
        name: 'CSR dashboard',
      }),
    ).toBeVisible();
    await expect(
      page.getByText(
        'Representative browser-local support data',
      ),
    ).toBeVisible();

    const openRequestsCard = page.locator('article').filter({
      hasText: 'Open requests',
    });

    await expect(
      openRequestsCard.getByText('3', {
        exact: true,
      }),
    ).toBeVisible();

    await expect(
      page.getByRole('heading', {
        name: 'Seven-day request activity',
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', {
        name: 'Representative alerts',
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', {
        name: 'Recent requests',
      }),
    ).toBeVisible();
    await expect(
      page.getByText('REQ-000003', {
        exact: true,
      }),
    ).toBeVisible();
  });

  test('internal persona reviews honest compliance disclosures without certification claims', async ({
    page,
  }) => {
    await signIn(page, PERSONAS.CSR);
    await page.goto('/compliance');

    await expect(
      page.getByRole('heading', {
        name: 'Compliance status',
      }),
    ).toBeVisible();
    await expect(
      page.getByText(
        'No certification or production-compliance claim',
        { exact: true },
      ),
    ).toBeVisible();

    await expect(
      page.getByRole('heading', {
        name: 'Implemented demo behavior',
      }),
    ).toBeVisible();
    await expect(
      page.getByText('Client-side role states', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText('Browser-local masked audits', {
        exact: true,
      }),
    ).toBeVisible();

    await expect(
      page.getByRole('heading', {
        name: 'Production-only controls',
      }),
    ).toBeVisible();
    await expect(
      page.getByText('HIPAA compliance', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText('SOC 2 Type II', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText(
        'SAML 2.0 — production context only',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByText('Certifications claimed: none', {
        exact: true,
      }),
    ).toBeVisible();
  });

  test('BOS reviews separate executive cases and published productivity fixtures', async ({
    page,
  }) => {
    await signIn(page, PERSONAS.BOS);
    await page.goto('/executive');

    await expect(
      page.getByRole('heading', {
        name: 'Executive insights',
      }),
    ).toBeVisible();
    await expect(
      page.getByText('Published display fixtures', {
        exact: true,
      }).first(),
    ).toBeVisible();

    await expect(
      page.getByRole('heading', {
        name: 'Published Case A',
      }),
    ).toBeVisible();
    await expect(
      page.getByText('2–3 days', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText('2.5 days', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText('15 minutes', {
        exact: true,
      }),
    ).toBeVisible();

    await expect(
      page.getByRole('heading', {
        name: 'Published Case B',
      }),
    ).toBeVisible();
    await expect(
      page.getByText('1,333%', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText('$10,700,000', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', {
        name: 'Monthly volume and savings',
      }),
    ).toBeVisible();
    await expect(
      page.getByText(
        /Conflicting figures are intentionally not reconciled\./,
      ),
    ).toBeVisible();

    await page.goto('/productivity');

    await expect(
      page.getByRole('heading', {
        name: 'Before and after productivity',
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', {
        name: 'Representative manual process',
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', {
        name: 'Representative target process',
      }),
    ).toBeVisible();

    await expect(
      page.getByText('240 min', {
        exact: true,
      }).first(),
    ).toBeVisible();
    await expect(
      page.getByText('15.5 min', {
        exact: true,
      }).first(),
    ).toBeVisible();
    await expect(
      page.getByText('15.5x faster', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText('0.8-month payback', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', {
        name: 'Published error points',
      }),
    ).toBeVisible();
    await expect(
      page.getByText(
        /not calculated from local claim records/,
      ),
    ).toBeVisible();
  });
});