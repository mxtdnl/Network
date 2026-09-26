import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';

export interface TabItem<K extends string> {
  key: K;
  label: string;
  panel: ReactNode;
}

interface TabsProps<K extends string> {
  label: string;
  items: readonly TabItem<K>[];
  selected: K;
  onSelect: (key: K) => void;
}

// WAI-ARIA tabs with automatic activation and a roving tab stop.
export function Tabs<K extends string>({ label, items, selected, onSelect }: TabsProps<K>) {
  const baseId = useId();
  const tabRefs = useRef(new Map<K, HTMLButtonElement>());

  function move(event: KeyboardEvent<HTMLButtonElement>) {
    const index = items.findIndex((item) => item.key === selected);
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
        next = (index + 1) % items.length;
        break;
      case 'ArrowLeft':
        next = (index - 1 + items.length) % items.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = items.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const target = items[next];
    if (target) {
      onSelect(target.key);
      tabRefs.current.get(target.key)?.focus();
    }
  }

  return (
    <div className="tabs">
      <div role="tablist" aria-label={label} className="tabs__list">
        {items.map((item) => {
          const isSelected = item.key === selected;
          return (
            <button
              key={item.key}
              ref={(el) => {
                if (el) tabRefs.current.set(item.key, el);
                else tabRefs.current.delete(item.key);
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${item.key}`}
              aria-selected={isSelected}
              aria-controls={`${baseId}-panel-${item.key}`}
              tabIndex={isSelected ? 0 : -1}
              className="tabs__tab"
              onKeyDown={move}
              onClick={() => {
                onSelect(item.key);
              }}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      {items.map((item) => (
        <div
          key={item.key}
          role="tabpanel"
          id={`${baseId}-panel-${item.key}`}
          aria-labelledby={`${baseId}-tab-${item.key}`}
          hidden={item.key !== selected}
          className="tabs__panel"
          tabIndex={0}
        >
          {item.key === selected ? item.panel : null}
        </div>
      ))}
    </div>
  );
}
