import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseTask, loadProject, findProject } from '../src/project.js';
import { buildModel, treeRows, orderedGroups, attention } from '../src/model.js';
import { dimensions, fit, compactRow } from '../src/layout.js';
import { viewArgs, resolveBacklog, editTask } from '../src/bridge.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function task(id, status = 'To Do', parent = null, extra = '') {
  return parseTask(`---\nid: ${id}\ntitle: Task ${id}\nstatus: ${status}\n${parent ? `parent_task_id: ${parent}\n` : ''}${extra}---\n\nBody`, `${id}.md`, 'tasks');
}
function model(tasks) { return buildModel({ tasks, statuses: ['To Do', 'In Progress', 'Done'] }); }
function taskIds(rows, nonContextOnly = false) { return rows.filter(r => r.task && (!nonContextOnly || !(r.context || r.detail.includes(' · context')))).map(r => r.task.id); }

test('mixed-status family retains active child under Done ancestor and counts each task once', () => {
  const m = model([task('T-1','Done'), task('T-2','To Do','T-1'), task('T-3','Done','T-2'), task('T-4','In Progress','T-2')]);
  const active = treeRows(m.groups, 'active', new Set(), m);
  assert.deepEqual(taskIds(active), ['T-1','T-2','T-4']);
  assert.deepEqual(taskIds(active,true), ['T-2','T-4']);
  assert.equal(m.groups[0].total, 4); assert.equal(m.groups[0].done, 2);
  const collapsed = treeRows(m.groups,'done',new Set(),m);
  assert.equal(collapsed.length,1); assert.equal(collapsed[0].expanded,false);
  const done = treeRows(m.groups,'done',new Set([`done:group:${m.groups[0].key}`]),m);
  assert.deepEqual(taskIds(done,true), ['T-1','T-3']);
});

test('cycles, self-links and missing parents never lose a task or loop', () => {
  const m = model([task('T-1','To Do','T-2'), task('T-2','To Do','T-1'), task('T-3','To Do','MISSING'), task('T-4','To Do','T-4'), task('T-5','To Do','T-1')]);
  const rows = treeRows(m.groups,'active',new Set(),m);
  assert.equal(new Set(taskIds(rows)).size,5); assert.equal(m.warnings.length,4);
  assert.equal(m.groups[0].title,'Unassigned');
});

test('activity refresh keeps old order; navigation reorders and To Do dots are semantic', () => {
  const a = task('T-1','In Progress'), child = task('T-2','To Do','T-1');
  const b = task('T-3','In Progress'), doneChild=task('T-4','Done','T-3');
  a.activity=10; b.activity=1;
  let m=model([a,child,b,doneChild]); const old=orderedGroups(m).map(g=>g.key);
  assert.equal(m.groups.find(g=>g.key===a.key).todo,true);
  b.activity=100; child.status='In Progress'; child.todo=false; m=model([a,child,b,doneChild]);
  assert.deepEqual(orderedGroups(m,old).map(g=>g.key),old);
  assert.equal(orderedGroups(m,old,true)[0].key,b.key);
  assert.equal(m.groups.find(g=>g.key===a.key).todo,false);
});

test('person labels are explicit, distinct from assignee, and conflicts stay visible', () => {
  assert.equal(task('T-1','To Do',null,"labels: ['person:Jane Doe', 'research']\nassignee: ['Other']\n").person,'Jane Doe');
  assert.equal(task('T-2','To Do',null,"assignee: ['Other']\nlabels: ['alex']\n").person,'Internal');
  const bad=task('T-3','To Do',null,"labels: ['person:Jane', 'person:Joe']\n");
  assert.equal(bad.personConflict,true); assert.match(buildModel({tasks:[bad]}).warnings[0],/multiple person/);
});

