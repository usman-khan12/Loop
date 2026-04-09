// ============================================================
// Target Element Model
// ============================================================

export type ElementKind =
  | 'button'
  | 'input'
  | 'link'
  | 'table_cell'
  | 'select'
  | 'textarea'
  | 'generic';

export interface TargetDescriptor {
  kind: ElementKind;
  selectorCandidates: string[];
  xpathCandidates: string[];
  label?: string;
  text?: string;
  placeholder?: string;
  ariaLabel?: string;
  containerText?: string;
  tagName: string;
  attributes: Record<string, string>;
}

// ============================================================
// Workflow Step Types
// ============================================================

export type StepType =
  | 'open_url'
  | 'focus_tab'
  | 'wait_for_url'
  | 'wait_for_element'
  | 'click'
  | 'fill_input'
  | 'select_option'
  | 'extract_text'
  | 'extract_value'
  | 'save_variable'
  | 'submit_form'
  | 'delay'
  | 'assert_text_present';

export interface WorkflowStep {
  id: string;
  type: StepType;
  target?: TargetDescriptor;
  tabRef?: string;
  url?: string;
  value?: string;
  valueTemplate?: string;
  saveAs?: string;
  timeout?: number;
  description?: string;
  /** For batch mode — which row field this step reads */
  rowField?: string;
}

// ============================================================
// Workflow
// ============================================================

export interface TabRefInfo {
  url: string;
  title: string;
}

export interface Workflow {
  id: string;
  name: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  steps: WorkflowStep[];
  tabRefs: Record<string, TabRefInfo>;
}

// ============================================================
// Run
// ============================================================

export type RunStatus = 'idle' | 'running' | 'paused' | 'failed' | 'completed';

export interface RunLog {
  stepId: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
  data?: unknown;
}

export interface Run {
  id: string;
  workflowId: string;
  status: RunStatus;
  startedAt: string;
  finishedAt?: string;
  currentStepIndex: number;
  variables: Record<string, string>;
  logs: RunLog[];
  batchIndex?: number;
  batchTotal?: number;
}

// ============================================================
// Recording
// ============================================================

export interface RawRecordedEvent {
  id: string;
  type: StepType;
  timestamp: string;
  tabId: number;
  tabRef?: string;
  url: string;
  target?: TargetDescriptor;
  value?: string;
  saveAs?: string;
}

export type RecordingState = 'idle' | 'recording' | 'processing';

// ============================================================
// Messages
// ============================================================

export type MessageSource = 'sidepanel' | 'popup' | 'content' | 'background';

export type MessageType =
  | 'START_RECORDING'
  | 'STOP_RECORDING'
  | 'RECORDING_EVENT'
  | 'GET_STATE'
  | 'STATE_UPDATE'
  | 'RUN_WORKFLOW'
  | 'PAUSE_RUN'
  | 'RESUME_RUN'
  | 'STOP_RUN'
  | 'EXECUTE_STEP'
  | 'STEP_RESULT'
  | 'CONTENT_SCRIPT_READY'
  | 'INJECT_CONTENT_SCRIPT'
  | 'MARK_VARIABLE_MODE'
  | 'VARIABLE_MARKED'
  | 'HIGHLIGHT_ELEMENT'
  | 'CLEAR_HIGHLIGHT';

export interface Message {
  type: MessageType;
  payload?: unknown;
  source: MessageSource;
}

export interface StepResult {
  stepId: string;
  success: boolean;
  extractedValue?: string;
  error?: string;
}

// ============================================================
// Background State (the single source of truth at runtime)
// ============================================================

export interface BackgroundState {
  recordingState: RecordingState;
  recordedEvents: RawRecordedEvent[];
  currentRun: Run | null;
  automationWindowId: number | null;
  automationTabMap: Record<string, number>; // tabRef -> actual tabId
}
