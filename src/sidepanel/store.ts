import { create } from 'zustand';
import type {
  Workflow,
  Run,
  RawRecordedEvent,
  RecordingState,
} from '../shared/types';

interface AppState {
  // ── View routing ──
  view: 'home' | 'recording' | 'workflow-detail' | 'run';
  setView: (view: AppState['view']) => void;

  // ── Recording ──
  recordingState: RecordingState;
  recordedEvents: RawRecordedEvent[];
  eventCount: number;
  setRecordingState: (s: RecordingState) => void;
  addRecordingEvent: (event: RawRecordedEvent) => void;
  clearRecordingEvents: () => void;

  // ── Workflows ──
  workflows: Workflow[];
  selectedWorkflow: Workflow | null;
  setWorkflows: (wfs: Workflow[]) => void;
  setSelectedWorkflow: (wf: Workflow | null) => void;
  upsertWorkflow: (wf: Workflow) => void;
  removeWorkflow: (id: string) => void;

  // ── Current run ──
  currentRun: Run | null;
  setCurrentRun: (run: Run | null) => void;

  // ── Runs history ──
  runs: Run[];
  setRuns: (runs: Run[]) => void;

  // ── Variables inspector visibility ──
  showVariables: boolean;
  toggleVariables: () => void;
}

export const useStore = create<AppState>((set) => ({
  // ── View ──
  view: 'home',
  setView: (view) => set({ view }),

  // ── Recording ──
  recordingState: 'idle',
  recordedEvents: [],
  eventCount: 0,
  setRecordingState: (recordingState) => set({ recordingState }),
  addRecordingEvent: (event) =>
    set((s) => ({
      recordedEvents: [...s.recordedEvents.slice(-199), event],
      eventCount: s.eventCount + 1,
    })),
  clearRecordingEvents: () => set({ recordedEvents: [], eventCount: 0 }),

  // ── Workflows ──
  workflows: [],
  selectedWorkflow: null,
  setWorkflows: (workflows) => set({ workflows }),
  setSelectedWorkflow: (wf) => set({ selectedWorkflow: wf }),
  upsertWorkflow: (wf) =>
    set((s) => {
      const exists = s.workflows.find((w) => w.id === wf.id);
      return {
        workflows: exists
          ? s.workflows.map((w) => (w.id === wf.id ? wf : w))
          : [wf, ...s.workflows],
      };
    }),
  removeWorkflow: (id) =>
    set((s) => ({ workflows: s.workflows.filter((w) => w.id !== id) })),

  // ── Run ──
  currentRun: null,
  setCurrentRun: (run) => set({ currentRun: run }),

  // ── Runs ──
  runs: [],
  setRuns: (runs) => set({ runs }),

  // ── Variables ──
  showVariables: false,
  toggleVariables: () => set((s) => ({ showVariables: !s.showVariables })),
}));
