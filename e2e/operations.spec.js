import { expect, test } from '@playwright/test';

const DEMO_PASSWORD = 'demo';
const DEMO_MFA_CODE = '000000';

const PERSONAS = Object.freeze({
  BOS: Object.freeze({
    username: 'bos',
    homeHeading: 'Operations workspace',
  }),
});

async function signIn(page, persona = PERSONAS.BOS) {
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

test.describe('Deferred operations journeys', () => {
  test.beforeEach(async ({ context, page }) => {
    await context.setOffline(false);
    await signIn(page);
  });

  test('processes an allowlisted 835 fixture locally without uploading a file', async ({
    page,
  }) => {
    await page.goto('/operations/inbound');

    await expect(
      page.getByRole('heading', {
        name: 'AP reprint and 835 fixtures',
      }),
    ).toBeVisible();
    await expect(
      page.getByText('No file leaves this browser', {
        exact: true,
      }),
    ).toBeVisible();

    await page
      .getByLabel('Feed type')
      .selectOption('CHANGE_835');
    await page
      .getByLabel('Approved scenario')
      .selectOption('835-ALLOWLISTED-CHANGE');

    await expect(
      page.getByText('change-835-valid.csv', {
        exact: true,
      }),
    ).toBeVisible();

    await page
      .getByRole('button', {
        name: 'Process approved fixture',
      })
      .click();

    await expect(
      page.getByText(
        'The approved fixture was processed locally. Every row was applied.',
        { exact: true },
      ),
    ).toBeVisible();

    await expect(
      page.getByRole('heading', {
        name: 'Inbound run evidence',
      }),
    ).toBeVisible();
    await expect(
      page.getByText('835 change run', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText('provider_reference', {
        exact: true,
      }).first(),
    ).toBeVisible();
    await expect(
      page.getByText('PRV1003', {
        exact: true,
      }).first(),
    ).toBeVisible();
  });

  test('runs a mixed nightly batch and retries only the returned payment row', async ({
    page,
  }) => {
    await page.goto('/operations/batch');

    await expect(
      page.getByRole('heading', {
        name: 'Nightly batch process flow',
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', {
        name: 'Batch steps 1–10',
      }),
    ).toBeVisible();

    await page
      .getByRole('button', {
        name: /Run selected rows/,
      })
      .click();

    await expect(
      page.getByText(
        'The selected rows completed locally with retained row exceptions.',
        { exact: true },
      ),
    ).toBeVisible();

    const generatedBatchHeading = page.getByRole('heading', {
      name: /^BATCH-DEMO-/,
    });

    await expect(generatedBatchHeading).toBeVisible();

    const generatedBatch = generatedBatchHeading.locator(
      'xpath=ancestor::article[1]',
    );

    await expect(
      generatedBatch.getByText('BROW-20240122-001', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      generatedBatch.getByText('BROW-20240122-002', {
        exact: true,
      }),
    ).toBeVisible();

    const retryRow = generatedBatch
      .locator('section')
      .filter({
        hasText: 'BROW-20240122-002',
      });

    await expect(
      retryRow.getByText('Payment missing', {
        exact: true,
      }),
    ).toBeVisible();

    await retryRow
      .getByLabel('Masked payment reference')
      .fill('****0192');
    await retryRow
      .getByRole('button', {
        name: 'Retry row locally',
      })
      .click();

    await expect(
      page.getByText(
        'Row BROW-20240122-002 was retried locally. No external payment or reporting system was contacted.',
        { exact: true },
      ),
    ).toBeVisible();

    await expect(
      generatedBatch.getByText('BROW-20240122-001', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      generatedBatch.getByText('BROW-20240122-002', {
        exact: true,
      }),
    ).toBeVisible();
  });

  test('reworks a claim immediately and retains one new EOB and EOR version', async ({
    page,
  }) => {
    await page.goto('/operations/rework');

    await expect(
      page.getByRole('heading', {
        name: 'Rework a fictional claim',
      }),
    ).toBeVisible();

    await page
      .getByLabel('Claim number')
      .fill('CL2024001');
    await page
      .getByLabel('Reason code')
      .fill('CORRECTED_CLAIM');
    await page
      .getByLabel('Notes')
      .fill('Corrected fictional service-line fixture.');

    await page
      .getByRole('button', {
        name: 'Create and process BOTH request',
      })
      .click();

    await expect(
      page.getByText(
        'One BOTH rework request completed locally. Representative EOB and EOR versions were retained.',
        { exact: true },
      ),
    ).toBeVisible();

    await expect(
      page.getByRole('heading', {
        name: 'Local rework evidence',
      }),
    ).toBeVisible();

    const retainedVersions = page.getByRole('link', {
      name: /Open retained version/,
    });

    await expect(retainedVersions).toHaveCount(2);
    await expect(
      page.getByRole('heading', {
        name: 'Explanation of Benefits',
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', {
        name: 'Explanation of Review',
      }),
    ).toBeVisible();
  });

  test('rejects a manual review and retains a failed request with local error evidence', async ({
    page,
  }) => {
    await page.goto('/operations/reviews');

    await expect(
      page.getByRole('heading', {
        name: 'Manual reviews',
      }),
    ).toBeVisible();
    await expect(
      page.getByText('REVIEW-CL2024004-001', {
        exact: true,
      }),
    ).toBeVisible();

    await page
      .getByRole('button', {
        name: 'Reject review',
      })
      .first()
      .click();

    await expect(
      page.getByRole('heading', {
        name: 'Reject manual review',
      }),
    ).toBeVisible();

    await page
      .getByLabel('Reason code')
      .fill('REVIEW_REJECTED');
    await page
      .getByLabel('Comment')
      .fill('Fictional review evidence was rejected.');

    await page
      .getByRole('button', {
        name: 'Reject review',
      })
      .last()
      .click();

    await expect(
      page.getByText(
        'The fictional review was rejected locally and failure evidence was retained.',
        { exact: true },
      ),
    ).toBeVisible();

    const reviewCard = page
      .locator('article')
      .filter({
        hasText: 'REVIEW-CL2024004-001',
      });

    await expect(
      reviewCard.getByText('Rejected', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      reviewCard.getByText('Failed', {
        exact: true,
      }),
    ).toBeVisible();
  });

  test('exports, queues, and closes a sanitized error report locally', async ({
    page,
  }) => {
    await page.goto(
      '/operations/errors/ERROR-QUALITY-CL2024003-001',
    );

    await expect(
      page.getByRole('heading', {
        name: 'ERROR-QUALITY-CL2024003-001',
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', {
        name: 'Document quality check failed',
      }),
    ).toBeVisible();

    const downloadPromise = page.waitForEvent('download');

    await page
      .getByRole('button', {
        name: 'Export sanitized JSON',
      })
      .click();

    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe(
      'error-report-ERROR-QUALITY-CL2024003-001.json',
    );

    await expect(
      page.getByText(
        'The sanitized fictional error report export was created locally.',
        { exact: true },
      ),
    ).toBeVisible();

    await page
      .getByRole('button', {
        name: 'Queue locally',
      })
      .click();

    const queueDialog = page.getByRole('alertdialog');

    await expect(queueDialog).toBeVisible();
    await queueDialog
      .getByRole('button', {
        name: 'Queue locally',
      })
      .click();

    await expect(
      page.getByText(
        'The fictional error report was added to the browser-local exception queue. No external system was contacted.',
        { exact: true },
      ),
    ).toBeVisible();

    await page
      .getByRole('button', {
        name: 'Close report locally',
      })
      .click();

    const closeDialog = page.getByRole('alertdialog');

    await expect(closeDialog).toBeVisible();
    await closeDialog
      .getByRole('button', {
        name: 'Close report locally',
      })
      .click();

    await expect(
      page.getByText(
        'The fictional error report was closed locally. No external system was contacted.',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByRole('button', {
        name: 'Already closed',
      }),
    ).toBeDisabled();
  });

  test('bulk-processes mixed queue selections independently', async ({
    page,
  }) => {
    await page.goto('/operations/queue');

    await expect(
      page.getByRole('heading', {
        name: 'Reprint request queue',
      }),
    ).toBeVisible();

    await page
      .getByRole('checkbox', {
        name: 'Select request REQ-000002',
      })
      .check();
    await page
      .getByRole('checkbox', {
        name: 'Select request REQ-000004',
      })
      .check();

    await expect(
      page.getByRole('button', {
        name: 'Process selected (2)',
      }),
    ).toBeEnabled();

    await page
      .getByRole('button', {
        name: 'Process selected (2)',
      })
      .click();

    await expect(
      page.getByText(
        /2 selected requests were evaluated independently\./,
      ),
    ).toBeVisible();

    const resultsHeading = page.getByRole('heading', {
      name: 'Independent bulk results',
    });
    const resultsSection = resultsHeading.locator(
      'xpath=ancestor::section[1]',
    );

    await expect(resultsHeading).toBeVisible();
    await expect(
      resultsSection.getByText('Evaluated', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      resultsSection.getByText('2', {
        exact: true,
      }).first(),
    ).toBeVisible();
    await expect(
      resultsSection.getByText(
        'Every selected request retains its own outcome; one failure does not replace another row\'s successful result.',
        { exact: true },
      ),
    ).toBeVisible();
  });

  test('filters completed reports and downloads the authorized static EOB sample', async ({
    page,
  }) => {
    await page.goto('/operations/reports');

    await expect(
      page.getByRole('heading', {
        name: 'Representative report portal',
      }),
    ).toBeVisible();

    await page
      .getByLabel('Document type')
      .selectOption('EOB');
    await page
      .getByRole('button', {
        name: 'Apply report filters',
      })
      .click();

    await expect(
      page.getByText(
        '1 authorized completed report found.',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', {
        name: 'Explanation of Benefits',
      }),
    ).toBeVisible();

    const downloadPromise = page.waitForEvent('download');

    await page
      .getByRole('button', {
        name: 'Download static sample',
      })
      .click();

    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(
      /^EOB_CL2024001_123456789_\d{8}_v1\.pdf$/,
    );
  });
});