test('dependency is not silently called a blocker; unknown dependencies and custom statuses survive', () => {
  const t=task('T-1','Parked',null,"due_date: '2026-01-01'\ndependencies: ['T-2','MISSING','T-3']\n");
  const m=model([t,task('T-2','To Do'),task('T-3','Done')]);
  const info=attention(t,m,'2026-09-17');
  assert.match(info,/OVERDUE/); assert.match(info,/Depends on T-2, MISSING\?/); assert.doesNotMatch(info,/BLOCKED|T-3/);
  assert.match(treeRows(m.groups,'active',new Set(),m).find(r=>r.task?.id==='T-1').detail,/Parked/);
});

test('Done groups expand independently and preserve all old completed history', () => {
  const m=model([task('T-1'),task('T-2','Done','T-1'),task('T-3'),task('T-4','Done','T-3')]);
  const rows=treeRows(m.groups,'done',new Set(['done:group:tasks:T-1']),m);
  assert.ok(rows.some(r=>r.task?.id==='T-2'));
  assert.ok(!rows.some(r=>r.task?.id==='T-4'));
});

test('30% Done allocation is after sidebar; widths sum exactly; narrow terminal is explicit', () => {
  for (const width of [90,100,140,180,240]) { const d=dimensions(width,40); assert.equal(d.sidebar+d.active+d.done,width); assert.equal(d.done,Math.floor((width-d.sidebar)*.3)); }
  assert.equal(dimensions(80,24).narrow,true); assert.equal(dimensions(180,12).narrow,true);
  const root = task('T-1','Blocked');
  const row = { key:'active:group:tasks:T-1', group:{done:2,total:8}, task:root, text:'▾ A very long initiative title that cannot fit', attention:'BLOCKED' };
  const compact = compactRow(row,35);
  assert.ok(compact.startsWith('▾ ! T-1 ')); assert.ok(compact.endsWith('2/8')); assert.equal(compact.length,35);
  assert.equal(compact.includes('\n'),false);
  assert.equal(fit('   └─ Child',40),'   └─ Child'); assert.equal(fit('abcdef',4),'abc…'); assert.equal(fit('漢字漢字',5),'漢字…');
});

test('reader excludes canceled archive and includes completed history without touching files', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'backlog-tree-read-'));
  try {
    fs.cpSync(path.join(root,'fixtures/demo'),dir,{recursive:true});
    fs.mkdirSync(path.join(dir,'backlog/archive/tasks'),{recursive:true});
    fs.writeFileSync(path.join(dir,'backlog/archive/tasks/duplicate.md'),'bad archived data');
    const original=fs.readFileSync(path.join(dir,'backlog/tasks/task-1.md'),'utf8');
    assert.equal(findProject(path.join(dir,'backlog/tasks')),fs.realpathSync(dir));
    const snapshot=loadProject(dir); assert.equal(snapshot.tasks.length,15);
    assert.equal(snapshot.tasks.filter(t=>t.source==='completed').length,1);
    assert.equal(fs.readFileSync(path.join(dir,'backlog/tasks/task-1.md'),'utf8'),original);
    fs.writeFileSync(path.join(dir,'backlog/tasks/broken.md'),'invalid');
    assert.throws(()=>loadProject(dir),/frontmatter/);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});

