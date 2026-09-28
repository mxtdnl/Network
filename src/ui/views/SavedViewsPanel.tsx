import { useId, useState } from 'react';
import type { SavedView } from '../../data/schema';
import { ConfirmDialog } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { savedViewsCopy as V } from '../copy/savedViews';
import { useReadOnly } from '../state/layoutMode';
import { useMemberNames } from '../state/names';
import { startPresentation } from '../state/presentation';
import {
  deleteView,
  moveView,
  renameView,
  restoreViewById,
  saveCurrentView,
  setViewCaption,
  updateView,
} from '../state/savedViews';
import { useAppStore } from '../state/store';

// The saved-views manager (spec §8), in the right column: save the map as it
// is, and name, rename, reorder, restore, update and delete views, with a
// caption for each one to show in presentation mode. While names are hidden,
// names and captions are shown with members' names replaced and cannot be
// edited, so no real name appears on screen.
export function SavedViewsPanel() {
  const project = useAppStore((s) => s.data.project);
  const hasResult = useAppStore((s) => s.results.current !== null);
  const names = useMemberNames();
  // On a phone views can be shown and presented, not saved or edited.
  const phone = useReadOnly();
  const [draft, setDraft] = useState('');
  const [pendingDelete, setPendingDelete] = useState<SavedView | null>(null);
  const nameId = useId();
  const listId = useId();
  const helpId = useId();

  if (!project || project.members.length === 0) {
    return <p className="placeholder">{V.noProject}</p>;
  }
  const views = project.saved_views;

  return (
    <div className="views">
      <p className="views__intro">{V.intro}</p>
      {!phone && (
        <form
          className="views__new"
          onSubmit={(e) => {
            e.preventDefault();
            if (saveCurrentView(draft)) setDraft('');
          }}
        >
          <label htmlFor={nameId} className="field__label">
            {V.nameLabel}
          </label>
          <div className="views__new-row">
            <input
              id={nameId}
              className="text-input views__name-input"
              value={draft}
              placeholder={V.defaultName(views.length + 1)}
              onChange={(e) => {
                setDraft(e.currentTarget.value);
              }}
            />
            <button type="submit" className="button button--secondary" disabled={!hasResult}>
              {V.save}
            </button>
          </div>
        </form>
      )}

      <div className="views__list-heading">
        <h3 id={listId} className="views__heading">
          {V.list}
        </h3>
        <button
          type="button"
          className="button button--text"
          disabled={views.length === 0}
          onClick={() => {
            startPresentation(0);
          }}
        >
          {V.present}
        </button>
      </div>
      {views.length > 0 && (
        <p id={helpId} className="field__help views__help">
          {names.anonymised ? V.captionHidden : V.captionHelp}
        </p>
      )}
      {views.length === 0 ? (
        <p className="placeholder">{V.empty}</p>
      ) : (
        <ol className="views__list" aria-labelledby={listId}>
          {views.map((view, i) => (
            <ViewItem
              key={view.id}
              view={view}
              helpId={helpId}
              index={i}
              count={views.length}
              readOnly={names.anonymised || phone}
              phone={phone}
              shown={(s) => names.text(s)}
              onDelete={() => {
                setPendingDelete(view);
              }}
            />
          ))}
        </ol>
      )}
      <ConfirmDialog
        open={pendingDelete !== null}
        title={V.deleteTitle}
        body={pendingDelete ? V.deleteBody(names.text(pendingDelete.name)) : ''}
        confirm={V.deleteConfirm}
        cancel={V.cancel}
        onCancel={() => {
          setPendingDelete(null);
        }}
        onConfirm={() => {
          if (pendingDelete) deleteView(pendingDelete.id);
          setPendingDelete(null);
        }}
      />
    </div>
  );
}

interface ItemProps {
  view: SavedView;
  /** The shared caption help, described by every caption field. */
  helpId: string;
  index: number;
  count: number;
  readOnly: boolean;
  /** The read-only phone layout: show only. */
  phone: boolean;
  shown: (s: string) => string;
  onDelete: () => void;
}

