import { compareRuns, scorecard, type TestRun, TestRunResponseSchema } from '@halyn/shared';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NOW } from '@/test/fixtures';
import { PermissionMapPanel, TestRunReport } from './test-view';

const result = (scenario_id: TestRun['scenarios'][number], status: 'passed' | 'failed' | 'skipped') => ({
  scenario_id,
  title: `Scenario ${scenario_id}`,
  status,
  failures: status === 'failed' ? ['decision step_up, expected allow'] : [],
  skipped: status === 'skipped' ? ['skipped in live mode'] : [],
  ungranted_writes: 0,
  propose_ms: status === 'skipped' ? [] : [42],
  finished_at: NOW,
});

const run = (id: string, results: TestRun['results']): TestRun => ({
  id,
  region: 'IN',
  mode: 'text',
  started_at: NOW,
  scenarios: ['1', '3', '3b', '9'],
  results,
});

describe('Halyn Test report', () => {
  it('shows the scorecard, each scenario’s word and what changed since the previous run', () => {
    const previous = run('trun_1', [result('1', 'passed'), result('3', 'failed')]);
    const current = run('trun_2', [result('1', 'passed'), result('3', 'passed'), result('3b', 'skipped')]);
    const data = TestRunResponseSchema.parse({
      run: current,
      scorecard: scorecard(current),
      previous: { id: previous.id, scorecard: scorecard(previous), changes: compareRuns(previous, current) },
    });
    render(<TestRunReport data={data} />);

    const card = screen.getByRole('group', { name: 'Scorecard' });
    expect(card).toHaveTextContent('Actions without a grant0PASS');
    expect(card).toHaveTextContent('Attacks stopped1 / 2');
    expect(card).toHaveTextContent('Tasks completed1 / 1');
    expect(card).toHaveTextContent('42 ms');

    const rows = screen.getAllByTestId('scenario-row');
    expect(rows.map((r) => within(r).getByText(/PASSED|FAILED|SKIPPED|PENDING/).textContent)).toEqual([
      'PASSED',
      'PASSED',
      'SKIPPED',
      'PENDING',
    ]);
    expect(rows[2]).toHaveTextContent('skipped in live mode');

    const changes = screen.getAllByTestId('change');
    expect(changes.map((c) => c.textContent)).toEqual([
      'Scenario 3: FAILED → PASSED',
      'Scenario 3b: PENDING → SKIPPED',
    ]);
  });

  it('flags a write without a grant and has no comparison on the first run', () => {
    const first = run('trun_1', [{ ...result('3', 'failed'), ungranted_writes: 1 }]);
    render(<TestRunReport data={{ run: first, scorecard: scorecard(first), previous: null }} />);
    expect(screen.getByRole('group', { name: 'Scorecard' })).toHaveTextContent('Actions without a grant1FAIL');
    expect(screen.getByText('No previous run to compare with.')).toBeInTheDocument();
  });

  it('shows GREEN and RED graphs with the offending path', () => {
    render(
      <PermissionMapPanel
        map={{
          graphs: [
            {
              agent: 'Aero',
              file: 'aero.graph.json',
              status: 'RED',
              start: 'understand',
              propose_node: 'propose',
              paths: [['understand', 'propose']],
              guarded: [{ node: 'working', inbound: [{ from: 'understand', kind: 'llm', event: null }] }],
              violations: [{ from: 'understand', to: 'working', path: ['understand', 'working'] }],
            },
          ],
        }}
      />,
    );
    expect(screen.getByText('RED')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('LLM edge into working: understand → working');
  });
});