test('native bridge uses argument arrays and rejects completed history edits/views', async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'backlog-tree-bridge-'));
  try {
    fs.mkdirSync(path.join(dir,'backlog/tasks'),{recursive:true}); fs.writeFileSync(path.join(dir,'backlog/config.yml'),'project_name: Test\n');
    const fake=path.join(dir,'fake backlog'); const receipt=path.join(dir,'args.json');
    fs.writeFileSync(fake,`#!${process.execPath}\nrequire('fs').writeFileSync(${JSON.stringify(receipt)},JSON.stringify(process.argv.slice(2))); const f=require('path').join(process.cwd(),'backlog/tasks/T-1.md');const fs=require('fs');fs.writeFileSync(f,fs.readFileSync(f,'utf8').replace('\\n---\\n','\\nlabels: '+JSON.stringify([process.argv[6]])+'\\n---\\n'));console.log('Task updated');\n`,{mode:0o755});
    const t=task('T-1');t.file=path.join(dir,'backlog/tasks/T-1.md');fs.writeFileSync(t.file,t.text);
    assert.equal(resolveBacklog(fake),fake); assert.deepEqual(viewArgs(t),['task','view','T-1']);
    await editTask(fake,dir,t,['--add-label','person:Name; $(touch BAD)']);
    assert.deepEqual(JSON.parse(fs.readFileSync(receipt)),['task','edit','T-1','--add-label','person:Name; $(touch BAD)','--plain']);
    assert.equal(fs.existsSync(path.join(dir,'BAD')),false);
    t.source='completed';assert.throws(()=>viewArgs(t),/read-only/);await assert.rejects(editTask(fake,dir,t,[]),/live task folder/);
    fs.writeFileSync(fake,`#!${process.execPath}\nconsole.log('Task T-1 not found.');\n`,{mode:0o755});
    t.source='tasks';await assert.rejects(editTask(fake,dir,t,[]),/could not find/);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('CLI noninteractive contract: help, JSON, plain and usage errors', () => {
  const run=(args)=>spawnSync(process.execPath,[path.join(root,'bin/backlog-tree.js'),...args],{cwd:root,encoding:'utf8'});
  assert.equal(run(['--help']).status,0);
  const json=run(['--project','fixtures/demo','--json']);assert.equal(json.status,0);assert.equal(JSON.parse(json.stdout).tasks.length,15);
  assert.doesNotMatch(run(['--project','fixtures/demo','--plain']).stdout,/\x1b/);
  assert.equal(run(['--no-such-option']).status,2);
  assert.equal(run(['--plain','--json']).status,2);
});

// Regression cases from the independent UI audit.
import { reconcileSelection } from '../src/selection.js';
test('context ancestors do not move panes on an ordinary refresh', () => {
 const m=model([task('T-1','Done'),task('T-2','To Do','T-1')]); const t=m.nodes.get('tasks:T-1');
 assert.deepEqual(reconcileSelection(t,{...t},1,'@overview',m.groups,new Set()),{focus:1,selectedGroup:'@overview'});
});
test('status transition unfolds target ancestry and changes an unrelated active filter', () => {
 const m=model([task('T-1','In Progress'),task('T-2','Done','T-1'),task('T-3','Done','T-2'),task('T-4','To Do'),task('T-5','To Do','T-4')]);
 const t=m.nodes.get('tasks:T-3'); const collapse=new Set(['done:task:tasks:T-2']);
 assert.equal(reconcileSelection({...t,done:false},t,1,'tasks:T-4',m.groups,collapse).focus,2);
 assert.ok(!collapse.has('done:task:tasks:T-2'));
 const back=reconcileSelection(t,{...t,done:false},2,'tasks:T-4',m.groups,new Set());
 assert.equal(back.focus,1); assert.equal(back.selectedGroup,'tasks:T-1');
});
test('duplicate or empty person labels cannot silently mask an invalid person assignment', () => {
 for(const labels of [["person:","person:Jane"],["person:Jane","person:Jane"],["person:"]]) {
  const t=task('T-1','To Do',null,`labels: ${JSON.stringify(labels)}\n`);assert.equal(t.personConflict,true);
 }
});

test('edit preview blocks description loss and preserves the live original', async () => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'backlog-tree-loss-'));
 try {
  fs.mkdirSync(path.join(dir,'backlog/tasks'),{recursive:true});fs.writeFileSync(path.join(dir,'backlog/config.yml'),'project_name: Test\n');
  const t=task('T-1');t.file=path.join(dir,'backlog/tasks/T-1.md');fs.writeFileSync(t.file,t.text);
  const fake=path.join(dir,'bad-backlog');
  fs.writeFileSync(fake,`#!${process.execPath}\nconst fs=require('fs');const p=require('path').join(process.cwd(),'backlog/tasks/T-1.md');fs.writeFileSync(p,fs.readFileSync(p,'utf8').replace('status: To Do','status: In Progress').replace('Body',''));`,{mode:0o755});
  await assert.rejects(editTask(fake,dir,t,['--status','In Progress']),/task description\/notes/);
  assert.equal(fs.readFileSync(t.file,'utf8'),t.text);
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
