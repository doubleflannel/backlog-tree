import blessed from 'neo-neo-bblessed';
import { safeText } from './project.js';
export function dimensions(width, height) {
  const sidebar = Math.min(32, Math.max(20, Math.floor(width * 0.20)));
  const taskWidth = width - sidebar;
  const done = Math.floor(taskWidth * 0.30);
  return { sidebar, active: taskWidth - done, done, height: Math.max(1, height - 5), narrow: width < 90 || height < 15 };
}
export function fit(text, width) {
  const value = safeText(text); const max = Math.max(0, width);
  if (blessed.unicode.strWidth(value) <= max) return value;
  let result = ''; let used = 0;
  for (const char of value) { const n = blessed.unicode.strWidth(char); if (used + n > max - 1) break; result += char; used += n; }
  return max ? `${result}…` : '';
}
export const escape = text => blessed.helpers.escape(String(text));

export function statusSymbol(task) {
  if (task.done) return '✓';
  if (task.todo) return '●';
  if (/^in progress$/i.test(task.status)) return '◐';
  if (/^blocked$/i.test(task.status)) return '!';
  return `[${task.status}]`;
}

// Keep progress visible even when a long initiative title is clipped.
export function compactRow(row, width) {
  if (row.group || !row.task) {
    const summary = row.group
      ? row.key.startsWith('done:') ? `${row.group.done} done` : `${row.group.done}/${row.group.total}`
      : row.summary || '';
    const suffix = summary ? ` ${summary}` : '';
    const available = Math.max(0, width - blessed.unicode.strWidth(suffix));
    let text = row.text;
    if (row.group && row.task) {
      const symbol = statusSymbol(row.task);
      const alert = row.attention && symbol !== '!' ? ' !' : '';
      const context = row.detail?.includes(' · context') ? '(parent) ' : '';
      text = text.replace(/^([▾▸] )/, `$1${symbol}${alert} ${row.task.id} ${context}`);
    }
    const title = fit(text, available);
    return title + ' '.repeat(Math.max(0, available - blessed.unicode.strWidth(title))) + suffix;
  }
  const task = row.task;
  const prefix = row.text.slice(0, -task.title.length).replace(/● $/, '');
  const symbol = statusSymbol(task);
  const alert = row.attention && symbol !== '!' ? ' !' : '';
  return fit(`${prefix}${symbol}${alert} ${task.id} ${row.context ? '(parent) ' : ''}${task.title}`, width);
}
