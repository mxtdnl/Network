// Lets the member panel hand keyboard focus back to the member's node on the
// map when it closes (Escape), so keyboard users keep their place.

type Focuser = (memberId: string) => boolean;

let focuser: Focuser | null = null;

export function registerMapFocus(f: Focuser | null): void {
  focuser = f;
}

/** Focuses the member's node on the map; false when the map is not showing. */
export function focusMapMember(memberId: string): boolean {
  return focuser?.(memberId) ?? false;
}
