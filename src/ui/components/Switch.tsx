interface SwitchProps {
  label: string;
  /** Read after the label by screen readers only, to tell apart switches with the same visible label. */
  hiddenSuffix?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function Switch({ label, hiddenSuffix, checked, onChange }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className="switch"
      onClick={() => {
        onChange(!checked);
      }}
    >
      <span className="switch__label">
        {label}
        {hiddenSuffix && <span className="visually-hidden"> {hiddenSuffix}</span>}
      </span>
      <span className="switch__track" aria-hidden="true">
        <span className="switch__thumb" />
      </span>
    </button>
  );
}
