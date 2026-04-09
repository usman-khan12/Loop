import { useEffect } from 'react';
import { useStore } from './store';
import type { RawRecordedEvent, Run, Workflow } from '../shared/types';
import HomeView from './views/HomeView';
import RecordingView from './views/RecordingView';
import WorkflowDetail from './views/WorkflowDetail';
import RunView from './views/RunView';
import './sidepanel.css';

export default function App() {
  const view = useStore((s) => s.view);
  const setWorkflows = useStore((s) => s.setWorkflows);
  const setRuns = useStore((s) => s.setRuns);
  const setRecordingState = useStore((s) => s.setRecordingState);
  const addRecordingEvent = useStore((s) => s.addRecordingEvent);
  const upsertWorkflow = useStore((s) => s.upsertWorkflow);
  const setCurrentRun = useStore((s) => s.setCurrentRun);
  const setView = useStore((s) => s.setView);


  // ── Load initial state from background ──
  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_STATE', source: 'sidepanel' })
      .then((state: {
        workflows?: Workflow[];
        runs?: Run[];
        recordingState?: string;
        currentRun?: Run;
      }) => {
        if (!state) return;
        if (state.workflows) setWorkflows(state.workflows);
        if (state.runs) setRuns(state.runs);
        if (state.recordingState === 'recording') {
          setRecordingState('recording');
          setView('recording');
        }
        if (state.currentRun) {
          setCurrentRun(state.currentRun);
          if (state.currentRun.status === 'running' || state.currentRun.status === 'paused') {
            setView('run');
          }
        }
      })
      .catch(() => {});
  }, []);

  // ── Listen for background state updates ──
  useEffect(() => {
    function listener(msg: {
      type: string;
      payload?: {
        recordingState?: string;
        recordingEvent?: RawRecordedEvent;
        eventCount?: number;
        currentRun?: Run;
        workflow?: Workflow;
      };
    }) {
      if (msg.type !== 'STATE_UPDATE') return;
      const p = msg.payload;
      if (!p) return;

      if (p.recordingState) {
        setRecordingState(p.recordingState as 'idle' | 'recording' | 'processing');
        if (p.recordingState === 'idle') {
          // Recording stopped — refresh workflows
          chrome.runtime.sendMessage({ type: 'GET_STATE', source: 'sidepanel' })
            .then((state: { workflows?: Workflow[]; runs?: Run[] }) => {
              if (state?.workflows) setWorkflows(state.workflows);
              if (state?.runs) setRuns(state.runs);
            }).catch(() => {});
        }
      }

      if (p.recordingEvent) {
        addRecordingEvent(p.recordingEvent);
      }

      if (p.currentRun !== undefined) {
        setCurrentRun(p.currentRun);
        if (p.currentRun) {
          const s = p.currentRun.status;
          if (s === 'running' || s === 'paused') setView('run');
          if (s === 'completed' || s === 'failed') {
            // Stay on run view to show result
            chrome.runtime.sendMessage({ type: 'GET_STATE', source: 'sidepanel' })
              .then((state: { runs?: Run[] }) => {
                if (state?.runs) setRuns(state.runs);
              }).catch(() => {});
          }
        }
      }

      if (p.workflow) {
        upsertWorkflow(p.workflow);
      }
    }

    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  // ── Render view ──
  return (
    <div className="sp-root">
      {view === 'home' && <HomeView />}
      {view === 'recording' && <RecordingView />}
      {view === 'workflow-detail' && <WorkflowDetail />}
      {view === 'run' && <RunView />}
    </div>
  );
}
