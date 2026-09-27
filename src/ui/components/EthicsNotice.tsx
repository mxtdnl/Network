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

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
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
      <div className="dialog__actions">
        <button
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
