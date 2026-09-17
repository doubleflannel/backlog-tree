import { box } from 'neo-neo-bblessed';
import { compactRow, escape } from './layout.js';

// One compact terminal line and one selection per task or initiative.
export class TreePane {
  constructor(screen, label, onSelect, onToggle, onFocus) {
    this.box = box({ parent: screen, label: ` ${label} `, border: 'line', tags: true, mouse: true, keys: false,
      style: { fg: 'white', border: { fg: 'gray' } }, wrap: false });
    this.rows = []; this.selected = 0; this.top = 0; this.active = false;
    this.onSelect = onSelect; this.onToggle = onToggle; this.onFocus = onFocus;
    this.box.on('click', data => {
      this.onFocus();
      const pos = this.box.lpos;
      if (!pos) return;
      const line = data.y - pos.yi - 1 + this.top;
      const index = this.lineOwners[line];
      if (index == null) return;
      this.selected = index; this.onSelect(this.current());
      const row = this.current();
      const arrow = row?.text.search(/[▾▸]/) ?? -1;
      if (row?.expandable && this.lineParts[line] === 'title' && data.x - pos.xi - 1 === arrow) this.onToggle();
    });
    this.box.on('wheelup', () => { this.onFocus(); this.move(-1); });
    this.box.on('wheeldown', () => { this.onFocus(); this.move(1); });
  }
  current() { return this.rows[this.selected]; }
  setRows(rows) {
    const key = this.current()?.key;
    this.rows = rows;
    const found = rows.findIndex(r => r.key === key);
    this.selected = found >= 0 ? found : Math.min(this.selected, Math.max(0, rows.length - 1));
  }
  move(delta) {
    this.selected = Math.max(0, Math.min(this.rows.length - 1, this.selected + delta));
    this.onSelect(this.current());
  }
  render() {
    const width = Math.max(1, Number(this.box.width) - 3);
    const height = Math.max(1, Number(this.box.height) - 2);
    const lines = []; this.lineOwners = []; this.lineParts = []; const starts = [];
    const add = (text, color, selected, owner, part) => {
      const value = escape(text);
      lines.push(selected ? `{cyan-bg}{black-fg}${value}{/black-fg}{/cyan-bg}` : color ? `{${color}-fg}${value}{/${color}-fg}` : value);
      this.lineOwners.push(owner); this.lineParts.push(part);
    };
    this.rows.forEach((row, i) => {
      starts.push(lines.length);
      const selected = this.active && i === this.selected;
      add(compactRow(row, width), row.group ? 'cyan' : row.context ? 'gray' : row.attention ? 'yellow' : null, selected, i, 'title');
    });
    const start = starts[this.selected] ?? 0;
    const end = starts[this.selected + 1] ?? lines.length;
    if (start < this.top) this.top = start;
    if (end > this.top + height) this.top = Math.max(start, end - height);
    this.top = Math.max(0, Math.min(this.top, Math.max(0, lines.length - height)));
    this.box.style.border.fg = this.active ? 'cyan' : 'gray';
    this.box.setContent(lines.slice(this.top, this.top + height).join('\n') || '  No tasks here.');
  }
}
