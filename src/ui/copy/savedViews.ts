// Wording for saved views and presentation mode (spec §8). Sentence case; a
// button's verb and its confirmation match (spec §12, "Copy").

export const savedViewsCopy = {
  tab: 'Views',
  heading: 'Saved views',
  intro:
    'A saved view keeps the weights, filters, layout, node positions and pins, selection and encodings on the map. Present steps through them in this order.',
  empty: 'No saved views yet. Set up the map, then save it as a view.',
  noProject: 'Saved views appear here once you add data.',
  nameLabel: 'Name of the new view',
  save: 'Save view',
  saved: (name: string) => `View saved: ${name}`,
  defaultName: (k: number) => `View ${String(k)}`,
  count: (n: number) => (n === 1 ? '1 saved view' : `${String(n)} saved views`),
  list: 'Saved views, in presentation order',
  name: 'Name',
  caption: 'Caption',
  captionHelp:
    'Each caption is shown under the map when presenting. About 60 characters per line reads well from the back of a room.',
  captionHidden:
    'Names are hidden, so names and captions are shown with codes and cannot be edited. Show names to edit them.',
  restore: 'Show',
  restoreLabel: (name: string) => `Show ${name} on the map`,
  restored: (name: string) => `View shown: ${name}`,
  rename: 'Rename',
  renameLabel: (name: string) => `Rename ${name}`,
  renameSave: 'Save name',
  renameCancel: 'Cancel',
  nameRequired: 'Enter a name for the view.',
  update: 'Update',
  updateLabel: (name: string) => `Update ${name} to the map as it is now`,
  updated: (name: string) => `View updated: ${name}`,
  order: (name: string) => `Order of ${name}`,
  moveUp: (name: string) => `Move ${name} up`,
  moveDown: (name: string) => `Move ${name} down`,
  delete: 'Delete',
  deleteLabel: (name: string) => `Delete ${name}`,
  deleteTitle: 'Delete this view?',
  deleteBody: (name: string) => `${name} and its caption will be removed from the project.`,
  deleteConfirm: 'Delete view',
  deleted: (name: string) => `View deleted: ${name}`,
  cancel: 'Cancel',
  position: (k: number, n: number) => `${String(k)} of ${String(n)}`,
  present: 'Present',
  presentHelp: 'Save at least one view to present.',
} as const;

export const presentationCopy = {
  region: 'Presentation',
  counter: (k: number, n: number) => `${String(k)} of ${String(n)}`,
  instructions:
    'Presentation mode. Right arrow, Page down or Space for the next view; left arrow or Page up for the previous one; Home and End for the first and last; Escape to leave.',
  controls: 'Presentation controls',
  previous: 'Previous view',
  next: 'Next view',
  exit: 'Leave presentation',
  noViews: 'Save a view first: presentation mode steps through saved views.',
} as const;
