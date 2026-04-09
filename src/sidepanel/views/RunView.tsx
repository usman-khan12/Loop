import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { stepTypeIcon, stepDescription, formatTimestamp, formatDuration, truncate } from '../../shared/utils';
import type { RunLog, WorkflowStep } from '../../shared/types';

export default function RunView() {
  const currentRun = useStore((s) => s.currentRun);
  const selectedWorkflow = useStore((s) => s.selectedWorkflow);
  const setView = useStore((s) => s.setView);
  const [showVars, setShowVars] = useState(false);
  const logsRef = useRef<HTMLDivElement>(null);

  // Auto-scroll logs
  useEffect(() => {
    if (logsRef.current) {
      logsRef.current.scrollTop = logsRef.current.scrollHeight;
    }
  }, [currentRun?.logs.length]);

  if (!currentRun) {
    return (
      <div className="sp-root">
        <div className="sp-header">
          <button className="btn-icon" onClick={() => setView('home')}>←</button>
          <span style={{ fontWeight: 600 }}>Run</span>
          <div />
        </div>
        <div className="empty-state">
          <div className="empty-state-title">No active run</div>
          <div className="empty-state-desc">Start a workflow from the home screen.</div>
        </div>
      </div>
    );
  }

  const run = currentRun;
  const workflow = selectedWorkflow;
  const status = run.status;
  const totalSteps = workflow?.steps.length ?? 0;
  const currentStep = run.currentStepIndex;
  const progress = totalSteps > 0 ? Math.min((currentStep / totalSteps) * 100, 100) : 0;

  const statusColors = {
    idle: 'var(--color-text-tertiary)',
    running: 'var(--color-info)',
    paused: 'var(--color-warning)',
    failed: 'var(--color-error)',
    completed: 'var(--color-success)',
  };

  const statusLabels = {
    idle: 'Idle',
    running: 'Running…',
    paused: 'Paused',
    failed: 'Failed',
    completed: 'Completed ✓',
  };

  async function handlePause() {
    await chrome.runtime.sendMessage({ type: 'PAUSE_RUN', source: 'sidepanel' });
  }

  async function handleResume() {
    await chrome.runtime.sendMessage({ type: 'RESUME_RUN', source: 'sidepanel' });
  }

  async function handleStop() {
    if (!confirm('Stop this workflow run?')) return;
    await chrome.runtime.sendMessage({ type: 'STOP_RUN', source: 'sidepanel' });
    setView('home');
  }

  const variables = Object.entries(run.variables);

  return (
    <div className="sp-root">
      {/* Header */}
      <div className="sp-header">
        <button className="btn-icon" onClick={() => setView('home')} title="Home">←</button>
        <span style={{ fontWeight: 600, fontSize: 14, flex: 1, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {workflow?.name ?? 'Run'}
        </span>
        <button
          className="btn-icon"
          onClick={() => setShowVars(!showVars)}
          title="Variables"
          style={{ color: showVars ? 'var(--color-accent-purple)' : undefined }}
        >
          {'{…}'}
        </button>
      </div>

      <div className="sp-content">
        {/* Status bar */}
        <div style={{
          padding: '12px 16px',
          background: status === 'running' ? 'var(--color-info-bg)'
            : status === 'completed' ? 'var(--color-success-bg)'
            : status === 'failed' ? 'var(--color-error-bg)'
            : status === 'paused' ? 'var(--color-warning-bg)'
            : 'var(--color-bg-secondary)',
          borderBottom: '1px solid var(--color-border-light)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{
              fontSize: 13,
              fontWeight: 600,
              color: statusColors[status],
            }}>
              {status === 'running' && <span className="rec-indicator" style={{ background: 'var(--color-info)', marginRight: 6 }} />}
              {statusLabels[status]}
            </span>
            <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
              {currentStep + 1}/{totalSteps} steps
              {run.startedAt && ` · ${formatDuration(run.startedAt, run.finishedAt)}`}
            </span>
          </div>
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: `${status === 'completed' ? 100 : progress}%` }}
            />
          </div>
        </div>

        {/* Variables inspector */}
        {showVars && (
          <div style={{
            padding: '12px 16px',
            background: 'var(--gradient-accent-subtle)',
            borderBottom: '1px solid var(--color-border-light)',
          }}>
            <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-accent-purple)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 8 }}>
              Variables ({variables.length})
            </p>
            {variables.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>No variables captured yet.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {variables.map(([name, value]) => (
                  <div key={name} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                    <span className="var-chip" style={{ flexShrink: 0 }}>
                      {'{{' + name + '}}'}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--color-text-primary)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {value || <em style={{ color: 'var(--color-text-tertiary)' }}>(empty)</em>}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Step progress list */}
        {workflow && (
          <>
            <p className="sp-section-title">Steps</p>
            <div>
              {workflow.steps.map((step, idx) => (
                <RunStepRow
                  key={step.id}
                  step={step}
                  index={idx}
                  currentIndex={currentStep}
                  runStatus={status}
                  logs={run.logs.filter((l) => l.stepId === step.id)}
                />
              ))}
            </div>
          </>
        )}

        {/* Logs */}
        <p className="sp-section-title">Console</p>
        <div
          ref={logsRef}
          style={{
            padding: '4px 16px 16px',
            maxHeight: 220,
            overflowY: 'auto',
          }}
        >
          {run.logs.length === 0 ? (
            <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>No logs yet.</p>
          ) : (
            run.logs.map((log, i) => <LogLine key={i} log={log} />)
          )}
        </div>
      </div>

      {/* Controls */}
      {(status === 'running' || status === 'paused') && (
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--color-border-light)', display: 'flex', gap: 8, flexShrink: 0 }}>
          {status === 'running' ? (
            <button className="btn-secondary" onClick={handlePause} id="btn-pause-run">
              ⏸ Pause
            </button>
          ) : (
            <button className="btn-primary" onClick={handleResume} id="btn-resume-run">
              ▶ Resume
            </button>
          )}
          <button className="btn-danger" style={{ flex: '0 0 auto', width: 'auto', padding: '9px 16px' }} onClick={handleStop} id="btn-stop-run">
            ⏹ Stop
          </button>
        </div>
      )}

      {(status === 'completed' || status === 'failed') && (
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--color-border-light)', flexShrink: 0 }}>
          <button className="btn-secondary" onClick={() => setView('home')}>
            ← Back to Workflows
          </button>
        </div>
      )}
    </div>
  );
}

