import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

export interface MenuItem {
  key: string;
  label: string;
  onSelect: () => void;
}

interface MenuButtonProps {
  label: string;
  items: readonly MenuItem[];
}

// WAI-ARIA menu button: Enter, Space or ArrowDown opens and focuses the first
// item; arrows move; Escape closes and returns focus; Tab or an outside click closes.
export function MenuButton({ label, items }: MenuButtonProps) {
  const generatedId = useId();
  const id = `${generatedId}-button`;
  const menuId = `${generatedId}-menu`;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (!open) return;
    itemRefs.current[0]?.focus();
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  function close(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const current = itemRefs.current.findIndex((el) => el === document.activeElement);
    const count = items.length;
    const focusAt = (i: number) => itemRefs.current[(i + count) % count]?.focus();
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusAt(current + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusAt(current - 1);
        break;
      case 'Home':
        event.preventDefault();
        focusAt(0);
        break;
      case 'End':
        event.preventDefault();
        focusAt(count - 1);
        break;
      case 'Escape':
        event.preventDefault();
        close(true);
        break;
      case 'Tab':
        close(false);
        break;
    }
  }

  return (
    <div className="menu" ref={rootRef}>
      <button
        ref={buttonRef}
        id={id}
        type="button"
        className="button button--text"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          setOpen((o) => !o);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {label}
      </button>
      {open && (
        <div
          role="menu"
          id={menuId}
          aria-labelledby={id}
          className="menu__list"
          onKeyDown={onMenuKeyDown}
          tabIndex={-1}
        >
          {items.map((item, i) => (
            <button
              key={item.key}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="menu__item"
              onClick={() => {
                // Return focus first, so a dialog opened by the item restores
                // focus to the menu button when it closes.
                close(true);
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
