import type { RawRecordedEvent, Workflow, WorkflowStep } from '../shared/types';
import { generateId } from '../shared/utils';

// ──────────────────────────────────────────────
// Build a Workflow from raw recorded events
// ──────────────────────────────────────────────

export function buildWorkflow(
  rawEvents: RawRecordedEvent[],
  tabRefMap: Record<number, { ref: string; url: string; title: string }>
): Workflow {
  const steps: WorkflowStep[] = [];
  const tabRefs: Workflow['tabRefs'] = {};

  // Build tabRefs dict
  for (const [, info] of Object.entries(tabRefMap)) {
    tabRefs[info.ref] = { url: info.url, title: info.title };
  }

  let currentTabRef: string | null = null;

  for (const event of rawEvents) {
    // Resolve tab ref for this event
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

    // Convert raw event to clean step
    const step = eventToStep(event, tabRef);
    if (step) {
      steps.push(step);
    }
  }

  return {
    id: generateId('wf'),
    name: 'New Workflow',
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    steps,
    tabRefs,
  };
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
        valueTemplate: event.value ?? '',
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
        saveAs: event.saveAs ?? generateVarName(event),
        description: `Extract "${event.target?.label ?? 'text'}" as {{${event.saveAs ?? 'value'}}}`,
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

function generateVarName(event: RawRecordedEvent): string {
  const label = event.target?.label ?? event.target?.placeholder ?? event.target?.ariaLabel;
  if (label) {
    return label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 30);
  }
  return `var_${Date.now().toString(36).slice(-4)}`;
}

// ──────────────────────────────────────────────
// Merge sequential fill_input events on same target
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
      // Update the last fill with the new value
      prev.value = step.value;
      prev.valueTemplate = step.valueTemplate;
      prev.description = step.description;
    } else {
      result.push(step);
    }
  }
  return result;
}
