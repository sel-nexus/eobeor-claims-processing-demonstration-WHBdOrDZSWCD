import { expect, test } from '@playwright/test';

const DEMO_PASSWORD = 'demo';
const DEMO_MFA_CODE = '000000';

const PERSONAS = Object.freeze({
  ADMIN: Object.freeze({
    username: 'administrator',
    homeHeading: 'Administration workspace',
  }),
  CSR: Object.freeze({
    username: 'csr',
    homeHeading: 'Member support workspace',
  }),
  ITS: Object.freeze({
    username: 'its',
    homeHeading: 'Platform support workspace',
  }),
  JANE: Object.freeze({
    username: 'jane.smith',
    homeHeading: 'Your claims and documents',
  }),
  JOHN: Object.freeze({
    username: 'john.doe',
    homeHeading: 'Your claims and documents',
  }),
});

async function signIn(page, persona) {
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

async function searchForClaim(page, claimNumber) {
  await page
    .getByLabel('1. Name or record text')
    .fill(claimNumber);
  await page
    .getByRole('button', {
      name: 'Search local fixtures',
    })
    .click();

  await expect(
    page.getByText('1 authorized fictional record found.'),
  ).toBeVisible();

  const claimLink = page.locator('a').filter({
    has: page.getByText(claimNumber, { exact: true }),
  });

  await expect(claimLink.first()).toBeVisible();
  await claimLink.first().click();
  await expect(page).toHaveURL(
    new RegExp(`/claims/${claimNumber}$`),
  );
}

async function openClaimDocument(page, documentTitle) {
  const documentHeading = page.getByRole('heading', {
    name: documentTitle,
    exact: true,
  });
  const documentLink = page.locator('a').filter({
    has: documentHeading,
  });

  await expect(documentLink.first()).toBeVisible();
  await documentLink.first().click();

  await expect(page).toHaveURL(/\/documents\/[^/]+$/);
  await expect(
    page
      .getByRole('heading', {
        name: documentTitle,
        exact: true,
      })
      .first(),
  ).toBeVisible();
}

test.describe('Seeded persona acceptance journeys', () => {
  test.beforeEach(async ({ context }) => {
    await context.setOffline(false);
  });

  test('member signs in, searches a claim, previews EOB and EOR documents, requests reprocessing, and downloads a static sample', async ({
    page,
  }) => {
    await signIn(page, PERSONAS.JOHN);

    await page
      .getByRole('link', { name: 'Open claims' })
      .click();
    await expect(page).toHaveURL(/\/claims$/);

    await searchForClaim(page, 'CL2024001');

    await expect(
      page.getByRole('heading', {
        name: 'Financial summary',
      }),
    ).toBeVisible();
    await expect(
      page.getByText('$250.00', { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText('$160.00', { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText('$40.00', { exact: true }).first(),
    ).toBeVisible();

    await openClaimDocument(
      page,
      'Explanation of Benefits',
    );

    await expect(
      page.getByText('This is not a bill.', {
        exact: true,
      }).first(),
    ).toBeVisible();
    await expect(
      page.getByText(
        'Representative demo document generated from a static sample; not an authoritative claim document.',
        { exact: true },
      ),
    ).toBeVisible();

    await page
      .getByRole('button', {
        name: 'Download static sample',
      })
      .click();

    const downloadDialog = page.getByRole('alertdialog');

    await expect(downloadDialog).toBeVisible();

    const downloadPromise = page.waitForEvent('download');

    await downloadDialog
      .getByRole('button', {
        name: 'Download static sample',
      })
      .click();

    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(
      /^EOB_CL2024001_123456789_\d{8}_v1\.pdf$/,
    );

    await page.goto('/claims/CL2024001');
    await expect(
      page.getByRole('heading', {
        name: 'CL2024001',
      }),
    ).toBeVisible();

    await openClaimDocument(
      page,
      'Explanation of Review',
    );

    await expect(
      page.getByRole('heading', {
        name: 'Review summary',
      }),
    ).toBeVisible();
    await expect(
      page.getByText('****0001', { exact: true }),
    ).toBeVisible();

    await page.goto('/claims/CL2024001');

    const requestLink = page.getByRole('link', {
      name: 'Request EOB or EOR',
    });

    await expect(requestLink).toBeVisible();
    await requestLink.click();

    await expect(
      page.getByRole('heading', {
        name: 'Create a reprint request',
      }),
    ).toBeVisible();

    await page
      .getByRole('radio', { name: /Both/ })
      .check();
    await page
      .getByRole('button', {
        name: 'Create reprint request',
      })
      .click();

    await expect(page).toHaveURL(
      /\/operations\/requests\/[0-9a-f-]+$/,
    );

    await expect(
      page.getByText(
        'Deterministic processing completed locally.',
        { exact: true },
      ),
    ).toBeVisible({
      timeout: 20_000,
    });

    await expect(
      page.getByRole('heading', {
        name: 'Processing outcome',
      }),
    ).toBeVisible();

    const generatedDocuments = page.getByRole('link', {
      name: /Representative document/,
    });

    await expect(generatedDocuments).toHaveCount(2);
  });

  test('CSR opens the support dashboard and reviews a role-masked EOR', async ({
    page,
  }) => {
    await signIn(page, PERSONAS.CSR);

    await page
      .getByRole('link', {
        name: 'Open dashboard',
      })
      .click();

    await expect(page).toHaveURL(/\/csr$/);
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
    await expect(
      page.getByRole('heading', {
        name: 'Recent requests',
      }),
    ).toBeVisible();

    await page.goto('/claims');
    await searchForClaim(page, 'CL2024001');
    await openClaimDocument(
      page,
      'Explanation of Review',
    );

    await expect(
      page.getByText('*****6789', { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText('123456789', { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText('*********0001', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('PAY-DEMO-0001', { exact: true }),
    ).toHaveCount(0);
  });

  test('ITS reviews simulated monitoring and disconnected integration inventory', async ({
    page,
  }) => {
    await signIn(page, PERSONAS.ITS);

    await page
      .getByRole('link', {
        name: 'Open monitoring',
      })
      .click();

    await expect(page).toHaveURL(/\/monitoring$/);
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
  });

  test('administrator reviews masked audit evidence and restores the canonical sample', async ({
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

    await page.goto('/admin/snapshots');

    await expect(
      page.getByRole('heading', {
        name: 'Snapshots and sample restore',
      }),
    ).toBeVisible();

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

  test('member direct navigation to another member claim and document is denied without disclosing identifiers', async ({
    page,
  }) => {
    await signIn(page, PERSONAS.JANE);

    await page.goto('/claims/CL2024001');

    await expect(
      page.getByRole('heading', {
        name: 'Access unavailable',
      }),
    ).toBeVisible();
    await expect(
      page.getByText(
        'No protected record details were displayed.',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByText('CL2024001', { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText('John Doe', { exact: true }),
    ).toHaveCount(0);

    await page.goto('/documents/DOC-EOB-CL2024001-V1');

    await expect(
      page.getByRole('heading', {
        name: 'Access unavailable',
      }),
    ).toBeVisible();
    await expect(
      page.getByText(
        'No protected record details were displayed.',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByText('DOC-EOB-CL2024001-V1', {
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      page.getByText('123456789', { exact: true }),
    ).toHaveCount(0);
  });
});