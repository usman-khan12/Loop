import { useEffect, useState } from 'react';
import './popup.css';

type Status = 'idle' | 'recording' | 'running' | 'paused';

export default function Popup() {
  const [status, setStatus] = useState<Status>('idle');
  const [eventCount, setEventCount] = useState(0);

  useEffect(() => {
    // Get current state from background
    chrome.runtime.sendMessage({ type: 'GET_STATE', source: 'popup' })
      .then((state: { recordingState?: string; currentRun?: { status: string } }) => {
        if (!state) return;
        if (state.recordingState === 'recording') setStatus('recording');
        else if (state.currentRun?.status === 'running') setStatus('running');
        else if (state.currentRun?.status === 'paused') setStatus('paused');
        else setStatus('idle');
      })
      .catch(() => {});

    // Listen for state updates
    const listener = (msg: { type: string; payload?: { recordingState?: string; eventCount?: number; currentRun?: { status: string } } }) => {
      if (msg.type === 'STATE_UPDATE') {
        const payload = msg.payload;
        if (payload?.recordingState === 'recording') setStatus('recording');
        else if (payload?.currentRun?.status === 'running') setStatus('running');
        else if (payload?.currentRun?.status === 'paused') setStatus('paused');
        if (payload?.eventCount !== undefined) setEventCount(payload.eventCount);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  function openSidePanel() {
    chrome.runtime.sendMessage({ type: 'GET_STATE', source: 'popup' }).then(() => {
      // Side panel opens automatically via setPanelBehavior in background
    });
    window.close();
  }

  async function handleStartRecording() {
    await chrome.runtime.sendMessage({ type: 'START_RECORDING', source: 'popup' });
    setStatus('recording');
    window.close();
  }

  async function handleStopRecording() {
    await chrome.runtime.sendMessage({ type: 'STOP_RECORDING', source: 'popup' });
    setStatus('idle');
    window.close();
  }

  const statusLabel: Record<Status, string> = {
    idle: 'Ready',
    recording: `Recording${eventCount > 0 ? ` · ${eventCount} events` : ''}`,
    running: 'Running workflow',
    paused: 'Paused',
  };

  const statusColor: Record<Status, string> = {
    idle: '#22C55E',
    recording: '#EF4444',
    running: '#5B9BF7',
    paused: '#F59E0B',
  };

  return (
    <div className="popup">
      <div className="popup-header">
        <div className="popup-logo">
          <span className="gradient-text" style={{ fontWeight: 700, fontSize: 18 }}>Loop</span>
        </div>
        <div className="popup-status">
          <span
            className="status-dot"
            style={{ background: statusColor[status] }}
          />
          <span className="status-label">{statusLabel[status]}</span>
        </div>
      </div>

      <div className="popup-actions">
        {status === 'idle' && (
          <>
            <button className="btn btn-primary" onClick={handleStartRecording}>
              <span>⏺</span> Start Recording
            </button>
            <button className="btn btn-secondary" onClick={openSidePanel}>
              Open Side Panel
            </button>
          </>
        )}
        {status === 'recording' && (
          <button className="btn btn-danger" onClick={handleStopRecording}>
            <span className="rec-dot" />
            Stop Recording
          </button>
        )}
        {(status === 'running' || status === 'paused') && (
          <button className="btn btn-secondary" onClick={openSidePanel}>
            View Progress
          </button>
        )}
      </div>
    </div>
  );
}
