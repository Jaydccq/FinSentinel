import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AcknowledgeUnknownModal } from '../AcknowledgeUnknownModal';

const LEDGER_ID = '12345678-aaaa-bbbb-cccc-dddddddddddd';

describe('AcknowledgeUnknownModal', () => {
  it('renders title, textarea, and the truncated ledger id', () => {
    render(
      <AcknowledgeUnknownModal
        ledgerId={LEDGER_ID}
        isOpen
        onClose={vi.fn()}
        onConfirm={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText(/Acknowledge Unknown Order/)).toBeTruthy();
    expect(screen.getByLabelText(/Acknowledgement note/i)).toBeTruthy();
    // First 8 chars of ledger id rendered.
    expect(screen.getByText(/12345678/)).toBeTruthy();
  });

  it('renders nothing when isOpen=false', () => {
    const { container } = render(
      <AcknowledgeUnknownModal
        ledgerId={LEDGER_ID}
        isOpen={false}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('disables the Acknowledge button when the note is empty', () => {
    render(
      <AcknowledgeUnknownModal
        ledgerId={LEDGER_ID}
        isOpen
        onClose={vi.fn()}
        onConfirm={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    const btn = screen.getByRole('button', { name: /acknowledge/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('disables the Acknowledge button on whitespace-only input', () => {
    render(
      <AcknowledgeUnknownModal
        ledgerId={LEDGER_ID}
        isOpen
        onClose={vi.fn()}
        onConfirm={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    const ta = screen.getByLabelText(/Acknowledgement note/i) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: '    ' } });
    const btn = screen.getByRole('button', { name: /acknowledge/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('calls onConfirm with the trimmed note and onClose on success', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(
      <AcknowledgeUnknownModal
        ledgerId={LEDGER_ID}
        isOpen
        onClose={onClose}
        onConfirm={onConfirm}
      />,
    );
    const ta = screen.getByLabelText(/Acknowledgement note/i) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: '  verified with broker  ' } });
    fireEvent.click(screen.getByRole('button', { name: /acknowledge/i }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('verified with broker'));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('surfaces server error message inline and keeps modal open', async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error('not found'));
    const onClose = vi.fn();
    render(
      <AcknowledgeUnknownModal
        ledgerId={LEDGER_ID}
        isOpen
        onClose={onClose}
        onConfirm={onConfirm}
      />,
    );
    const ta = screen.getByLabelText(/Acknowledgement note/i) as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'note' } });
    fireEvent.click(screen.getByRole('button', { name: /acknowledge/i }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/not found/i));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Cancel button calls onClose without invoking onConfirm', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <AcknowledgeUnknownModal
        ledgerId={LEDGER_ID}
        isOpen
        onClose={onClose}
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
