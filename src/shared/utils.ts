/** Generate a short unique ID */
export function generateId(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Replace {{variable}} placeholders in a template string */
export function resolveTemplate(
  template: string,
  variables: Record<string, string>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    return variables[key] ?? `{{${key}}}`;
  });
}

/** Debounce a function */
export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  ms: number
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/** Human-readable timestamp */
export function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** Full date + time */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

/** Duration in human-readable form */
export function formatDuration(startIso: string, endIso?: string): string {
  const start = new Date(startIso).getTime();
  const end = endIso ? new Date(endIso).getTime() : Date.now();
  const ms = end - start;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

/** Truncate text */
export function truncate(text: string, max = 60): string {
  return text.length > max ? text.slice(0, max) + '…' : text;
}

/** Sleep */
export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Icon name for step types */
export function stepTypeIcon(type: string): string {
  const icons: Record<string, string> = {
    click: '👆',
    fill_input: '⌨️',
    extract_text: '📤',
    extract_value: '📤',
    focus_tab: '🔄',
    open_url: '🌐',
    wait_for_element: '⏳',
    wait_for_url: '⏳',
    select_option: '📋',
    submit_form: '🚀',
    save_variable: '💾',
    delay: '⏸',
    assert_text_present: '✅',
  };
  return icons[type] ?? '▶️';
}

/** Human-readable step description */
export function stepDescription(step: { type: string; target?: { text?: string; label?: string; kind?: string; placeholder?: string }; url?: string; saveAs?: string; valueTemplate?: string; value?: string }): string {
  switch (step.type) {
    case 'click':
      return `Click ${step.target?.text ?? step.target?.label ?? step.target?.kind ?? 'element'}`;
    case 'fill_input':
      return `Fill "${step.target?.label ?? step.target?.placeholder ?? 'input'}" with ${step.valueTemplate ?? step.value ?? '…'}`;
    case 'extract_text':
      return `Extract "${step.target?.label ?? step.target?.text ?? 'text'}" → {{${step.saveAs ?? '?'}}}`;
    case 'extract_value':
      return `Extract value → {{${step.saveAs ?? '?'}}}`;
    case 'focus_tab':
      return `Switch to tab ${step.target?.label ?? step.url ?? ''}`;
    case 'open_url':
      return `Open ${step.url ?? ''}`;
    case 'wait_for_element':
      return `Wait for ${step.target?.label ?? 'element'}`;
    case 'submit_form':
      return 'Submit form';
    case 'delay':
      return `Wait ${step.value ?? '?'}ms`;
    case 'save_variable':
      return `Save variable {{${step.saveAs ?? '?'}}}`;
    default:
      return step.type;
  }
}
