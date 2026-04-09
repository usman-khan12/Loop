import { useState } from 'react';
import { useStore } from '../store';
import { stepDescription, stepTypeIcon, truncate } from '../../shared/utils';
import type { Run, Workflow, WorkflowStep } from '../../shared/types';

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

/** Collect all variable-related steps from a workflow */
function collectVariables(steps: WorkflowStep[]): {
  name: string;
  sourceStep?: WorkflowStep;  // extract_text
  usingSteps: WorkflowStep[]; // fill_input using {{name}}
}[] {
  const vars = new Map<string, { sourceStep?: WorkflowStep; usingSteps: WorkflowStep[] }>();

  for (const step of steps) {
    // extract_text / save_variable steps define variables
    if ((step.type === 'extract_text' || step.type === 'save_variable') && step.saveAs) {
      if (!vars.has(step.saveAs)) vars.set(step.saveAs, { usingSteps: [] });
      vars.get(step.saveAs)!.sourceStep = step;
    }

    // fill_input steps that use a {{template}} consume variables
    if (step.type === 'fill_input' && step.valueTemplate) {
      const matches = [...step.valueTemplate.matchAll(/\{\{(\w+)\}\}/g)];
      for (const m of matches) {
        const varName = m[1];
        if (!vars.has(varName)) vars.set(varName, { usingSteps: [] });
        vars.get(varName)!.usingSteps.push(step);
      }
    }

    // fill_input steps with a saveAs (auto-named field variable)
    if (step.type === 'fill_input' && step.saveAs && !step.valueTemplate?.includes('{{')) {
      if (!vars.has(step.saveAs)) vars.set(step.saveAs, { usingSteps: [step] });
    }
  }

  return [...vars.entries()].map(([name, data]) => ({ name, ...data }));
}

// ──────────────────────────────────────────────
// Main component
// ──────────────────────────────────────────────

