import fs from 'node:fs';
import blessed, { screen as createScreen, box } from 'neo-neo-bblessed';
import { loadProject, clean, safeMultiline } from './project.js';
import { buildModel, orderedGroups, treeRows } from './model.js';
import { dimensions, fit, escape } from './layout.js';
import { reconcileSelection } from './selection.js';
import { TreePane } from './pane.js';
import { editTask, viewArgs } from './bridge.js';

export function startUI(initial, executable, version) {
  let model = buildModel(initial);
  let groups = orderedGroups(model);
  let selectedGroup = '@overview'; let focus = 1; let busy = false; let modal = false; let closed = false;
  let message = ''; let lastSignature = ''; let nativeChild = null; let terminating = false;
  const collapsed = new Set();
  const screen = createScreen({ smartCSR: true, fullUnicode: true, title: 'Backlog Tree', dockBorders: true });
  // Bind the decoder explicitly; this library's lazy listener setup can miss it.
  screen.program.bindMouse();
  const header = box({ parent: screen, top: 0, height: 2, width: '100%', tags: true });
  const footer = box({ parent: screen, bottom: 0, height: 3, width: '100%', tags: true });
  const narrow = box({ parent: screen, top: 3, left: 2, width: '100%-4', height: 4, hidden: true });
  const sidebar = new TreePane(screen, 'Initiatives', () => chooseInitiative(), () => {}, () => { focus = 0; });
  const active = new TreePane(screen, 'Active · 70%', () => render(), () => toggle(), () => { focus = 1; });
  const done = new TreePane(screen, 'Done · 30%', () => render(), () => toggle(), () => { focus = 2; });
  const panes = [sidebar, active, done];
  function focused() { return panes[focus]; }
  function visibleGroups() { return selectedGroup === '@overview' ? groups : groups.filter(g => g.key === selectedGroup); }
  function chooseInitiative() {
    if (busy || modal) return;
    selectedGroup = sidebar.current()?.key || '@overview';
    groups = orderedGroups(model, [], true);
    active.top = 0; done.top = 0;
    refreshRows(); render();
  }
  function refreshRows() {
    if (!groups.some(g => g.key === selectedGroup)) selectedGroup = '@overview';
    sidebar.setRows([{ key: '@overview', text: 'Overview', summary: `${model.tasks.filter(t => t.done).length}/${model.tasks.length}` },
      ...groups.map(g => ({ key: g.key, text: `${g.todo ? '●' : ' '} ${g.title}`, summary: `${g.done}/${g.total}` }))]);
    const sidebarIndex = sidebar.rows.findIndex(r => r.key === selectedGroup);
    sidebar.selected = Math.max(0, sidebarIndex);
    active.setRows(treeRows(visibleGroups(), 'active', collapsed, model));
    // Keep every initiative's completed history available in the parallel archive.
    done.setRows(treeRows(groups, 'done', collapsed, model));
  }
  function render() {
    if (closed || busy) return;
    const size = dimensions(Number(screen.width), Number(screen.height));
    header.setContent(`{bold}${escape(fit(`${model.name} · Backlog Tree`, Number(screen.width) - 2))}{/bold}\n${escape(fit(`${selectedGroup === '@overview' ? 'Overview' : groups.find(g => g.key === selectedGroup)?.title} · ● To Do  ◐ In progress  ✓ Done  ! Attention · counts: done/total`, Number(screen.width) - 2))}`);
    let x = 0;
    panes.forEach((pane, i) => {
      pane.box.left = x; pane.box.top = 2; pane.box.width = [size.sidebar, size.active, size.done][i]; pane.box.height = size.height;
      x += Number(pane.box.width); pane.active = focus === i;
      pane.box.hidden = size.narrow; pane.render();
    });
    narrow.hidden = !size.narrow;
    narrow.setContent('Widen this terminal to at least 90 columns and 15 rows.\nThe board needs room for the sidebar and 70/30 task panes.\nYou can also use backlog-tree --plain.');
    const row = focused().current();
    const task = row?.task;
    const detail = task ? `${task.id} [${task.done ? 'Done' : task.status}] · ${task.person} · ${task.title}` : sidebar.current()?.text || '';
    const warning = model.warnings.length ? `${model.warnings.length} metadata warning(s) · ? for details` : '';
    footer.setContent([
      escape(fit('Tab pane  ↑↓ select  Enter open  Space expand  / find  s status  p person  ? help  q quit', Number(screen.width))),
      escape(fit(detail, Number(screen.width))),
      `{yellow-fg}${escape(fit(message || row?.attention || warning || 'Live updates · order holds while reading · Enter opens full details', Number(screen.width)))}{/yellow-fg}`,
    ].join('\n'));
    screen.render();
  }
  function toggle(force) {
    if (busy || modal || focus === 0) return;
    const row = focused().current();
    if (!row?.expandable) return;
    const open = force ?? !row.expanded;
    const reversed = row.key.startsWith('done:group:');
    if (open === reversed) collapsed.add(row.key); else collapsed.delete(row.key);
    refreshRows(); render();
  }
  function reload() {
    if (busy || modal || closed) return;
    try {
      const next = loadProject(model.project);
      const signature = JSON.stringify(next.tasks.map(t => [t.key, t.text, t.activity])) + JSON.stringify(next.config);
      if (signature === lastSignature) return;
      const current = focused().current(); const taskKey = current?.task?.key;
      const nextModel = buildModel(next);
      model = nextModel; groups = orderedGroups(model, groups.map(g => g.key));
      if (taskKey && focus !== 0) {
        ({ focus, selectedGroup } = reconcileSelection(current.task, model.nodes.get(taskKey), focus, selectedGroup, groups, collapsed));
      }
      refreshRows();
      if (taskKey && focus !== 0) {
        const index = focused().rows.findIndex(r => r.task?.key === taskKey);
        if (index >= 0) focused().selected = index;
      }
      lastSignature = signature; message = ''; render();
    } catch (error) { message = `Refresh paused: ${error.message}`; render(); }
  }
  function showText(label, content) {
    modal = true;
    const view = blessed.scrollabletext({ parent: screen, top: 'center', left: 'center', width: '90%', height: '85%', label: ` ${label} · Esc to close `,
      border: 'line', padding: 1, keys: true, vi: true, mouse: true, scrollable: true, alwaysScroll: true,
      scrollbar: { ch: '│' }, tags: false, content, style: { border: { fg: 'cyan' } } });
    view.key(['escape', 'q'], () => { view.destroy(); modal = false; render(); });
    view.focus(); screen.render();
  }
  function help() {
    showText('Backlog Tree', `Open: Enter invokes your installed Backlog task viewer; q there returns here.\nCompleted-folder history opens read-only because Backlog 1.29.3 cannot open it.\n\nTab / Shift-Tab: move between panes\nArrow keys or j/k: select\nSpace: expand/collapse a family or archive initiative\nRight/Left: expand/collapse\no: return to overview\n/: find a task by title, ID or person\ns: change status through the installed CLI\np: set one person:Name label, or blank for Internal\nr: refresh files now (without reordering initiatives)\nq / Ctrl-C: quit\n\nDots mean To Do remains, not unread updates.\nAll unfinished descendants expand on startup. Done groups start collapsed.\nInitiative order refreshes on navigation, not while you read.\nRows show status and ID. ! marks dates, blockers or unfinished dependencies.\nSelect a task to see its person and attention details below. Long titles can clip; Enter opens the full task.\n\nSource: ${model.project}\nLocal task and completed folders only; canceled archive entries are excluded.\n\n${model.warnings.length ? model.warnings.join('\n') : 'No metadata warnings.'}`);
  }
  function choose(label, items, callback) {
    modal = true;
    const picker = blessed.list({ parent: screen, top: 'center', left: 'center', width: '75%', height: Math.min(items.length + 4, Number(screen.height) - 4),
      label: ` ${label} · Esc cancels `, border: 'line', keys: true, vi: true, mouse: true, tags: false, items: items.map(i => i.label),
      style: { border: { fg: 'cyan' }, selected: { bg: 'cyan', fg: 'black' } } });
    picker.key('escape', () => { picker.destroy(); modal = false; render(); });
    picker.on('select', (_item, index) => { picker.destroy(); modal = false; callback(items[index]); });
    picker.focus(); screen.render();
  }
  function prompt(label, value, callback) {
    modal = true;
    const input = blessed.prompt({ parent: screen, top: 'center', left: 'center', width: '80%', height: 8, border: 'line', tags: false,
      style: { border: { fg: 'cyan' } } });
    input.input(label, value, (error, answer) => { input.destroy(); modal = false; if (!error && answer != null) callback(answer); else render(); });
  }
  function currentLiveTask() {
    const task = focused().current()?.task;
    if (!task) { message = 'Select a task first.'; render(); return null; }
    if (task.source !== 'tasks') { message = 'Completed-folder history is read-only.'; render(); return null; }
    return task;
  }
  async function mutate(task, options) {
    busy = true;
    try { await editTask(executable, model.project, task, options); message = `${task.id} saved by Backlog.`; }
    catch (error) { message = `Could not save: ${error.message}`; }
    finally { busy = false; const result = message; reload(); message = result; render(); }
  }
  function changeStatus() {
    const task = currentLiveTask(); if (!task) return;
    const statuses = [...new Set([...model.statuses, ...model.tasks.filter(t => t.source === 'tasks').map(t => t.status)])];
    choose(`Status for ${task.id}`, statuses.map(status => ({ label: status, status })), item => { void mutate(task, ['--status', item.status]); });
  }
  function changePerson() {
    const task = currentLiveTask(); if (!task) return;
    if (task.personConflict) { message = 'Multiple person labels: resolve them in Backlog before assigning one person here.'; render(); return; }
    prompt(`Main person for ${task.id} (blank = Internal)`, task.person === 'Internal' ? '' : task.person, answer => {
      const name = clean(answer);
      if (name.includes(',')) { message = 'Use one person name without commas.'; render(); return; }
      // Refresh the exact labels before composing the native edit to preserve unrelated tags.
      try {
        const fresh = loadProject(model.project).tasks.find(t => t.key === task.key);
        if (!fresh || fresh.personConflict) throw new Error('Task changed; refresh before editing its person.');
        const options = [];
        const old = fresh.labels.find(label => /^person:/i.test(label));
        if (old) options.push('--remove-label', old);
        if (name) options.push('--add-label', `person:${name}`);
        if (options.length) void mutate(fresh, options); else render();
      } catch (error) { message = error.message; render(); }
    });
  }
  function search() {
    prompt('Find task by title, ID or person', '', answer => {
      const term = clean(answer).toLowerCase();
      if (!term) return render();
      const matches = [...model.nodes.values()].filter(t => `${t.title} ${t.id} ${t.person}`.toLowerCase().includes(term));
      if (!matches.length) { message = 'No matching tasks.'; return render(); }
      choose('Find results', matches.map(task => ({ label: `${task.id} [${task.status}] ${task.title}`, task })), item => {
        const task = item.task; const group = groups.find(g => g.tasks.some(t => t.key === task.key));
        selectedGroup = group?.key || '@overview'; groups = orderedGroups(model, [], true);
        focus = task.done ? 2 : 1;
        if (group) { if (task.done) collapsed.add(`done:group:${group.key}`); else collapsed.delete(`active:group:${group.key}`); }
        let parent = task.parent;
        while (parent) { collapsed.delete(`${task.done ? 'done' : 'active'}:task:${parent.key}`); parent = parent.parent; }
        refreshRows(); const index = focused().rows.findIndex(r => r.task?.key === task.key); if (index >= 0) focused().selected = index;
        render();
      });
    });
  }
  function open() {
    if (focus === 0) { chooseInitiative(); focus = 1; render(); return; }
    const row = focused().current();
    if (!row?.task) return toggle();
    const task = row.task;
    if (task.source === 'completed') {
      try { showText(`${task.id} · read-only history`, safeMultiline(fs.readFileSync(task.file, 'utf8'))); }
      catch (error) { message = error.message; render(); }
      return;
    }
    if (!fs.existsSync(task.file)) { message = 'Task moved or disappeared; refresh first.'; render(); return; }
    busy = true;
    const child = screen.spawn(executable, viewArgs(task), { cwd: model.project, stdio: 'inherit' });
    nativeChild = child;
    child.once('error', error => { nativeChild = null; busy = false; if (terminating) return quit(); message = `Backlog could not open: ${error.message}`; render(); });
    child.once('exit', code => { nativeChild = null; busy = false; if (terminating) return quit(); reload(); if (code) message = `Backlog exited with code ${code}.`; render(); });
  }
  function quit() { if (closed) return; closed = true; clearInterval(timer); screen.destroy(); process.off('SIGINT', signal); process.off('SIGTERM', terminate); }
  const signal = () => { if (!busy) quit(); };
  const terminate = () => {
    process.exitCode = 143;
    if (nativeChild) {
      terminating = true; nativeChild.kill('SIGTERM');
      setTimeout(() => nativeChild?.kill('SIGKILL'), 1000).unref();
    } else quit();
  };
  screen.on('keypress', (ch, key) => {
    if (busy || modal) return;
    const name = key.full || key.name;
    if (['q', 'C-c'].includes(name)) return quit();
    if (['tab', 'S-tab'].includes(name)) { focus = (focus + (name === 'tab' ? 1 : 2)) % 3; return render(); }
    if (['up', 'k'].includes(name)) return focused().move(-1);
    if (['down', 'j'].includes(name)) return focused().move(1);
    if (name === 'pageup') return focused().move(-5);
    if (name === 'pagedown') return focused().move(5);
    if (name === 'enter') return open();
    if (name === 'space') return toggle();
    if (name === 'right') return toggle(true);
    if (name === 'left') return toggle(false);
    if (name === 'o') { sidebar.selected = 0; chooseInitiative(); focus = 1; return render(); }
    if (name === 's') return changeStatus();
    if (name === 'p') return changePerson();
    if (name === '/' || ch === '/') return search();
    if (name === '?' || ch === '?') return help();
    if (name === 'r') { lastSignature = ''; return reload(); }
  });
  screen.on('resize', render);
  process.on('SIGINT', signal); process.on('SIGTERM', terminate);
  refreshRows(); render();
  const timer = setInterval(reload, 1500);
  return { screen, quit };
}
