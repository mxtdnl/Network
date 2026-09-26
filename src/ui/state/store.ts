import { create } from 'zustand';
import { readNoticeSeen, writeNoticeSeen } from './noticeStorage';

export type CentreView = 'map' | 'matrix' | 'table' | 'compare';
export type RightPanel = 'member' | 'insights';

// Phase 1 holds only the UI slice of the state described in docs/plan.md §1.3.
export interface UiState {
  centreView: CentreView;
  rightPanel: RightPanel;
  anonymise: boolean;
  firstRunNoticeSeen: boolean;
  noticeOpen: boolean;
}

interface UiActions {
  setCentreView: (view: CentreView) => void;
  setRightPanel: (panel: RightPanel) => void;
  setAnonymise: (on: boolean) => void;
  openNotice: () => void;
  closeNotice: () => void;
}

export type AppState = { ui: UiState } & UiActions;

export function initialUiState(noticeSeen: boolean): UiState {
  return {
    centreView: 'map',
    rightPanel: 'member',
    anonymise: false,
    firstRunNoticeSeen: noticeSeen,
    noticeOpen: !noticeSeen,
  };
}

export const useAppStore = create<AppState>()((set) => ({
  ui: initialUiState(readNoticeSeen()),
  setCentreView: (centreView) => {
    set((s) => ({ ui: { ...s.ui, centreView } }));
  },
  setRightPanel: (rightPanel) => {
    set((s) => ({ ui: { ...s.ui, rightPanel } }));
  },
  setAnonymise: (anonymise) => {
    set((s) => ({ ui: { ...s.ui, anonymise } }));
  },
  openNotice: () => {
    set((s) => ({ ui: { ...s.ui, noticeOpen: true } }));
  },
  closeNotice: () => {
    writeNoticeSeen();
    set((s) => ({ ui: { ...s.ui, noticeOpen: false, firstRunNoticeSeen: true } }));
  },
}));