export default function WorkflowDetail() {
  const workflow = useStore((s) => s.selectedWorkflow);
  const setView = useStore((s) => s.setView);
  const upsertWorkflow = useStore((s) => s.upsertWorkflow);
  const setSelectedWorkflow = useStore((s) => s.setSelectedWorkflow);
  const setCurrentRun = useStore((s) => s.setCurrentRun);
  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState(workflow?.name ?? '');
  const [activeTab, setActiveTab] = useState<'steps' | 'variables'>('steps');

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

  const variables = collectVariables(workflow.steps);
  const hasVariables = variables.length > 0;

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
    setSelectedWorkflow(updated);
    await chrome.runtime.sendMessage({
      type: 'SAVE_WORKFLOW' as never,
      source: 'sidepanel',
      payload: updated,
    });
    setEditingName(false);
  }

  async function handleRun() {
    const wf = useStore.getState().selectedWorkflow!;
    const result = await chrome.runtime.sendMessage({
      type: 'RUN_WORKFLOW',
      source: 'sidepanel',
      payload: { workflow: wf },
    }) as { success: boolean; run?: Run };

    if (result?.run) {
      setCurrentRun(result.run);
    }
    setView('run');
  }

  /** Rename a variable across all steps that use/produce it */
  async function handleRenameVar(oldName: string, newName: string) {
    const clean = newName.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_|_$/g, '');
    if (!clean || clean === oldName) return;

    const wf = workflow!;
    const updatedSteps = wf.steps.map((step): WorkflowStep => {
      let s = { ...step };
      if (s.saveAs === oldName) s = { ...s, saveAs: clean };
      if (s.valueTemplate) {
        s = { ...s, valueTemplate: s.valueTemplate.replaceAll(`{{${oldName}}}`, `{{${clean}}}`) };
      }
      if (s.description) {
        s = { ...s, description: s.description.replaceAll(`{{${oldName}}}`, `{{${clean}}}`) };
      }
      return s;
    });

    const updated: Workflow = { ...wf, steps: updatedSteps, updatedAt: new Date().toISOString() };
    upsertWorkflow(updated);
    setSelectedWorkflow(updated);
    await chrome.runtime.sendMessage({
      type: 'SAVE_WORKFLOW' as never,
      source: 'sidepanel',
      payload: updated,
    });
  }

  const tabRefCount = Object.keys(workflow.tabRefs).length;

  return (
    <div className="sp-root">
      {/* Header */}
      <div className="sp-header">
        <button className="btn-icon" onClick={() => setView('home')} title="Back">←</button>
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

          <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
            <MetaBadge label={`${workflow.steps.length} steps`} color="blue" />
            <MetaBadge label={`${tabRefCount} tab${tabRefCount !== 1 ? 's' : ''}`} color="blue" />
            {hasVariables && (
              <MetaBadge label={`${variables.length} variable${variables.length !== 1 ? 's' : ''}`} color="gradient" />
            )}
          </div>
        </div>

        {/* Tabs: Steps / Variables */}
        <div style={{
          display: 'flex',
          borderBottom: '1px solid var(--color-border-light)',
          margin: '14px 0 0',
        }}>
          <TabButton active={activeTab === 'steps'} onClick={() => setActiveTab('steps')}>
            Steps
          </TabButton>
          <TabButton
            active={activeTab === 'variables'}
            onClick={() => setActiveTab('variables')}
            badge={variables.length || undefined}
          >
            Variables
          </TabButton>
        </div>

        {/* Steps tab */}
        {activeTab === 'steps' && (
          <div style={{ paddingBottom: 80 }}>
            {workflow.steps.map((step, idx) => (
              <StepRow key={step.id} step={step} index={idx} />
            ))}
          </div>
        )}

        {/* Variables tab */}
        {activeTab === 'variables' && (
          <div style={{ padding: '0 0 80px' }}>
            {variables.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon" style={{ fontSize: 28 }}>🔗</div>
                <div className="empty-state-title" style={{ fontSize: 13 }}>No variables yet</div>
                <div className="empty-state-desc">
                  Copy text from a source tab and paste it into a form field during recording — Loop will auto-detect the connection.
                </div>
              </div>
            ) : (
              <>
                <p style={{
                  fontSize: 11,
                  color: 'var(--color-text-tertiary)',
                  padding: '10px 16px 6px',
                  lineHeight: 1.5,
                }}>
                  These variables were automatically detected. Rename them to something meaningful.
                </p>
                {variables.map((v) => (
                  <VariableRow
                    key={v.name}
                    varName={v.name}
                    sourceStep={v.sourceStep}
                    usingSteps={v.usingSteps}
                    onRename={(newName) => handleRenameVar(v.name, newName)}
                  />
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {/* Run CTA */}
      <div style={{
        padding: '12px 16px',
        borderTop: '1px solid var(--color-border-light)',
        background: 'var(--color-bg)',
        position: 'sticky',
        bottom: 0,
        flexShrink: 0,
      }}>
        <button className="btn-primary" onClick={handleRun} id="btn-run-from-detail">
          ▶ Run This Workflow
        </button>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────

function MetaBadge({ label, color }: { label: string; color: 'blue' | 'gradient' }) {
  const style: React.CSSProperties = color === 'gradient'
    ? {
        display: 'inline-flex',
        padding: '3px 9px',
        borderRadius: 'var(--radius-full)',
        fontSize: 11,
        fontWeight: 500,
        background: 'var(--gradient-accent-subtle)',
        color: 'var(--color-accent-purple)',
        border: '1px solid var(--color-accent-purple-light)',
      }
    : {
        display: 'inline-flex',
        padding: '3px 9px',
        borderRadius: 'var(--radius-full)',
        fontSize: 11,
        fontWeight: 500,
        background: '#EBF3FF',
        color: 'var(--color-accent-blue)',
        border: '1px solid #C2DCF8',
      };
  return <span style={style}>{label}</span>;
}

function TabButton({
  children,
  active,
  onClick,
  badge,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  badge?: number;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        padding: '10px 8px',
        fontSize: 13,
        fontWeight: active ? 600 : 400,
        color: active ? 'var(--color-accent-blue)' : 'var(--color-text-tertiary)',
        background: 'none',
        border: 'none',
        borderBottom: active ? '2px solid var(--color-accent-blue)' : '2px solid transparent',
        cursor: 'pointer',
        fontFamily: 'var(--font-family)',
        transition: 'color var(--transition-fast)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
      }}
    >
      {children}
      {badge !== undefined && badge > 0 && (
        <span style={{
          background: 'var(--color-accent-purple)',
          color: 'white',
          borderRadius: 10,
          padding: '1px 6px',
          fontSize: 10,
          fontWeight: 600,
        }}>
          {badge}
        </span>
      )}
    </button>
  );
}

function StepRow({ step, index }: { step: WorkflowStep; index: number }) {
  const icon = stepTypeIcon(step.type);
  const desc = step.description ?? stepDescription(step);
  const hasVar = step.saveAs || (step.valueTemplate && step.valueTemplate.includes('{{'));

  return (
    <div className="step-item">
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
        <div className="step-desc" title={desc}>{truncate(desc, 68)}</div>
        {hasVar && (
          <div style={{ marginTop: 3 }}>
            {step.saveAs && step.type !== 'fill_input' && (
              <span className="var-chip">{'{{' + step.saveAs + '}}'}</span>
            )}
            {step.valueTemplate?.includes('{{') && (
              <span className="var-chip" style={{ background: '#EBF3FF', borderColor: '#C2DCF8', color: 'var(--color-accent-blue)' }}>
                {step.valueTemplate}
              </span>
            )}
          </div>
        )}
        <div className="step-meta">{step.type}</div>
      </div>
    </div>
  );
}

function VariableRow({
  varName,
  sourceStep,
  usingSteps,
  onRename,
}: {
  varName: string;
  sourceStep?: WorkflowStep;
  usingSteps: WorkflowStep[];
  onRename: (newName: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(varName);

  function save() {
    onRename(draft);
    setEditing(false);
  }

  const isLinked = !!sourceStep && usingSteps.length > 0;
  const isExtractOnly = !!sourceStep && usingSteps.length === 0;
  const isFillOnly = !sourceStep && usingSteps.length > 0;

  return (
    <div style={{
      padding: '12px 16px',
      borderBottom: '1px solid var(--color-border-light)',
    }}>
      {/* Variable name row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        {editing ? (
          <>
            <input
              className="sp-input"
              style={{ flex: 1, fontSize: 13, padding: '5px 8px' }}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
              autoFocus
              placeholder="variable_name"
            />
            <button
              className="btn-icon"
              onClick={save}
              title="Save rename"
              style={{ color: 'var(--color-success)' }}
            >
              ✓
            </button>
            <button className="btn-icon" onClick={() => setEditing(false)} title="Cancel">✕</button>
          </>
        ) : (
          <>
            <span className="var-chip" style={{ fontSize: 12 }}>{'{{' + varName + '}}'}</span>
            <button
              style={{
                marginLeft: 'auto',
                fontSize: 11,
                color: 'var(--color-accent-blue)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '2px 6px',
                borderRadius: 4,
                fontFamily: 'var(--font-family)',
              }}
              onClick={() => { setDraft(varName); setEditing(true); }}
            >
              Rename
            </button>
          </>
        )}
      </div>

      {/* Status pill */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {isLinked && (
          <span style={{
            fontSize: 10,
            padding: '2px 7px',
            borderRadius: 10,
            background: '#F0FDF4',
            color: 'var(--color-success)',
            border: '1px solid #BBF7D0',
            fontWeight: 500,
          }}>
            ✓ Auto-linked (copy → paste)
          </span>
        )}
        {isExtractOnly && (
          <span style={{
            fontSize: 10,
            padding: '2px 7px',
            borderRadius: 10,
            background: '#FFFBEB',
            color: 'var(--color-warning)',
            border: '1px solid #FDE68A',
            fontWeight: 500,
          }}>
            ⚠ Extracted but not used
          </span>
        )}
        {isFillOnly && (
          <span style={{
            fontSize: 10,
            padding: '2px 7px',
            borderRadius: 10,
            background: '#EBF3FF',
            color: 'var(--color-accent-blue)',
            border: '1px solid #C2DCF8',
            fontWeight: 500,
          }}>
            Auto-named field
          </span>
        )}
      </div>

      {/* Where it comes from / is used */}
      {sourceStep && (
        <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 5 }}>
          Source: {truncate(sourceStep.description ?? sourceStep.type, 55)}
        </div>
      )}
      {usingSteps.length > 0 && (
        <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 3 }}>
          Used in: {usingSteps.map((s) => truncate(s.description ?? s.type, 35)).join(', ')}
        </div>
      )}
    </div>
  );
}

// Need React for JSX type annotations in sub-components
import React from 'react';
