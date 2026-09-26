// Functional glyphs only (design-system §7, item 7). Drawn in currentColor.

interface IconProps {
  name: 'warning' | 'info' | 'check';
}

export function Icon({ name }: IconProps) {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      {name === 'warning' && (
        <>
          <path d="M8 1.5 15 14H1z" fill="none" stroke="currentColor" strokeLinejoin="round" />
          <path d="M8 6v4" stroke="currentColor" strokeLinecap="round" />
          <circle cx="8" cy="12" r="0.75" fill="currentColor" />
        </>
      )}
      {name === 'info' && (
        <>
          <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" />
          <path d="M8 7v4.5" stroke="currentColor" strokeLinecap="round" />
          <circle cx="8" cy="4.75" r="0.75" fill="currentColor" />
        </>
      )}
      {name === 'check' && (
        <path
          d="M3 8.5 6.5 12 13 4.5"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}
