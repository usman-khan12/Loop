
import { useStore } from '../store';
import { formatDateTime, truncate } from '../../shared/utils';
import type { Workflow } from '../../shared/types';

export default function HomeView() {
  const workflows = useStore((s) => s.workflows);
  const setView = useStore((s) => s.setView);
  const setSelectedWorkflow = useStore((s) => s.setSelectedWorkflow);
  const currentRun = useStore((s) => s.currentRun);

  async function handleStartRecording() {
    try {
      await chrome.runtime.sendMessage({ type: 'START_RECORDING', source: 'sidepanel' });
      useStore.getState().setRecordingState('recording');
      useStore.getState().clearRecordingEvents();
      setView('recording');
    } catch (err) {
      console.error('Failed to start recording:', err);
    }
  }

  async function handleRunWorkflow(wf: Workflow) {
    setSelectedWorkflow(wf);
    try {
      await chrome.runtime.sendMessage({
        type: 'RUN_WORKFLOW',
        source: 'sidepanel',
        payload: { workflow: wf },
      });
      setView('run');
    } catch (err) {
      console.error('Failed to start workflow:', err);
    }
  }

  function handleViewWorkflow(wf: Workflow) {
    setSelectedWorkflow(wf);
    setView('workflow-detail');
  }

  async function handleDeleteWorkflow(wf: Workflow) {
    if (!confirm(`Delete "${wf.name}"?`)) return;
    await chrome.runtime.sendMessage({
      type: 'DELETE_WORKFLOW' as never,
      source: 'sidepanel',
      payload: { id: wf.id },
    });
    useStore.getState().removeWorkflow(wf.id);
  }

  return (
    <div className="sp-root">
      {/* Header */}
      <div className="sp-header">
        <div className="sp-logo">
          <div className="sp-logo-mark">🔁</div>
          <span className="sp-logo-text">Loop</span>
        </div>
        {currentRun && (currentRun.status === 'running' || currentRun.status === 'paused') && (
          <button
            className="btn btn-secondary btn-sm"
            style={{ width: 'auto', padding: '5px 10px' }}
            onClick={() => setView('run')}
          >
            ▶ View Run
          </button>
        )}
      </div>

      {/* Content */}
      <div className="sp-content">
        {/* Record CTA */}
        <div style={{ padding: '16px 16px 0' }}>
          <button className="btn-primary" onClick={handleStartRecording} id="btn-start-recording">
            <span>⏺</span> Start Recording
          </button>
        </div>

        {/* Description */}
        <p style={{
          padding: '10px 16px 0',
          fontSize: 'var(--font-size-sm)',
          color: 'var(--color-text-tertiary)',
          lineHeight: '1.5',
        }}>
          Record your actions across browser tabs, then replay them automatically.
        </p>

        {/* Divider */}
        <div style={{ height: 1, background: 'var(--color-border-light)', margin: '16px 0 0' }} />

        {/* Saved workflows */}
        <p className="sp-section-title">Saved Workflows ({workflows.length})</p>

        {workflows.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📋</div>
            <div className="empty-state-title">No workflows yet</div>
            <div className="empty-state-desc">
              Click "Start Recording" to record your first workflow.
            </div>
          </div>
        ) : (
          <div style={{ padding: '0 12px 16px' }}>
            {workflows.map((wf) => (
              <WorkflowCard
                key={wf.id}
                workflow={wf}
                onRun={() => handleRunWorkflow(wf)}
                onView={() => handleViewWorkflow(wf)}
                onDelete={() => handleDeleteWorkflow(wf)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function WorkflowCard({
  workflow,
  onRun,
  onView,
  onDelete,
}: {
  workflow: Workflow;
  onRun: () => void;
  onView: () => void;
  onDelete: () => void;
}) {
  const tabCount = Object.keys(workflow.tabRefs).length;
  const stepCount = workflow.steps.length;
  const varSteps = workflow.steps.filter(
    (s) => s.type === 'extract_text' || s.type === 'save_variable'
  );

  return (
    <div className="card" style={{ marginBottom: 10, cursor: 'default' }}>
      {/* Top */}
      <div
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}
      >
        <div
          style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
          onClick={onView}
          title="View workflow"
        >
          <div style={{
            fontSize: 'var(--font-size-md)',
            fontWeight: 600,
            color: 'var(--color-text-primary)',
            marginBottom: 3,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {truncate(workflow.name, 36)}
          </div>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)' }}>
            {stepCount} steps · {tabCount} tab{tabCount !== 1 ? 's' : ''}
            {varSteps.length > 0 && ` · ${varSteps.length} variable${varSteps.length !== 1 ? 's' : ''}`}
          </div>
        </div>
        <button
          className="btn-icon"
          onClick={onDelete}
          title="Delete"
          style={{ marginLeft: 8 }}
        >
          🗑
        </button>
      </div>

      {/* Tags */}
      {varSteps.length > 0 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 10 }}>
          {varSteps.slice(0, 4).map((s) => (
            <span key={s.id} className="var-chip">
              {'{{'}{s.saveAs ?? '?'}{'}}'}
            </span>
          ))}
        </div>
      )}

      {/* Run button */}
      <button
        className="btn-primary"
        style={{ fontSize: 'var(--font-size-sm)', padding: '7px 12px' }}
        onClick={onRun}
        id={`btn-run-${workflow.id}`}
      >
        ▶ Run Workflow
      </button>

      <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', marginTop: 8, textAlign: 'right' }}>
        Created {formatDateTime(workflow.createdAt)}
      </div>
    </div>
  );
}
