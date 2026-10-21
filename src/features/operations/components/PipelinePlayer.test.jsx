import {
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PipelinePlayer from './PipelinePlayer.jsx';
import {
  PIPELINE_MACHINE_DEFINITION,
} from '../services/pipelineMachine.js';

const REQUEST_ID =
  '10000000-0000-4000-8000-000000000001';

const EXPECTED_STAGES = Object.freeze([
  ['Request', 'Intake'],
  ['Validation', 'Validation'],
  ['Data retrieval', 'Data retrieval'],
  ['Business rules', 'Business rules'],
  ['Document generation', 'Document generation'],
  ['Quality check', 'Quality assurance'],
  ['PDF creation', 'PDF creation'],
  ['Storage', 'Storage'],
  ['Stored', 'Outbound'],
]);

function createPipelineState(overrides = {}) {
  return {
    requestId: REQUEST_ID,
    status: 'PAUSED',
    currentStep: 'BUSINESS_RULES',
    completedSteps: [
      'REQUEST',
      'VALIDATION',
      'DATA_RETRIEVAL',
    ],
    stepResults: [],
    validationChecks: [
      {
        ruleId: 'REQUEST_FIELDS_VALID',
        status: 'PASSED',
      },
      {
        ruleId: 'MEMBER_CLAIM_MATCH',
        status: 'PASSED',
      },
      {
        ruleId: 'CLAIM_ELIGIBLE',
        status: 'PASSED',
      },
    ],
    checkpoint: {
      step: 'BUSINESS_RULES',
      nextStep: 'BUSINESS_RULES',
      resumable: true,
    },
    ...overrides,
  };
}

describe('PipelinePlayer', () => {
  it('shows all nine stages, agent evidence, and simultaneous SLA and target values', () => {
    render(
      <PipelinePlayer value={createPipelineState()} />,
    );

    expect(
      screen.getByRole('heading', {
        name: 'Nine-stage document pipeline',
      }),
    ).toBeInTheDocument();

    EXPECTED_STAGES.forEach(([stageLabel, agentLabel]) => {
      const stageHeading = screen.getByRole('heading', {
        level: 3,
        name: stageLabel,
      });
      const stageCard = stageHeading.closest('li');

      expect(stageCard).not.toBeNull();
      expect(
        within(stageCard).getByText(agentLabel, {
          exact: true,
        }),
      ).toBeInTheDocument();
    });

    const slaCard = screen.getByText('SLA').closest('div');
    const targetCard = screen
      .getByText('Productivity target')
      .closest('div');
    const totalCard = screen
      .getByText('Printed stage total')
      .closest('div');

    expect(slaCard).not.toBeNull();
    expect(targetCard).not.toBeNull();
    expect(totalCard).not.toBeNull();
    expect(
      within(slaCard).getByText('22 min'),
    ).toBeInTheDocument();
    expect(
      within(targetCard).getByText('15.5 min'),
    ).toBeInTheDocument();
    expect(
      within(totalCard).getByText('15.5 min'),
    ).toBeInTheDocument();
  });

  it('reports progress and the current status with accessible text', () => {
    const { container } = render(
      <PipelinePlayer value={createPipelineState()} />,
    );
    const progress = screen.getByRole('progressbar', {
      name: 'Pipeline completion',
    });
    const liveRegion = container.querySelector(
      '[aria-live="polite"]',
    );

    expect(progress).toHaveAttribute('aria-valuemin', '0');
    expect(progress).toHaveAttribute('aria-valuemax', '9');
    expect(progress).toHaveAttribute('aria-valuenow', '3');
    expect(progress).toHaveAttribute(
      'aria-valuetext',
      '33% complete',
    );
    expect(
      screen.getByText('3 of 9 stages'),
    ).toBeInTheDocument();
    expect(liveRegion).toHaveTextContent(
      'Paused. 3 of 9 stages complete. Current stage: Business rules.',
    );
    expect(
      within(
        screen
          .getByRole('heading', {
            level: 3,
            name: 'Business rules',
          })
          .closest('li'),
      ).getByText('Paused'),
    ).toBeInTheDocument();
  });

  it('updates the polite status announcement when processing completes', () => {
    const { container, rerender } = render(
      <PipelinePlayer
        value={createPipelineState({
          status: 'RUNNING',
          currentStep: 'QUALITY_CHECK',
          completedSteps: [
            'REQUEST',
            'VALIDATION',
            'DATA_RETRIEVAL',
            'BUSINESS_RULES',
            'DOCUMENT_GENERATION',
          ],
          checkpoint: {
            step: 'QUALITY_CHECK',
            nextStep: 'QUALITY_CHECK',
            resumable: true,
          },
        })}
      />,
    );
    const liveRegion = container.querySelector(
      '[aria-live="polite"]',
    );

    expect(liveRegion).toHaveTextContent(
      'Running. 5 of 9 stages complete. Current stage: Quality check.',
    );

    rerender(
      <PipelinePlayer
        value={createPipelineState({
          status: 'COMPLETE',
          currentStep: 'STORED',
          completedSteps:
            PIPELINE_MACHINE_DEFINITION.steps.map(
              (step) => step.step,
            ),
          checkpoint: {
            step: 'STORED',
            nextStep: null,
            resumable: false,
          },
        })}
      />,
    );

    expect(liveRegion).toHaveTextContent(
      'Pipeline complete. All 9 stages finished.',
    );
    expect(
      screen.getByRole('progressbar', {
        name: 'Pipeline completion',
      }),
    ).toHaveAttribute('aria-valuetext', '100% complete');
  });

  it('keeps the resume control operable at a phone-width viewport', async () => {
    const user = userEvent.setup();
    const onResume = vi.fn(async () => ({
      ok: true,
      data: {
        status: 'RUNNING',
      },
    }));
    const previousWidth = globalThis.innerWidth;

    Object.defineProperty(globalThis, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 320,
    });
    globalThis.dispatchEvent(new Event('resize'));

    try {
      render(
        <PipelinePlayer
          value={createPipelineState()}
          onResume={onResume}
        />,
      );

      const resumeButton = screen.getByRole('button', {
        name: 'Resume playback',
      });

      expect(resumeButton).toBeEnabled();
      await user.click(resumeButton);

      await waitFor(() => {
        expect(onResume).toHaveBeenCalledTimes(1);
      });
      expect(onResume).toHaveBeenCalledWith(
        {
          requestId: REQUEST_ID,
          expectedCheckpoint: 'BUSINESS_RULES',
        },
        expect.objectContaining({
          requestId: REQUEST_ID,
          status: 'PAUSED',
          currentStep: 'BUSINESS_RULES',
        }),
        expect.any(Object),
      );
    } finally {
      Object.defineProperty(globalThis, 'innerWidth', {
        configurable: true,
        writable: true,
        value: previousWidth,
      });
      globalThis.dispatchEvent(new Event('resize'));
    }
  });

  it('shows a recoverable error when a playback control fails', async () => {
    const user = userEvent.setup();
    const onResume = vi.fn(async () => {
      throw new Error(
        'The saved checkpoint is no longer available.',
      );
    });

    render(
      <PipelinePlayer
        value={createPipelineState()}
        onResume={onResume}
      />,
    );

    await user.click(
      screen.getByRole('button', {
        name: 'Resume playback',
      }),
    );

    expect(
      await screen.findByRole('alert'),
    ).toHaveTextContent(
      'The saved checkpoint is no longer available.',
    );
    expect(
      screen.getByRole('button', {
        name: 'Resume playback',
      }),
    ).toBeEnabled();
  });

  it('shows an unavailable state when no stage definitions are supplied', () => {
    render(
      <PipelinePlayer
        value={createPipelineState({
          completedSteps: [],
        })}
        definition={{
          slaMinutes: 22,
          targetMinutes: 15.5,
          steps: [],
        }}
      />,
    );

    expect(
      screen.getByRole('status'),
    ).toHaveTextContent(
      'Pipeline stage definitions are unavailable.',
    );
    expect(
      screen.getByRole('progressbar', {
        name: 'Pipeline completion',
      }),
    ).toHaveAttribute('aria-valuemax', '0');
  });
});