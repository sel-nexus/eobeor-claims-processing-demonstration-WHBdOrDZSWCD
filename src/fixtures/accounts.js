export const DEMO_PASSWORD = 'demo';
export const DEMO_MFA_CODE = '000000';

export const ACCOUNT_PERSONAS = Object.freeze({
  CSR: 'CSR',
  BOS: 'BOS',
  ITS: 'ITS',
  ADMIN: 'ADMIN',
  JOHN_DOE: 'JOHN_DOE',
  JANE_SMITH: 'JANE_SMITH',
});

export const DEMO_CREDENTIAL_NOTICE =
  'Demo only — credentials are validated locally and are not transmitted.';

const SEEDED_AT = '2024-01-22T00:00:00.000Z';

function createCredentials(role) {
  return Object.freeze({
    password: DEMO_PASSWORD,
    mfaCode: DEMO_MFA_CODE,
    mfaRequired: true,
    requestedRole: role,
    localOnly: true,
  });
}

function createAccount({
  userId,
  username,
  displayName,
  role,
  memberId,
  persona,
  personaLabel,
  personaDescription,
}) {
  return Object.freeze({
    userId,
    username,
    displayName,
    role,
    memberId,
    active: true,
    systemSeed: true,
    createdAt: SEEDED_AT,
    updatedAt: SEEDED_AT,
    revision: 1,
    persona,
    personaLabel,
    personaDescription,
    credentials: createCredentials(role),
    credentialNotice: DEMO_CREDENTIAL_NOTICE,
  });
}

export const SEEDED_ACCOUNTS = Object.freeze([
  createAccount({
    userId: 'usr_csr',
    username: 'csr',
    displayName: 'Customer Service Representative',
    role: 'CSR',
    memberId: null,
    persona: ACCOUNT_PERSONAS.CSR,
    personaLabel: 'CSR',
    personaDescription:
      'Fictional customer service persona for claim and reprint support demonstrations.',
  }),
  createAccount({
    userId: 'usr_bos',
    username: 'bos',
    displayName: 'Business Operations Specialist',
    role: 'BOS',
    memberId: null,
    persona: ACCOUNT_PERSONAS.BOS,
    personaLabel: 'BOS',
    personaDescription:
      'Fictional business operations persona for workflow and insight demonstrations.',
  }),
  createAccount({
    userId: 'usr_its',
    username: 'its',
    displayName: 'IT Support Specialist',
    role: 'ITS',
    memberId: null,
    persona: ACCOUNT_PERSONAS.ITS,
    personaLabel: 'ITS',
    personaDescription:
      'Fictional IT support persona for simulated monitoring and integration demonstrations.',
  }),
  createAccount({
    userId: 'usr_admin',
    username: 'administrator',
    displayName: 'Administrator',
    role: 'ADMIN',
    memberId: null,
    persona: ACCOUNT_PERSONAS.ADMIN,
    personaLabel: 'Administrator',
    personaDescription:
      'Fictional administrator persona for local user, settings, and snapshot demonstrations.',
  }),
  createAccount({
    userId: 'usr_member_john',
    username: 'john.doe',
    displayName: 'John Doe',
    role: 'MEMBER',
    memberId: '123456789',
    persona: ACCOUNT_PERSONAS.JOHN_DOE,
    personaLabel: 'John Doe',
    personaDescription:
      'Fictional member persona associated with representative claim CL2024001.',
  }),
  createAccount({
    userId: 'usr_member_jane',
    username: 'jane.smith',
    displayName: 'Jane Smith',
    role: 'MEMBER',
    memberId: '987654321',
    persona: ACCOUNT_PERSONAS.JANE_SMITH,
    personaLabel: 'Jane Smith',
    personaDescription:
      'Fictional member persona used in representative remittance fixtures.',
  }),
]);

export const SEEDED_USERS = Object.freeze(
  SEEDED_ACCOUNTS.map((account) =>
    Object.freeze({
      userId: account.userId,
      username: account.username,
      displayName: account.displayName,
      role: account.role,
      memberId: account.memberId,
      active: account.active,
      systemSeed: account.systemSeed,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
      revision: account.revision,
    }),
  ),
);

export const ACCOUNTS = SEEDED_ACCOUNTS;
export const DEMO_ACCOUNTS = SEEDED_ACCOUNTS;
export const USERS = SEEDED_USERS;

export default SEEDED_ACCOUNTS;