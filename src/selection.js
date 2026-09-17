// A context ancestor can be selected in either pane. Only an actual transition
// between active and done should move the selection to another pane.
export function reconcileSelection(previous, next, focus, selectedGroup, groups, collapsed) {
  if (!previous || !next || focus === 0 || previous.done === next.done) return { focus, selectedGroup };
  const pane = next.done ? 'done' : 'active';
  const group = groups.find(g => g.tasks.some(t => t.key === next.key));
  if (group) {
    if (next.done) collapsed.add(`done:group:${group.key}`);
    else { collapsed.delete(`active:group:${group.key}`); if (selectedGroup !== '@overview') selectedGroup = group.key; }
  }
  let parent = next.parent;
  while (parent) { collapsed.delete(`${pane}:task:${parent.key}`); parent = parent.parent; }
  return { focus: next.done ? 2 : 1, selectedGroup };
}
