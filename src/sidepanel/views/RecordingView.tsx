import { useEffect, useRef } from 'react';
import { useStore } from '../store';
import { stepDescription, stepTypeIcon, formatTimestamp } from '../../shared/utils';
import type { RawRecordedEvent } from '../../shared/types';

export default function RecordingView() {
  const setView = useStore((s) => s.setView);
  const recordedEvents = useStore((s) => s.recordedEvents);
  const eventCount = useStore((s) => s.eventCount);
  const upsertWorkflow = useStore((s) => s.upsertWorkflow);
  const setSelectedWorkflow = useStore((s) => s.setSelectedWorkflow);
  const clearRecordingEvents = useStore((s) => s.clearRecordingEvents);

  const feedRef = useRef<HTMLDivElement>(null);
  const startRef = useRef(Date.now());
  const timerRef = useRef<HTMLSpanElement>(null);

  // Tick the timer without React re-renders
  useEffect(() => {
    const interval = setInterval(() => {
      if (!timerRef.current) return;
      const secs = Math.floor((Date.now() - startRef.current) / 1000);
      const m = Math.floor(secs / 60);
      const s = secs % 60;
      timerRef.current.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Auto-scroll feed
  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [recordedEvents]);

  async function handleStop() {
    try {
      const result = await chrome.runtime.sendMessage({
        type: 'STOP_RECORDING',
        source: 'sidepanel',
      }) as { success: boolean; workflow?: { id: string; name: string; steps: unknown[] } };

      if (result?.workflow) {
        upsertWorkflow(result.workflow as never);
        setSelectedWorkflow(result.workflow as never);
        clearRecordingEvents();
        setView('workflow-detail');
      } else {
        setView('home');
      }
    } catch (err) {
      console.error('Stop recording error:', err);
      setView('home');
    }
  }

  return (
    <div className="sp-root">
      {/* Header */}
      <div className="sp-header">
        <div className="sp-logo">
          <span className="rec-indicator" />
          <span style={{ fontWeight: 600, fontSize: 14, marginLeft: 6 }}>Recording…</span>
        </div>
        <span
          ref={timerRef}
          style={{
            fontFamily: 'monospace',
            fontSize: 'var(--font-size-md)',
            color: 'var(--color-recording)',
            fontWeight: 600,
          }}
        >
          00:00
        </span>
      </div>

      {/* Content */}
      <div className="sp-content" style={{ display: 'flex', flexDirection: 'column' }}>
        {/* Stats + hint bar */}
        <div style={{
          padding: '10px 16px',
          background: 'var(--color-recording-bg)',
          borderBottom: '1px solid #FECACA',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-recording)', fontWeight: 500 }}>
              {eventCount} action{eventCount !== 1 ? 's' : ''} captured
            </span>
          </div>
          <p style={{
            fontSize: 11,
            color: '#D97070',
            lineHeight: 1.5,
            margin: 0,
          }}>
            💡 <strong>Copy</strong> from a source tab, then <strong>paste</strong> into a form — Loop auto-detects variables.
          </p>
        </div>

        {/* Event feed */}
        <p className="sp-section-title">Captured Actions</p>

        <div
          ref={feedRef}
          style={{ flex: 1, overflowY: 'auto', padding: '0 0 16px' }}
        >
          {recordedEvents.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon" style={{ fontSize: 28 }}>🖱️</div>
              <div className="empty-state-title" style={{ fontSize: 13 }}>No actions yet</div>
              <div className="empty-state-desc">
                Click, type, and interact with the page. Your actions will appear here.
              </div>
            </div>
          ) : (
            recordedEvents.map((event, i) => (
              <RecordingEventRow key={event.id} event={event} index={i} />
            ))
          )}
        </div>
      </div>

      {/* Stop button */}
      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--color-border-light)', flexShrink: 0 }}>
        <button className="btn-danger" onClick={handleStop} id="btn-stop-recording">
          ⏹ Stop & Save
        </button>
      </div>
    </div>
  );
}

function RecordingEventRow({ event, index }: { event: RawRecordedEvent; index: number }) {
  const icon = event.type === 'extract_text' ? '📋' : stepTypeIcon(event.type);
  const isExtract = event.type === 'extract_text';

  const desc = isExtract
    ? `Copied "${(event.value ?? '').slice(0, 30)}${(event.value?.length ?? 0) > 30 ? '…' : ''}"`
    : stepDescription({
        type: event.type,
        target: event.target as { text?: string; label?: string; kind?: string; placeholder?: string },
        url: event.url,
        saveAs: event.saveAs,
        value: event.value,
        valueTemplate: event.value,
      });

  return (
    <div
      className="step-item animate-fade-in"
      style={{
        animationDelay: `${Math.min(index * 20, 200)}ms`,
        background: isExtract ? 'var(--gradient-accent-subtle)' : undefined,
      }}
    >
      <span className="step-icon">{icon}</span>
      <div className="step-body">
        <div className="step-desc" title={desc}>{desc}</div>
        {isExtract && (
          <span style={{
            fontSize: 10,
            color: 'var(--color-accent-purple)',
            fontWeight: 500,
          }}>
            → will become a variable
          </span>
        )}
        <div className="step-meta">{formatTimestamp(event.timestamp)}</div>
      </div>
    </div>
  );
}
