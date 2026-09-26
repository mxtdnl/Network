// Functional glyphs only (design-system §7, item 7). Drawn in currentColor.

interface IconProps {
  name:
    | 'warning'
    | 'info'
    | 'check'
    | 'plus'
    | 'minus'
    | 'fit'
    | 'close'
    | 'expand'
    | 'collapse'
    | 'chevron-up';
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
      {name === 'plus' && <path d="M8 3v10M3 8h10" stroke="currentColor" strokeLinecap="round" />}
      {name === 'minus' && <path d="M3 8h10" stroke="currentColor" strokeLinecap="round" />}
      {name === 'fit' && (
        <path
          d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {name === 'close' && (
        <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeLinecap="round" />
      )}
      {name === 'expand' && (
        <path
          d="M6 3.5 10.5 8 6 12.5"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {name === 'collapse' && (
        <path
          d="M3.5 6 8 10.5 12.5 6"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {name === 'chevron-up' && (
        <path
          d="M3.5 10 8 5.5 12.5 10"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
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
