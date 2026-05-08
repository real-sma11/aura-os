import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { Explorer } from './Explorer';
import type { ExplorerNode } from './types';

const data: ExplorerNode[] = [
  { id: 'a', label: 'Alpha' },
  { id: 'b', label: 'Bravo' },
  { id: 'c', label: 'Charlie' },
];

const hasModuleClass = (element: HTMLElement, className: string) =>
  Array.from(element.classList).some((cls) => cls.includes(className));

const findRow = (label: string): HTMLElement => {
  const labelEl = screen.getByText(label);
  const row = labelEl.closest('[role="treeitem"]') as HTMLElement | null;
  if (!row) throw new Error(`No treeitem row found for ${label}`);
  return row;
};

describe('Explorer', () => {
  it('honors controlled selectedIds and ignores internal state', () => {
    const { rerender } = render(<Explorer data={data} selectedIds={['a']} />);
    expect(hasModuleClass(findRow('Alpha'), 'itemSelected')).toBe(true);
    expect(hasModuleClass(findRow('Bravo'), 'itemSelected')).toBe(false);

    fireEvent.click(screen.getByText('Bravo'));
    expect(hasModuleClass(findRow('Alpha'), 'itemSelected')).toBe(true);
    expect(hasModuleClass(findRow('Bravo'), 'itemSelected')).toBe(false);

    rerender(<Explorer data={data} selectedIds={['c']} />);
    expect(hasModuleClass(findRow('Alpha'), 'itemSelected')).toBe(false);
    expect(hasModuleClass(findRow('Charlie'), 'itemSelected')).toBe(true);
  });

  it('fires onSelect with the clicked id when controlled', () => {
    const onSelect = vi.fn();
    render(<Explorer data={data} selectedIds={['a']} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('Bravo'));
    expect(onSelect).toHaveBeenCalledWith(['b']);
  });

  it('does not remount items when controlled selection changes', () => {
    function Harness() {
      const [selected, setSelected] = useState<string[]>(['a']);
      return (
        <Explorer
          data={data}
          selectedIds={selected}
          onSelect={(ids) => setSelected(ids)}
        />
      );
    }

    render(<Harness />);
    const alphaRowBefore = findRow('Alpha');
    const bravoRowBefore = findRow('Bravo');

    fireEvent.click(screen.getByText('Bravo'));

    const alphaRowAfter = findRow('Alpha');
    const bravoRowAfter = findRow('Bravo');

    expect(alphaRowAfter).toBe(alphaRowBefore);
    expect(bravoRowAfter).toBe(bravoRowBefore);
    expect(hasModuleClass(bravoRowAfter, 'itemSelected')).toBe(true);
    expect(hasModuleClass(alphaRowAfter, 'itemSelected')).toBe(false);
  });

  it('falls back to defaultSelectedIds when uncontrolled', () => {
    render(<Explorer data={data} defaultSelectedIds={['b']} />);
    expect(hasModuleClass(findRow('Bravo'), 'itemSelected')).toBe(true);

    fireEvent.click(screen.getByText('Charlie'));
    expect(hasModuleClass(findRow('Charlie'), 'itemSelected')).toBe(true);
    expect(hasModuleClass(findRow('Bravo'), 'itemSelected')).toBe(false);
  });
});