function ViewItem({ view, helpId, index, count, readOnly, phone, shown, onDelete }: ItemProps) {
  const setStatus = useAppStore((s) => s.setStatus);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [caption, setCaption] = useState<string | null>(null);
  const ids = { name: useId(), caption: useId(), error: useId() };
  const name = shown(view.name);
  const invalid = renaming !== null && renaming.trim() === '';

  return (
    <li className="views__item">
      <div className="views__item-head">
        {renaming === null ? (
          <>
            <p className="views__name">
              <span className="views__position num">{V.position(index + 1, count)}</span>
              <span>{name}</span>
            </p>
            {!phone && (
              <div className="views__order" role="group" aria-label={V.order(name)}>
                <button
                  type="button"
                  className="views__move"
                  aria-label={V.moveUp(name)}
                  title={V.moveUp(name)}
                  disabled={index === 0}
                  onClick={() => {
                    moveView(view.id, -1);
                  }}
                >
                  <Icon name="chevron-up" />
                </button>
                <button
                  type="button"
                  className="views__move"
                  aria-label={V.moveDown(name)}
                  title={V.moveDown(name)}
                  disabled={index === count - 1}
                  onClick={() => {
                    moveView(view.id, 1);
                  }}
                >
                  <Icon name="chevron-down" />
                </button>
              </div>
            )}
          </>
        ) : (
          <form
            className="views__rename"
            onSubmit={(e) => {
              e.preventDefault();
              if (renameView(view.id, renaming)) setRenaming(null);
            }}
          >
            <label htmlFor={ids.name} className="visually-hidden">
              {V.name}
            </label>
            <input
              id={ids.name}
              className="text-input views__name-input"
              value={renaming}
              aria-invalid={invalid}
              aria-describedby={invalid ? ids.error : undefined}
              // Focus moves to the field the user asked to edit.
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              onChange={(e) => {
                setRenaming(e.currentTarget.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setRenaming(null);
                }
              }}
            />
            <button type="submit" className="button button--text" disabled={invalid}>
              {V.renameSave}
            </button>
            <button
              type="button"
              className="button button--text"
              onClick={() => {
                setRenaming(null);
              }}
            >
              {V.renameCancel}
            </button>
            {invalid && (
              <p id={ids.error} className="field__error">
                {V.nameRequired}
              </p>
            )}
          </form>
        )}
      </div>

      <div className="views__actions" role="group" aria-label={name}>
        <button
          type="button"
          className="button button--text"
          aria-label={V.restoreLabel(name)}
          onClick={() => {
            restoreViewById(view.id);
          }}
        >
          {V.restore}
        </button>
        {!phone && (
          <>
            <button
              type="button"
              className="button button--text"
              aria-label={V.updateLabel(name)}
              onClick={() => {
                updateView(view.id);
                setStatus({ text: V.updated(name), tone: 'info' });
              }}
            >
              {V.update}
            </button>
            <button
              type="button"
              className="button button--text"
              aria-label={V.renameLabel(name)}
              disabled={readOnly || renaming !== null}
              onClick={() => {
                setRenaming(view.name);
              }}
            >
              {V.rename}
            </button>
            <button
              type="button"
              className="button button--text views__delete"
              aria-label={V.deleteLabel(name)}
              onClick={onDelete}
            >
              {V.delete}
            </button>
          </>
        )}
      </div>

      <div className="field views__caption">
        <label htmlFor={ids.caption} className="field__label">
          {V.caption}
        </label>
        <textarea
          id={ids.caption}
          className="text-input text-input--area"
          rows={2}
          value={readOnly ? shown(view.caption) : (caption ?? view.caption)}
          readOnly={readOnly}
          aria-describedby={helpId}
          onChange={(e) => {
            setCaption(e.currentTarget.value);
          }}
          onBlur={() => {
            if (caption !== null) setViewCaption(view.id, caption);
            setCaption(null);
          }}
        />
      </div>
    </li>
  );
}
