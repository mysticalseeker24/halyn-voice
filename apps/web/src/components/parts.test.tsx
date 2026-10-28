import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { HASH_A, HASH_B } from '@/test/fixtures';
import { EventTimeline } from './event-timeline';
import { ChainStatusPill, LedgerLines } from './ledger-lines';
import { OUTCOME_LABEL, OutcomeBadge } from './outcome-badge';
import { EmptyState, ErrorState, LoadingState } from './states';

describe('OutcomeBadge', () => {
  it.each([
    ['allow', 'ALLOWED'],
    ['step_up', 'STEP-UP'],
    ['hold', 'HELD'],
    ['deny', 'DENIED'],
  ] as const)('always carries the word for %s', (outcome, word) => {
    render(<OutcomeBadge outcome={outcome} />);
    expect(screen.getByText(word)).toBeInTheDocument();
    expect(OUTCOME_LABEL[outcome]).toBe(word);
  });

  it('supports the large size used on the Stage', () => {
    render(<OutcomeBadge outcome="deny" size="lg" />);
    expect(screen.getByText('DENIED')).toHaveAttribute('data-outcome', 'deny');
  });
});

describe('ChainStatusPill', () => {
  it('says verified with the entry count', () => {
    render(<ChainStatusPill status={{ state: 'verified', entries: 7 }} />);
    expect(screen.getByText(/Chain verified · 7 entries/)).toBeInTheDocument();
  });
  it('names the first broken entry', () => {
    render(<ChainStatusPill status={{ state: 'broken', firstBadSeq: 3 }} />);
    expect(screen.getByText(/Chain BROKEN at #3/)).toBeInTheDocument();
  });
  it('says broken without a position, and unchecked', () => {
    const { rerender } = render(<ChainStatusPill status={{ state: 'broken', firstBadSeq: null }} />);
    expect(screen.getByText(/Chain BROKEN/)).toBeInTheDocument();
    rerender(<ChainStatusPill status={{ state: 'unchecked' }} />);
    expect(screen.getByText('Chain not checked yet')).toBeInTheDocument();
  });
});

describe('LedgerLines', () => {
  const line = (seq: number, ok = true) => ({
    seq,
    entry_type: 'decided',
    ref_id: 'req_1',
    hash: HASH_B,
    prev_hash: HASH_A,
    chain_ok: ok,
  });

  it('shows the empty state', () => {
    render(<LedgerLines lines={[]} />);
    expect(screen.getByText(/No ledger entries yet/)).toBeInTheDocument();
  });

  it('shows hash links, flags a broken link in words, and keeps only the latest entries', () => {
    render(<LedgerLines lines={[line(1), line(2), line(3, false), line(4)]} max={3} />);
    expect(screen.queryByText('#1')).not.toBeInTheDocument();
    expect(screen.getByText('#3')).toBeInTheDocument();
    expect(screen.getByText('BROKEN')).toBeInTheDocument();
    expect(screen.getAllByText('linked')).toHaveLength(2);
    expect(screen.getAllByText(/aaaaaaaa….*→ bbbbbbbb…bbbb/)).toHaveLength(3);
  });
});

describe('EventTimeline', () => {
  it('shows the empty state', () => {
    render(<EventTimeline items={[]} />);
    expect(screen.getByText(/Events appear here/)).toBeInTheDocument();
  });

  it('shows IST times in order and only the latest items', () => {
    const items = Array.from({ length: 5 }, (_, i) => ({
      id: `e${i}`,
      at: `2026-10-28T10:00:0${i}.000Z`,
      kind: `Kind ${i}`,
      label: `label ${i}`,
      tone: 'good' as const,
    }));
    render(<EventTimeline items={items} max={3} />);
    const entries = screen.getAllByRole('listitem');
    expect(entries).toHaveLength(3);
    expect(entries[0]).toHaveTextContent('15:30:02 IST');
    expect(screen.queryByText('Kind 1')).not.toBeInTheDocument();
  });

  it('survives a bad timestamp', () => {
    render(<EventTimeline items={[{ id: 'x', at: 'nope', kind: 'K', label: 'L' }]} />);
    expect(screen.getByText('--:--:-- IST')).toBeInTheDocument();
  });
});

describe('states', () => {
  it('renders loading, empty and error with a 44px retry button', async () => {
    const onRetry = vi.fn();
    render(
      <>
        <LoadingState label="Loading" />
        <EmptyState>Nothing</EmptyState>
        <ErrorState title="Broke" message="why" retryLabel="Again" onRetry={onRetry} />
      </>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    expect(screen.getByText('Nothing')).toHaveAttribute('data-state', 'empty');
    expect(screen.getByRole('alert')).toHaveTextContent('Broke');
    const button = screen.getByRole('button', { name: 'Again' });
    expect(button.className).toContain('min-h-11');
    await userEvent.click(button);
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('omits the retry button and message when not given', () => {
    render(<ErrorState title="Broke" retryLabel="Again" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
