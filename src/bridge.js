import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify, isDeepStrictEqual } from 'node:util';
import { parse, stringify } from 'yaml';
import { loadProject } from './project.js';
const exec = promisify(execFile);

export function resolveBacklog(explicit) {
  const command = explicit || process.env.BACKLOG_TREE_BACKLOG || 'backlog';
  const candidates = command.includes(path.sep) ? [path.resolve(command)] : (process.env.PATH || '').split(path.delimiter).map(dir => path.join(dir, command));
  for (const file of candidates) {
    try { fs.accessSync(file, fs.constants.X_OK); if (fs.statSync(file).isFile()) return file; } catch {}
  }
  throw new Error(`Cannot find executable ${command}. Install Backlog.md or use --backlog PATH.`);
}
export async function checkBacklog(executable, project) {
  const { stdout } = await exec(executable, ['--version'], { cwd: project, timeout: 8000 });
  const version = stdout.trim();
  if (!/^\d+\.\d+\.\d+/.test(version)) throw new Error('The selected executable did not return a Backlog version.');
  return version;
}
export function viewArgs(task) {
  if (task.source !== 'tasks') throw new Error('Completed history uses the read-only detail view.');
  return ['task', 'view', task.id];
}
function bodyContent(text) {
  return text.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '').replace(/<!-- SECTION:[A-Z_]+:(?:BEGIN|END) -->/g, '').split(/\r?\n/).map(line => line.trimEnd()).filter(line => line.trim()).join('\n');
}
function metadata(text) { return parse(text.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/)[1]); }
async function runEdit(executable, project, task, options) {
  const { stdout } = await exec(executable, ['task', 'edit', task.id, ...options, '--plain'], { cwd: project, timeout: 15000, maxBuffer: 2 * 1024 * 1024 });
  if (/not found/i.test(stdout.slice(0, 200))) throw new Error(`Backlog could not find ${task.id}. Refresh and try again.`);
  const saved = loadProject(project).tasks.find(t => t.key === task.key);
  if (!saved) throw new Error('Backlog exited, but the task could not be verified on disk.');
  for (let i = 0; i < options.length; i += 2) {
    const [flag, value] = options.slice(i, i + 2);
    if (flag === '--status' && saved.status !== value) throw new Error('Backlog exited, but the requested status was not saved.');
    if (flag === '--add-label' && !saved.labels.includes(value)) throw new Error('Backlog exited, but the requested label was not saved.');
    if (flag === '--remove-label' && saved.labels.includes(value) && !options.some((v, j) => v === '--add-label' && options[j + 1] === value)) throw new Error('Backlog exited, but the old label remains.');
  }
  return saved;
}
export async function editTask(executable, project, task, options) {
  if (task.source !== 'tasks' || !fs.existsSync(task.file)) throw new Error('This task is no longer in the live task folder. Refresh first.');
  const original = fs.readFileSync(task.file, 'utf8');
  const before = metadata(original);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'backlog-tree-edit-'));
  try {
    fs.mkdirSync(path.join(temp, 'backlog/tasks'), { recursive: true });
    fs.copyFileSync(path.join(project, 'backlog/config.yml'), path.join(temp, 'backlog/config.yml'));
    const config = parse(fs.readFileSync(path.join(project, 'backlog/config.yml'), 'utf8'));
    config.filesystem_only = true; config.auto_commit = false; config.remote_operations = false; config.check_active_branches = false;
    fs.writeFileSync(path.join(temp, 'backlog/config.yml'), stringify(config));
    fs.writeFileSync(path.join(temp, 'backlog/tasks', path.basename(task.file)), original);
    const preview = await runEdit(executable, temp, task, options);
    const after = metadata(preview.text);
    const allowed = new Set(['updated_date']);
    if (options.includes('--status')) allowed.add('status');
    if (options.includes('--add-label') || options.includes('--remove-label')) allowed.add('labels');
    const lost = Object.keys(before).filter(key => !allowed.has(key) && !isDeepStrictEqual(before[key], after[key]));
    const untouchedLabels = (Array.isArray(before.labels) ? before.labels : []).filter(label => !options.some((v, i) => v === '--remove-label' && options[i + 1] === label));
    if (untouchedLabels.some(label => !preview.labels.includes(label))) lost.push('unrelated labels');
    if (bodyContent(original) !== bodyContent(preview.text)) lost.push('task description/notes');
    if (lost.length) throw new Error(`Installed Backlog would change/drop ${lost.join(', ')}. No live edit made. Update Backlog or edit that field manually.`);
    if (fs.readFileSync(task.file, 'utf8') !== original) throw new Error('Task changed during the edit preview. Refresh and try again.');
    return await runEdit(executable, project, task, options);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
