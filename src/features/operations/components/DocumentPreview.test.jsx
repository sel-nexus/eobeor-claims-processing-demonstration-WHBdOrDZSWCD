import {
  render,
  screen,
  within,
} from '@testing-library/react';
import {
  APPEAL_FIXTURES,
  DOCUMENT_DISCLOSURES,
  DOCUMENT_DOWNLOAD_NOTICE,
  DOCUMENT_VERSION_DETAILS,
  INITIAL_DOCUMENT_VERSIONS,
} from '../../../fixtures/documents.js';
import {
  COVERAGES,
  PROVIDERS,
  REASON_CODES,
  SERVICE_LINES,
} from '../../../fixtures/membersClaims.js';
import DocumentPreview from './DocumentPreview.jsx';

const MEMBER_CONTEXT = Object.freeze({
  actorId: 'usr_member_john',
  userId: 'usr_member_john',
  displayName: 'John Doe',
  role: 'MEMBER',
  memberId: '123456789',
});

const CSR_CONTEXT = Object.freeze({
  actorId: 'usr_csr',
  userId: 'usr_csr',
  displayName: 'Customer Service Representative',
  role: 'CSR',
  memberId: null,
});

const CONTACTS = Object.freeze([
  Object.freeze({
    label: 'Demo Member Services',
    phoneMasked: '(***) ***-0101',
  }),
  Object.freeze({
    label: 'Demo Appeals Unit',
    contactReference: 'CONTACT-DEMO-APPEALS',
  }),
]);

function createPreviewProps(documentType) {
  const document = INITIAL_DOCUMENT_VERSIONS.find(
    (candidate) =>
      candidate.documentType === documentType &&
      candidate.claimNumber === 'CL2024001',
  );
  const retainedDetails = DOCUMENT_VERSION_DETAILS.find(
    (candidate) =>
      candidate.documentId === document.documentId,
  );
  const provider = PROVIDERS.find(
    (candidate) =>
      candidate.providerId === 'PRV1001',
  );
  const coverage = COVERAGES.find(
    (candidate) =>
      candidate.coverageId === 'COV1001',
  );
  const appeal = APPEAL_FIXTURES.find(
    (candidate) =>
      candidate.claimNumber === 'CL2024001' &&
      candidate.documentType === documentType,
  );
  const serviceLines = SERVICE_LINES.filter(
    (line) => line.claimNumber === 'CL2024001',
  ).map((line) => ({
    ...line,
    reasonCodes: line.reasonCodeIds
      .map((reasonCodeId) =>
        REASON_CODES.find(
          (reason) =>
            reason.reasonCodeId === reasonCodeId,
        ),
      )
      .filter(Boolean),
  }));

  return {
    preview: document,
    details: {
      ...retainedDetails,
      provider,
    },
    serviceLines,
    coverage,
    appeal,
    contacts: CONTACTS,
  };
}

function expectFinancialSummary(preview) {
  const heading = within(preview).getByRole('heading', {
    name: 'Financial summary',
  });
  const section = heading.closest('section');

  expect(section).not.toBeNull();

  [
    ['Provider billed', '$250.00'],
    ['Plan discount', '$50.00'],
    ['Allowed amount', '$200.00'],
    ['Plan paid', '$160.00'],
    ['Your responsibility', '$40.00'],
  ].forEach(([label, amount]) => {
    const labelElement = within(section).getByText(label, {
      exact: true,
    });
    const summaryCard = labelElement.closest('div');

    expect(summaryCard).not.toBeNull();
    expect(
      within(summaryCard).getByText(amount, {
        exact: true,
      }),
    ).toBeInTheDocument();
  });
}

function expectRequiredNotices(preview) {
  DOCUMENT_DISCLOSURES.forEach((disclosure) => {
    expect(
      within(preview).getByText(disclosure, {
        exact: true,
      }),
    ).toBeInTheDocument();
  });

  expect(
    within(preview).getByText(DOCUMENT_DOWNLOAD_NOTICE, {
      exact: true,
    }),
  ).toBeInTheDocument();
}

