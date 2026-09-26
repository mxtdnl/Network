import { useEffect, useId, useRef, type ReactNode } from 'react';

interface DialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  actions?: ReactNode;
  wide?: boolean;
  describedBy?: string;
}

// Modal dialog on the native <dialog> element, which provides the focus trap,
// Escape to close and the inert background; focus returns to the opener on close.
export function Dialog({
  open,
  title,
  onClose,
  children,
  actions,
  wide,
  describedBy,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={wide ? 'dialog dialog--wide' : 'dialog'}
      aria-labelledby={titleId}
      aria-describedby={describedBy}
      onClose={onClose}
    >
      <h2 id={titleId} className="dialog__title">
        {title}
      </h2>
      <div className="dialog__body">{open ? children : null}</div>
      {actions ? <div className="dialog__actions">{actions}</div> : null}
    </dialog>
  );
}

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body: string;
  confirm: string;
  cancel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirm,
  cancel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const bodyId = useId();
  return (
    <Dialog
      open={open}
      title={title}
      onClose={onCancel}
      describedBy={bodyId}
      actions={
        <>
          <button type="button" className="button button--text" onClick={onCancel}>
            {cancel}
          </button>
          <button type="button" className="button button--primary" onClick={onConfirm}>
            {confirm}
          </button>
        </>
      }
    >
      <p id={bodyId}>{body}</p>
    </Dialog>
  );
}
