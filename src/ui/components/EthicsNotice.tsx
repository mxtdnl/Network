import { useEffect, useId, useRef } from 'react';
import { noticeCopy } from '../copy/notice';

interface EthicsNoticeProps {
  open: boolean;
  onClose: () => void;
}

// Modal first-run notice (spec §10) built on the native <dialog> element, which
// provides the focus trap, Escape to close and the inert background. On opening,
// focus moves to the only control, the confirm button; on closing, the browser
// returns focus to the element that had it before.
export function EthicsNotice({ open, onClose }: EthicsNoticeProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const introId = useId();
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // The scrolling text can take focus too; the confirm button is where focus starts.
      confirmRef.current?.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="dialog notice"
      aria-labelledby={titleId}
      aria-describedby={introId}
      onClose={onClose}
    >
      <h2 id={titleId} className="dialog__title">
        {noticeCopy.title}
      </h2>
      {/* The notice scrolls under its title, so the title and Continue stay in view
          on short screens; the scrolling text can be focused and scrolled by keyboard. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
      <div className="dialog__body" tabIndex={0} role="region" aria-labelledby={titleId}>
        <p id={introId} className="notice__intro">
          {noticeCopy.intro}
        </p>
        <ul className="notice__points">
          {noticeCopy.points.map((point) => (
            <li key={point.heading} className="notice__point">
              <strong className="notice__point-heading">{point.heading}</strong> {point.body}
            </li>
          ))}
        </ul>
        <h3 className="notice__section">{noticeCopy.survey.heading}</h3>
        <ul className="notice__points">
          {noticeCopy.survey.points.map((point) => (
            <li key={point.heading} className="notice__point">
              <strong className="notice__point-heading">{point.heading}</strong> {point.body}
            </li>
          ))}
        </ul>
        <p className="notice__reopen">{noticeCopy.reopen}</p>
      </div>
      <div className="dialog__actions">
        <button
          ref={confirmRef}
          type="button"
          className="button button--primary"
          onClick={() => {
            ref.current?.close();
          }}
        >
          {noticeCopy.confirm}
        </button>
      </div>
    </dialog>
  );
}
