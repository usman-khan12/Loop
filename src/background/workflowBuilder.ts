import type { RawRecordedEvent, Workflow, WorkflowStep } from '../shared/types';
import { generateId } from '../shared/utils';

// ──────────────────────────────────────────────
// Build a Workflow from raw recorded events
// ──────────────────────────────────────────────

export function buildWorkflow(
  rawEvents: RawRecordedEvent[],
  tabRefMap: Record<number, { ref: string; url: string; title: string }>
): Workflow {
  const orderedEvents = [...rawEvents].sort((a, b) => {
    const aTs = Date.parse(a.timestamp);
    const bTs = Date.parse(b.timestamp);
    return aTs - bTs;
  });

  const steps: WorkflowStep[] = [];
  const tabRefs: Workflow['tabRefs'] = {};

  for (const [, info] of Object.entries(tabRefMap)) {
    tabRefs[info.ref] = { url: info.url, title: info.title };
  }

  let currentTabRef: string | null = null;

  for (const event of orderedEvents) {
    const tabInfo = tabRefMap[event.tabId];
    const tabRef = tabInfo?.ref ?? `tab_${event.tabId}`;

    // Emit focus_tab step when tab changes
    if (tabRef !== currentTabRef) {
      steps.push({
        id: generateId('step'),
        type: 'focus_tab',
        tabRef,
        description: `Switch to ${tabInfo?.title ?? tabRef}`,
      });
      currentTabRef = tabRef;
    }

    const step = eventToStep(event, tabRef);
    if (step) steps.push(step);
  }

  const workflow: Workflow = {
    id: generateId('wf'),
    name: 'New Workflow',
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    steps,
    tabRefs,
  };

  // Post-process: auto-link copies → fills as variables
  return inferVariables(workflow);
}

// ──────────────────────────────────────────────
// Variable inference
//
// Strategy:
// 1. Find all extract_text steps (from copy events) with a literal value
// 2. For each fill_input step on a DIFFERENT tab, check if its value
//    matches any extracted value — if so, link them with a variable
// 3. For fill_input steps that have no copy-match but have a label,
//    generate a variable name from the label anyway so the workflow
//    is always parameterised (value acts as the default)
// ──────────────────────────────────────────────

function inferVariables(workflow: Workflow): Workflow {
  const steps = [...workflow.steps];

  // --- Pass 1: collect all extract_text steps keyed by their value ---
  // value → { stepId, varName }
  const extracted = new Map<string, { stepId: string; varName: string }>();

  for (const step of steps) {
    if (step.type !== 'extract_text') continue;
    if (!step.value) continue;

    // Generate a candidate variable name from the target's label
    const varName = step.saveAs ?? labelToVarName(step);
    step.saveAs = varName;
    step.description = `Extract "${step.target?.label ?? step.value.slice(0, 20)}" → {{${varName}}}`;
    extracted.set(step.value, { stepId: step.id, varName });
  }

  // --- Pass 2: for fill_input steps, link to any matching extraction ---
  for (const step of steps) {
    if (step.type !== 'fill_input') continue;
    const literalValue = step.value ?? '';

    const match = literalValue ? extracted.get(literalValue) : undefined;

    if (match) {
      // Cross-tab copy-paste — link the variable directly
      step.valueTemplate = `{{${match.varName}}}`;
      step.saveAsSource = match.stepId; // traceability
      step.description = `Fill "${step.target?.label ?? step.target?.placeholder ?? 'input'}" with {{${match.varName}}}`;
    } else {
      // No copy match — auto-generate a variable from the field label
      // so the step is still parameterisable even without extraction.
      // The valueTemplate stays as the literal value (it's both fallback and template).
      const fieldLabel = step.target?.label ?? step.target?.placeholder;
      if (fieldLabel) {
        const autoVar = fieldLabelToVarName(fieldLabel);
        // Only add a variable name if the field has a clear label
        // The valueTemplate at this point is still the literal — that's intentional
        // so replay uses the recorded value by default.
        step.saveAs = autoVar;  // marks it as "this step can be overridden"
      }
    }
  }

  return { ...workflow, steps };
}

// ──────────────────────────────────────────────
// Convert a raw recorded event to a clean step
// ──────────────────────────────────────────────

function eventToStep(event: RawRecordedEvent, tabRef: string): WorkflowStep | null {
  const id = generateId('step');

  switch (event.type) {
    case 'click':
      if (!event.target) return null;
      return {
        id,
        type: 'click',
        tabRef,
        target: event.target,
        description: `Click ${event.target.text ?? event.target.label ?? event.target.kind}`,
      };

    case 'fill_input':
      if (!event.target) return null;
      return {
        id,
        type: 'fill_input',
        tabRef,
        target: event.target,
        value: event.value ?? '',
        valueTemplate: event.value ?? '',   // literal as default; may be rewritten by inferVariables
        description: `Fill "${event.target.label ?? event.target.placeholder ?? 'input'}" with "${event.value}"`,
      };

    case 'select_option':
      if (!event.target) return null;
      return {
        id,
        type: 'select_option',
        tabRef,
        target: event.target,
        value: event.value ?? '',
        valueTemplate: event.value ?? '',
        description: `Select "${event.value}" in ${event.target.label ?? 'dropdown'}`,
      };

    case 'submit_form':
      return {
        id,
        type: 'submit_form',
        tabRef,
        target: event.target,
        description: 'Submit form',
      };

    case 'extract_text':
      return {
        id,
        type: 'extract_text',
        tabRef,
        target: event.target,
        value: event.value,          // carry the literal value for matching
        saveAs: event.saveAs,        // may be undefined — filled by inferVariables
        description: `Extract text`,
      };

    case 'open_url':
      return {
        id,
        type: 'open_url',
        tabRef,
        url: event.url,
        description: `Navigate to ${event.url}`,
      };

    default:
      return null;
  }
}

// ──────────────────────────────────────────────
// Naming helpers
// ──────────────────────────────────────────────

function labelToVarName(step: WorkflowStep): string {
  const label = step.target?.label ?? step.target?.placeholder ?? step.target?.ariaLabel;
  if (label) return fieldLabelToVarName(label);
  // Fall back to value prefix
  const v = step.value ?? '';
  return v.length > 0
    ? `var_${v.slice(0, 8).toLowerCase().replace(/[^a-z0-9]/g, '_')}`
    : `var_${Date.now().toString(36).slice(-4)}`;
}

function fieldLabelToVarName(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 30);
}

// ──────────────────────────────────────────────
// Merge sequential fill_input on same target
// ──────────────────────────────────────────────

export function mergeConsecutiveFills(steps: WorkflowStep[]): WorkflowStep[] {
  const result: WorkflowStep[] = [];
  for (const step of steps) {
    const prev = result[result.length - 1];
    if (
      step.type === 'fill_input' &&
      prev?.type === 'fill_input' &&
      step.tabRef === prev.tabRef &&
      step.target?.selectorCandidates[0] === prev.target?.selectorCandidates[0]
    ) {
      prev.value = step.value;
      prev.valueTemplate = step.valueTemplate;
      prev.description = step.description;
    } else {
      result.push(step);
    }
  }
  return result;
}
