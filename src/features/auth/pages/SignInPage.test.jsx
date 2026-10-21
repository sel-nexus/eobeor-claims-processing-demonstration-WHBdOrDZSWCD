import {
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  DEMO_MFA_CODE,
  DEMO_PASSWORD,
  SEEDED_ACCOUNTS,
} from '../../../fixtures/accounts.js';
import SignInPage from './SignInPage.jsx';

function createAuthFacade(result = null) {
  return {
    signIn: vi.fn(async (command) => {
      if (result !== null) {
        return result;
      }

      return {
        ok: true,
        status: 200,
        data: {
          session: {
            sessionId: 'ses_test',
            userId: command.username,
            displayName: 'Demo User',
            role: command.requestedRole,
          },
        },
      };
    }),
  };
}

describe('SignInPage', () => {
  it('shows local credential guidance and no-transmission disclosure', async () => {
    const user = userEvent.setup();

    render(<SignInPage authFacade={createAuthFacade()} />);

    expect(
      screen.getByRole('heading', {
        name: 'Claims Explanation Simulator',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Choose a seeded account to set the local demo role.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /No sign-in information is sent to an identity provider, payer, healthcare system, or other external service\./,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /These client-side controls are not production authentication or authorization\./,
      ),
    ).toBeInTheDocument();

    await user.selectOptions(
      screen.getByLabelText('Demo account'),
      'john.doe',
    );

    expect(
      screen.getByText('john.doe', { exact: true }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(DEMO_PASSWORD, { exact: true }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Fictional member persona associated with representative claim CL2024001\./,
      ),
    ).toBeInTheDocument();
  });

  it('supports keyboard submission through the password and MFA steps', async () => {
    const user = userEvent.setup();
    const authFacade = createAuthFacade();
    const onSignedIn = vi.fn();
    const account = SEEDED_ACCOUNTS.find(
      (candidate) => candidate.username === 'john.doe',
    );

    render(
      <SignInPage
        authFacade={authFacade}
        onSignedIn={onSignedIn}
      />,
    );

    const accountSelect =
      screen.getByLabelText('Demo account');

    await user.selectOptions(accountSelect, account.username);
    accountSelect.focus();
    await user.keyboard('{Tab}');

    const passwordInput =
      screen.getByLabelText('Password');

    expect(passwordInput).toHaveFocus();

    await user.keyboard(`${DEMO_PASSWORD}{Enter}`);

    expect(
      await screen.findByRole('heading', {
        name: 'Verification code',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Password step complete'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(DEMO_MFA_CODE, { exact: true }),
    ).toBeInTheDocument();

    const mfaInput = screen.getByLabelText(
      'MFA verification code',
    );

    mfaInput.focus();
    await user.keyboard(`${DEMO_MFA_CODE}{Enter}`);

    await waitFor(() => {
      expect(authFacade.signIn).toHaveBeenCalledWith({
        username: account.username,
        password: DEMO_PASSWORD,
        mfaCode: DEMO_MFA_CODE,
        requestedRole: account.role,
      });
    });

    await waitFor(() => {
      expect(onSignedIn).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'ses_test',
          role: account.role,
        }),
        expect.objectContaining({
          ok: true,
          status: 200,
        }),
      );
    });
  });

  it('requires an account selection before continuing', async () => {
    const user = userEvent.setup();
    const authFacade = createAuthFacade();

    render(<SignInPage authFacade={authFacade} />);

    const accountSelect =
      screen.getByLabelText('Demo account');

    accountSelect.focus();
    await user.keyboard('{Enter}');

    expect(
      await screen.findByText(
        'Select a fictional demo account.',
      ),
    ).toBeInTheDocument();
    expect(accountSelect).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(authFacade.signIn).not.toHaveBeenCalled();
  });

  it('uses a generic failure message for an invalid printed password', async () => {
    const user = userEvent.setup();
    const authFacade = createAuthFacade();

    render(<SignInPage authFacade={authFacade} />);

    await user.selectOptions(
      screen.getByLabelText('Demo account'),
      'csr',
    );
    await user.type(
      screen.getByLabelText('Password'),
      'incorrect-password',
    );
    await user.click(
      screen.getByRole('button', { name: 'Continue' }),
    );

    expect(
      screen.getByRole('alert'),
    ).toHaveTextContent(
      'The demo credentials could not be validated.',
    );
    expect(
      screen.getByRole('heading', {
        name: 'Demo sign in',
      }),
    ).toBeInTheDocument();
    expect(authFacade.signIn).not.toHaveBeenCalled();
  });

  it('shows generic facade failures and MFA field feedback without signing in', async () => {
    const user = userEvent.setup();
    const authFacade = createAuthFacade({
      ok: false,
      status: 401,
      error: {
        code: 'INVALID_DEMO_CREDENTIALS',
        message:
          'The demo credentials could not be validated.',
        fieldErrors: [
          {
            field: 'mfaCode',
            message:
              'Enter the printed demo verification code.',
          },
        ],
      },
    });
    const onSignedIn = vi.fn();

    render(
      <SignInPage
        authFacade={authFacade}
        onSignedIn={onSignedIn}
      />,
    );

    await user.selectOptions(
      screen.getByLabelText('Demo account'),
      'administrator',
    );
    await user.type(
      screen.getByLabelText('Password'),
      DEMO_PASSWORD,
    );
    await user.click(
      screen.getByRole('button', { name: 'Continue' }),
    );
    await user.type(
      screen.getByLabelText('MFA verification code'),
      '123456',
    );
    await user.click(
      screen.getByRole('button', { name: 'Sign in' }),
    );

    expect(
      await screen.findByRole('alert'),
    ).toHaveTextContent(
      'The demo credentials could not be validated.',
    );
    expect(
      screen.getByText(
        'Enter the printed demo verification code.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText('MFA verification code'),
    ).toHaveAttribute('aria-invalid', 'true');
    expect(onSignedIn).not.toHaveBeenCalled();
  });
});