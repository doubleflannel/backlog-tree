
const natural = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const compareTasks = (a, b) => (a.ordinal === b.ordinal ? 0 : a.ordinal < b.ordinal ? -1 : 1) || natural.compare(a.id, b.id);

export function buildModel(snapshot) {
  const nodes = new Map(snapshot.tasks.map(task => [task.key, { ...task, children: [], parent: null }]));
  const byId = new Map();
  for (const task of nodes.values()) if (!byId.has(task.id) || task.source === 'tasks') byId.set(task.id, task);
  const warnings = [];
  for (const task of nodes.values()) {
    if (task.parentId) {
      task.parent = nodes.get(`${task.source}:${task.parentId}`) || byId.get(task.parentId) || null;
      if (!task.parent) { task.unresolved = true; warnings.push(`${task.id}: missing parent ${task.parentId}`); }
    }
    if (task.personConflict) warnings.push(`${task.id}: multiple person labels`);
  }
  // Detach every member of a cycle, retaining all tasks under Unassigned.
  const cycles = new Set();
  for (const start of nodes.values()) {
    const chain = []; const at = new Map(); let node = start;
    while (node && !at.has(node.key)) { at.set(node.key, chain.length); chain.push(node); node = node.parent; }
    if (node) for (const member of chain.slice(at.get(node.key))) cycles.add(member.key);
  }
  for (const key of cycles) { const node = nodes.get(key); node.parent = null; node.unresolved = true; warnings.push(`${node.id}: cyclic parent link`); }
  for (const node of nodes.values()) if (node.parent) node.parent.children.push(node);
  for (const node of nodes.values()) node.children.sort(compareTasks);
  const roots = [...nodes.values()].filter(n => !n.parent).sort(compareTasks);
  const groups = [];
  const other = { key: '@other', title: 'Other tasks', roots: [] };
  const unresolved = { key: '@unassigned', title: 'Unassigned', roots: [] };
  for (const root of roots) {
    if (root.unresolved) unresolved.roots.push(root);
    else if (root.children.length) groups.push({ key: root.key, title: root.title, roots: [root] });
    else other.roots.push(root);
  }
  for (const group of [other, unresolved]) if (group.roots.length) groups.push(group);
  const collect = node => [node, ...node.children.flatMap(collect)];
  for (const group of groups) {
    group.tasks = group.roots.flatMap(collect);
    group.total = group.tasks.length;
    group.done = group.tasks.filter(t => t.done).length;
    group.todo = group.tasks.some(t => t.todo);
    group.activity = Math.max(0, ...group.tasks.map(t => t.activity));
  }
  return { ...snapshot, nodes, byId, groups, warnings };
}

export function orderedGroups(model, previous = [], reorder = false) {
  const sorted = [...model.groups].sort((a, b) => b.activity - a.activity || natural.compare(a.title, b.title));
  if (reorder || previous.length === 0) return sorted;
  const map = new Map(sorted.map(g => [g.key, g]));
  return [...previous.filter(key => map.has(key)).map(key => map.get(key)), ...sorted.filter(g => !previous.includes(g.key))];
}

export function attention(task, model, today = new Date().toISOString().slice(0, 10)) {
  const result = [];
  if (task.due) {
    const date = task.due.slice(0, 10);
    result.push(`${/^\d{4}-\d{2}-\d{2}$/.test(date) && date < today && !task.done ? 'OVERDUE' : 'Due'} ${task.due}`);
  }
  if (/blocked/i.test(task.status) || task.labels.some(x => /^blocked$/i.test(x))) result.push('BLOCKED');
  const waiting = task.labels.find(x => /^waiting:/i.test(x));
  if (waiting) result.push(`Waiting: ${waiting.slice(8).trim()}`);
  const unresolved = task.dependencies.filter(id => !model.byId.get(id)?.done);
  if (unresolved.length) result.push(`Depends on ${unresolved.map(id => model.byId.has(id) ? id : `${id}?`).join(', ')}`);
  if (task.unresolved) result.push('Check parent link');
  if (task.personConflict) result.push('Choose one person label');
  return result.join(' · ');
}

export function treeRows(groups, pane, collapsed, model) {
  const rows = [];
  const matches = task => pane === 'done' ? task.done : !task.done;
  const contains = task => matches(task) || task.children.some(contains);
  for (const group of groups) {
    const roots = group.roots.filter(contains);
    if (!roots.length) continue;
    const key = `${pane}:group:${group.key}`;
    // Done is collapsed by default; active is expanded by default.
    const expanded = pane === 'done' ? collapsed.has(key) : !collapsed.has(key);
    const rootTask = group.key.startsWith('@') ? null : group.roots[0];
    rows.push({ key, group, task: rootTask, expandable: true, expanded, text: `${expanded ? '▾' : '▸'} ${group.title}`, detail: pane === 'done' ? `${group.done} completed${rootTask ? ` · ${rootTask.person}${!matches(rootTask) ? ' · context' : ''}` : ''}` : `${group.done}/${group.total} done${group.todo ? ' · ● To Do' : ''}${rootTask ? ` · [${rootTask.done ? 'Done' : rootTask.status}] · ${rootTask.person}${!matches(rootTask) ? ' · context' : ''}` : ''}`, attention: rootTask && matches(rootTask) ? attention(rootTask, model) : '' });
    if (!expanded) continue;
    function visit(task, prefix, last) {
      const children = task.children.filter(contains);
      const rowKey = `${pane}:task:${task.key}`;
      const open = !collapsed.has(rowKey);
      const context = !matches(task);
      rows.push({ key: rowKey, task, expandable: children.length > 0, expanded: open,
        text: `${prefix}${last ? '└─' : '├─'} ${children.length ? open ? '▾ ' : '▸ ' : ''}${task.todo ? '● ' : ''}${task.title}`,
        detail: `${prefix}${last ? '   ' : '│  '}${task.id} · [${task.done ? 'Done' : task.status}] · ${task.person}${context ? ' · context' : ''}`,
        attention: context ? '' : attention(task, model), context,
      });
      if (open) children.forEach((child, i) => visit(child, prefix + (last ? '   ' : '│  '), i === children.length - 1));
    }
    const visible = rootTask ? rootTask.children.filter(contains) : roots;
    visible.forEach((root, i) => visit(root, '', i === visible.length - 1));
  }
  return rows;
}

export function exportPlain(model) {
  const groups = orderedGroups(model);
  const lines = [`${model.name} — Backlog Tree`, 'ACTIVE'];
  for (const row of treeRows(groups, 'active', new Set(), model)) lines.push(row.text, `  ${row.detail}`, ...(row.attention ? [`  ! ${row.attention}`] : []));
  lines.push('', 'DONE');
  const expanded = new Set(groups.map(g => `done:group:${g.key}`));
  for (const row of treeRows(groups, 'done', expanded, model)) lines.push(row.text, `  ${row.detail}`);
  if (model.warnings.length) lines.push('', ...model.warnings.map(w => `Warning: ${w}`));
  return lines.join('\n');
}
