import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ImageLightbox } from './ImageLightbox';

it('navigates, traps focus, closes with Escape, and restores focus', () => {
  const close = vi.fn();
  const trigger = document.createElement('button');
  document.body.append(trigger); trigger.focus();
  const { unmount } = render(<ImageLightbox src="/chart.png" alt="Chart 2" onClose={close} onPrevious={() => undefined} onNext={() => undefined} />);
  const closeButton = screen.getByRole('button', { name: 'Close image preview' });
  const next = screen.getByRole('button', { name: 'Next image' });
  expect(closeButton).toHaveFocus();
  next.focus(); fireEvent.keyDown(document, { key: 'Tab' });
  expect(closeButton).toHaveFocus();
  closeButton.focus(); fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
  expect(next).toHaveFocus();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(close).toHaveBeenCalledOnce();
  unmount(); expect(trigger).toHaveFocus(); trigger.remove();
});

it('closes only when the overlay itself is pressed', () => {
  const close = vi.fn();
  render(<ImageLightbox src="/chart.png" alt="Chart" onClose={close} />);
  fireEvent.mouseDown(screen.getByRole('dialog'));
  expect(close).toHaveBeenCalledOnce();
});
