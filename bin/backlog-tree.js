#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { findProject, loadProject } from '../src/project.js';
import { buildModel, exportPlain } from '../src/model.js';
import { resolveBacklog, checkBacklog } from '../src/bridge.js';

const help = `backlog-tree — initiative trees for your existing Backlog.md project

Usage:
  backlog-tree                         Open the project in this directory
  backlog-tree --project /path/to/repo  Open an existing project
  backlog-tree --plain                  Print tasks without the terminal UI

Options:
  --project PATH   Existing project or its backlog folder (default: cwd)
  --backlog PATH   Installed Backlog executable (default: backlog on PATH)
  --plain          Read-only text output, including completed history
  --json           Read-only JSON snapshot
  -h, --help       Show this help
  --version        Show companion version

Keyboard: Tab switches panes; arrows select; Enter opens the native task view;
Space expands; s changes status; p sets a person; / finds a task; ? shows help.

No init or migration. Your existing backlog command and files stay in place.
Person labels use person:Name; no such label means Internal.
BACKLOG_TREE_PROJECT and BACKLOG_TREE_BACKLOG supply optional defaults.
`;
if (process.argv.includes('--help') || process.argv.includes('-h')) { console.log(help); }
else {
  try {
    const { values } = parseArgs({ options: { project: { type: 'string' }, backlog: { type: 'string' }, plain: { type: 'boolean' }, json: { type: 'boolean' }, version: { type: 'boolean' } }, strict: true, allowPositionals: false });
    if (values.version) console.log('0.1.0');
    else {
      if (values.plain && values.json) throw Object.assign(new Error('Use either --plain or --json.'), { code: 'ERR_PARSE_ARGS' });
      const project = findProject(values.project || process.env.BACKLOG_TREE_PROJECT || process.cwd());
      const snapshot = loadProject(project);
      if (values.json) console.log(JSON.stringify({ version: 1, project, name: snapshot.name, statuses: snapshot.statuses,
        tasks: snapshot.tasks.map(({ text, body, activity, ordinal, ...task }) => task), warnings: buildModel(snapshot).warnings }, null, 2));
      else if (values.plain || !process.stdin.isTTY || !process.stdout.isTTY || process.env.TERM === 'dumb') console.log(exportPlain(buildModel(snapshot)));
      else {
        const executable = resolveBacklog(values.backlog);
        const version = await checkBacklog(executable, project);
        const { startUI } = await import('../src/ui.js');
        startUI(snapshot, executable, version);
      }
    }
  } catch (error) {
    console.error(`backlog-tree: ${error.message}`);
    process.exitCode = String(error.code).startsWith('ERR_PARSE_ARGS') ? 2 : 1;
  }
}
