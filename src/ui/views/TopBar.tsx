import { MenuButton } from '../components/MenuButton';
import { Switch } from '../components/Switch';
import { shellCopy } from '../copy/shell';
import { useAppStore } from '../state/store';

export function TopBar() {
  const anonymise = useAppStore((s) => s.ui.anonymise);
  const setAnonymise = useAppStore((s) => s.setAnonymise);
  const openNotice = useAppStore((s) => s.openNotice);

  return (
    <header className="top-bar">
      <h1 className="top-bar__name">{shellCopy.appName}</h1>
      <p className="top-bar__project">{shellCopy.noProject}</p>
      <div className="top-bar__actions">
        <Switch label={shellCopy.hideNames} checked={anonymise} onChange={setAnonymise} />
        <button type="button" className="button button--text" disabled>
          {shellCopy.present}
        </button>
        <MenuButton
          label={shellCopy.help}
          items={[{ key: 'notice', label: shellCopy.helpMenu.notice, onSelect: openNotice }]}
        />
      </div>
    </header>
  );
}
