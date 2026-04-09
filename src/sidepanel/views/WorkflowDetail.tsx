import { useState } from 'react';
import { useStore } from '../store';
import { stepDescription, stepTypeIcon, truncate } from '../../shared/utils';
import type { Workflow } from '../../shared/types';

export default function WorkflowDetail() {
  const workflow = useStore((s) => s.selectedWorkflow);
  const setView = useStore((s) => s.setView);
  const upsertWorkflow = useStore((s) => s.upsertWorkflow);
  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState(workflow?.name ?? '');

  if (!workflow) {
    return (
      <div className="sp-root">
        <div className="sp-header">
          <button className="btn-icon" onClick={() => setView('home')}>←</button>
          <span style={{ fontWeight: 600 }}>Workflow</span>
          <div />
        </div>
        <div className="empty-state">
          <div className="empty-state-title">No workflow selected</div>
        </div>
      </div>
    );
  }

  async function saveName() {
    if (!nameVal.trim() || nameVal === workflow!.name) {
      setEditingName(false);
      setNameVal(workflow!.name);
      return;
    }
    const updated: Workflow = {
      ...workflow!,
      name: nameVal.trim(),
      updatedAt: new Date().toISOString(),
    };
    upsertWorkflow(updated);
    useStore.getState().setSelectedWorkflow(updated);
    await chrome.runtime.sendMessage({
      type: 'SAVE_WORKFLOW' as never,
      source: 'sidepanel',
      payload: updated,
    });
    setEditingName(false);
  }

  async function handleRun() {
    const wf = useStore.getState().selectedWorkflow!;
    await chrome.runtime.sendMessage({
      type: 'RUN_WORKFLOW',
      source: 'sidepanel',
      payload: { workflow: wf },
    });
    setView('run');
  }

  const variables = workflow.steps
    .filter((s) => (s.type === 'extract_text' || s.type === 'save_variable') && s.saveAs)
    .map((s) => s.saveAs!);

  const tabRefCount = Object.keys(workflow.tabRefs).length;

  return (
    <div className="sp-root">
      {/* Header */}
      <div className="sp-header">
        <button
          className="btn-icon"
          onClick={() => setView('home')}
          title="Back"
        >
          ←
        </button>
        <span style={{ fontWeight: 600, fontSize: 14, flex: 1, textAlign: 'center' }}>
          Workflow Detail
        </span>
        <div style={{ width: 32 }} />
      </div>

      <div className="sp-content">
        {/* Workflow name */}
        <div style={{ padding: '16px 16px 0' }}>
          {editingName ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                className="sp-input"
                value={nameVal}
                onChange={(e) => setNameVal(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') setEditingName(false); }}
                autoFocus
                id="input-workflow-name"
              />
              <button className="btn-icon" onClick={saveName} title="Save">✓</button>
            </div>
          ) : (
            <div
              style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
              onClick={() => { setEditingName(true); setNameVal(workflow.name); }}
              title="Click to rename"
            >
              <h2 style={{ fontSize: 16, fontWeight: 700, flex: 1 }}>{workflow.name}</h2>
              <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>✏️</span>
            </div>
          )}

          {/* Meta tags */}
          <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
            <span className="badge badge-blue">{workflow.steps.length} steps</span>
            <span className="badge badge-blue">{tabRefCount} tab{tabRefCount !== 1 ? 's' : ''}</span>
            {variables.length > 0 && (
              <span className="badge badge-gradient">{variables.length} variable{variables.length !== 1 ? 's' : ''}</span>
            )}
          </div>
        </div>

        {/* Variables */}
        {variables.length > 0 && (
          <>
            <p className="sp-section-title">Variables</p>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '0 16px 12px' }}>
              {variables.map((v) => (
                <span key={v} className="var-chip">
                  {'{{' + v + '}}'}
                </span>
              ))}
            </div>
          </>
        )}

        {/* Tab refs */}
        {tabRefCount > 0 && (
          <>
            <p className="sp-section-title">Tabs Used</p>
            <div style={{ padding: '0 16px 12px' }}>
              {Object.entries(workflow.tabRefs).map(([ref, info]) => (
                <div key={ref} className="card" style={{ marginBottom: 6 }}>
                  <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginBottom: 2 }}>{ref}</div>
                  <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {info.title || info.url}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {info.url}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Steps */}
        <p className="sp-section-title">Steps ({workflow.steps.length})</p>
        <div style={{ paddingBottom: 16 }}>
          {workflow.steps.map((step, idx) => {
            const icon = stepTypeIcon(step.type);
            const desc = step.description ?? stepDescription(step);
            return (
              <div key={step.id} className="step-item">
                <span style={{
                  flexShrink: 0,
                  width: 20,
                  height: 20,
                  background: 'var(--color-bg-tertiary)',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 9,
                  fontWeight: 700,
                  color: 'var(--color-text-tertiary)',
                }}>
                  {idx + 1}
                </span>
                <span className="step-icon">{icon}</span>
                <div className="step-body">
                  <div className="step-desc" title={desc}>{truncate(desc, 70)}</div>
                  {step.saveAs && (
                    <span className="var-chip" style={{ marginTop: 3, display: 'inline-flex', fontSize: 10 }}>
                      {'{{' + step.saveAs + '}}'}
                    </span>
                  )}
                  <div className="step-meta">{step.type}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Run CTA */}
      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--color-border-light)', flexShrink: 0 }}>
        <button className="btn-primary" onClick={handleRun} id="btn-run-from-detail">
          ▶ Run This Workflow
        </button>
      </div>
    </div>
  );
}
