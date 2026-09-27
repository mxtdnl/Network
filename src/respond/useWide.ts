import { useEffect, useState } from 'react';

// The compact rating table appears from the --respond-wide token upward; below
// it the survey shows one colleague at a time (spec §15.4). CSS custom
// properties cannot be used inside @media, so the width is read from the token.
function query(): MediaQueryList | null {
  const width = getComputedStyle(document.documentElement)
    .getPropertyValue('--respond-wide')
    .trim();
  return width ? window.matchMedia(`(min-width: ${width})`) : null;
}

export function useWide(): boolean {
  const [wide, setWide] = useState(() => query()?.matches ?? false);
  useEffect(() => {
    const mq = query();
    if (!mq) return;
    const update = () => {
      setWide(mq.matches);
    };
    update();
    mq.addEventListener('change', update);
    return () => {
      mq.removeEventListener('change', update);
    };
  }, []);
  return wide;
}