function RunStepRow({
  step,
  index,
  currentIndex,
  runStatus,
  logs,
}: {
  step: WorkflowStep;
  index: number;
  currentIndex: number;
  runStatus: string;
  logs: RunLog[];
}) {
  const isRunning = index === currentIndex && runStatus === 'running';
  const isDone = index < currentIndex;
  const hasFailed = isDone && logs.some((l) => l.level === 'error');
  const isCurrentFailed = index === currentIndex && runStatus === 'failed';
  const isPaused = index === currentIndex && runStatus === 'paused';

  const statusClass = isRunning
    ? 'running'
    : hasFailed || isCurrentFailed
    ? 'error'
    : isDone
    ? 'success'
    : '';

  const statusIcon = isRunning
    ? '⏳'
    : hasFailed || isCurrentFailed
    ? '❌'
    : isDone
    ? '✅'
    : isPaused
    ? '⏸'
    : '○';

  const desc = step.description ?? stepDescription(step);
  const icon = stepTypeIcon(step.type);

  return (
    <div className={`step-item ${statusClass}`}>
      <span style={{
        fontSize: 9,
        fontWeight: 700,
        color: 'var(--color-text-tertiary)',
        width: 16,
        flexShrink: 0,
        textAlign: 'center',
        marginTop: 3,
      }}>
        {index + 1}
      </span>
      <span className="step-icon">{icon}</span>
      <div className="step-body">
        <div className="step-desc" title={desc}>{truncate(desc, 65)}</div>
        {step.saveAs && (
          <span className="var-chip" style={{ marginTop: 3, display: 'inline-flex', fontSize: 10 }}>
            {'{{' + step.saveAs + '}}'}
          </span>
        )}
      </div>
      <span className="step-status">{statusIcon}</span>
    </div>
  );
}

function LogLine({ log }: { log: RunLog }) {
  return (
    <div className="log-line">
      <span className="log-time">{formatTimestamp(log.timestamp)}</span>
      <span className={`log-level-${log.level}`}>{log.message}</span>
    </div>
  );
}