describe('DocumentPreview', () => {
  it('renders the exact CL2024001 EOB values, code 45, appeal rights, contacts, and non-authoritative notices', () => {
    render(
      <DocumentPreview
        {...createPreviewProps('EOB')}
        context={MEMBER_CONTEXT}
        owned
      />,
    );

    const title = screen.getByRole('heading', {
      name: 'Explanation of Benefits',
    });
    const preview = title.closest('article');

    expect(preview).not.toBeNull();
    expect(
      within(preview).getByText('CL2024001', {
        exact: true,
      }),
    ).toBeInTheDocument();
    expect(
      within(preview).getByText('123456789', {
        exact: true,
      }),
    ).toBeInTheDocument();
    expect(
      within(preview).getByText('John Doe', {
        exact: true,
      }),
    ).toBeInTheDocument();
    expect(
      within(preview).getByText(
        'Lakeside Family Medicine',
        { exact: true },
      ),
    ).toBeInTheDocument();
    expect(
      within(preview).getByText('Jan 15, 2024', {
        exact: true,
      }),
    ).toBeInTheDocument();

    expectFinancialSummary(preview);

    const serviceHeading = within(preview).getByRole(
      'heading',
      {
        name: 'Office visit - demo service line',
      },
    );
    const serviceLine = serviceHeading.closest('article');

    expect(serviceLine).not.toBeNull();
    expect(
      within(serviceLine).getByText('99213', {
        exact: true,
      }),
    ).toBeInTheDocument();
    expect(
      within(serviceLine).getByText(
        'CO45 · Contractual adjustment',
        { exact: true },
      ),
    ).toBeInTheDocument();
    expect(
      within(serviceLine).getByText(
        'Fictional adjustment showing the difference between billed and allowed amounts.',
        { exact: true },
      ),
    ).toBeInTheDocument();

    expect(
      within(preview).getByRole('heading', {
        name: 'Questions and appeal rights',
      }),
    ).toBeInTheDocument();
    expect(
      within(preview).getByText(
        'If you disagree with this fictional explanation, you may request a demo review.',
        { exact: true },
      ),
    ).toBeInTheDocument();
    expect(
      within(preview).getByText(
        'For demonstration only, submit a request within 180 days of the document date.',
        { exact: true },
      ),
    ).toBeInTheDocument();
    expect(
      within(preview).getByText(
        'Identify the fictional claim number and the item you want reviewed.',
        { exact: true },
      ),
    ).toBeInTheDocument();

    expect(
      within(preview).getByRole('heading', {
        name: 'Contact information',
      }),
    ).toBeInTheDocument();
    expect(
      within(preview).getByText('Demo Member Services', {
        exact: true,
      }),
    ).toBeInTheDocument();
    expect(
      within(preview).getByText('(***) ***-0101', {
        exact: true,
      }),
    ).toBeInTheDocument();
    expect(
      within(preview).getByText('CONTACT-DEMO-APPEALS', {
        exact: true,
      }),
    ).toBeInTheDocument();

    expectRequiredNotices(preview);
  });

  it('renders the exact CL2024001 EOR totals while masking member and payment identifiers for CSR access', () => {
    const props = createPreviewProps('EOR');

    render(
      <DocumentPreview
        {...props}
        details={{
          ...props.details,
          paymentReferenceMasked: undefined,
          paymentReference: 'PAY-DEMO-0001',
        }}
        context={CSR_CONTEXT}
      />,
    );

    const title = screen.getByRole('heading', {
      name: 'Explanation of Review',
    });
    const preview = title.closest('article');

    expect(preview).not.toBeNull();
    expect(
      within(preview).getByRole('heading', {
        name: 'Review summary',
      }),
    ).toBeInTheDocument();
    expect(
      within(preview).getByText('CL2024001', {
        exact: true,
      }),
    ).toBeInTheDocument();
    expect(
      within(preview).getByText('*****6789', {
        exact: true,
      }),
    ).toBeInTheDocument();
    expect(
      within(preview).queryByText('123456789', {
        exact: true,
      }),
    ).not.toBeInTheDocument();
    expect(
      within(preview).getByText('*********0001', {
        exact: true,
      }),
    ).toBeInTheDocument();
    expect(
      within(preview).queryByText('PAY-DEMO-0001', {
        exact: true,
      }),
    ).not.toBeInTheDocument();

    expectFinancialSummary(preview);

    expect(
      within(preview).getByText(
        'If you disagree with this fictional review result, you may request a demo reconsideration.',
        { exact: true },
      ),
    ).toBeInTheDocument();
    expectRequiredNotices(preview);
  });
});