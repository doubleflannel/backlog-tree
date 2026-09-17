import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';

export function findProject(start = process.cwd()) {
  let dir = path.resolve(start);
  if (path.basename(dir) === 'backlog' && fs.existsSync(path.join(dir, 'config.yml'))) dir = path.dirname(dir);
  while (true) {
    if (fs.existsSync(path.join(dir, 'backlog', 'config.yml'))) return fs.realpathSync(dir);
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`No backlog/config.yml found at or above ${start}. Use --project PATH.`);
    dir = parent;
  }
}

export function safeText(value) {
  return String(value ?? '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');
}
export const clean = value => safeText(value).trim();
export function safeMultiline(value) {
  return String(value ?? '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
}
const idOf = value => clean(value).toUpperCase();
const strings = value => Array.isArray(value) ? value.map(clean).filter(Boolean) : [];
function markdownFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isFile() && e.name.endsWith('.md')).map(e => path.join(dir, e.name)).sort();
}
export function parseTask(text, file, source, mtime = 0) {
  const match = text.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error(`Missing YAML frontmatter: ${file}`);
  const meta = parse(match[1]);
  if (!meta || typeof meta !== 'object' || !meta.id || !meta.title) throw new Error(`Task needs id and title: ${file}`);
  const id = idOf(meta.id);
  if (!/^[A-Z0-9][A-Z0-9._-]*$/.test(id)) throw new Error(`Invalid task ID in ${file}`);
  const labels = strings(meta.labels);
  const personLabels = labels.filter(x => /^person:/i.test(x));
  const people = personLabels.map(x => x.slice(7).trim());
  const personConflict = personLabels.length > 1 || people.some(name => !name);
  const status = clean(meta.status) || 'Unknown';
  return {
    key: `${source}:${id}`, id, file, source, title: clean(meta.title), status,
    done: source === 'completed' || /^(done|complete|completed)$/i.test(status),
    todo: source !== 'completed' && /^to do$/i.test(status),
    parentId: idOf(meta.parent_task_id), labels, person: personConflict ? 'Person conflict' : people.length === 1 ? people[0] : 'Internal',
    personConflict, dependencies: strings(meta.dependencies).map(idOf),
    due: clean(meta.due_date), priority: clean(meta.priority),
    activity: Math.max(mtime, Date.parse(meta.updated_date || meta.created_date || '') || 0),
    ordinal: typeof meta.ordinal === 'number' ? meta.ordinal : Infinity,
    body: text.slice(match[0].length), text,
  };
}

export function loadProject(project) {
  const config = parse(fs.readFileSync(path.join(project, 'backlog/config.yml'), 'utf8')) || {};
  const tasks = [];
  const seen = new Set();
  for (const source of ['tasks', 'completed']) {
    for (const file of markdownFiles(path.join(project, 'backlog', source))) {
      const task = parseTask(fs.readFileSync(file, 'utf8'), file, source, fs.statSync(file).mtimeMs);
      if (seen.has(task.key)) throw new Error(`Duplicate ${task.id} in ${source}. Fix the duplicate before browsing.`);
      seen.add(task.key); tasks.push(task);
    }
  }
  return { project, name: clean(config.project_name) || path.basename(project), statuses: strings(config.statuses), tasks, config };
}
