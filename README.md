# Backlog Tree

A terminal companion for your existing Backlog.md project.

It reads the same Markdown files as Backlog. It adds an initiative sidebar, an active task tree, and a parallel Done pane.
The original `backlog` command stays installed and unchanged. No project initialization or migration is needed.

## Install

Requires Node.js 22 or later and an installed Backlog.md CLI.

From this repository:

```sh
npm ci --ignore-scripts
npm link --ignore-scripts
```

Open a project:

```sh
backlog-tree --project "/path/to/existing/project"
```

Inside that project, you can just run `backlog-tree`. The command also finds a project from its subdirectories.

Try the synthetic sample:

```sh
backlog-tree --project fixtures/demo
```

The terminal needs at least 90 columns and 15 rows. About 150 columns gives long task titles more room.

## Use

| Control | Action |
| --- | --- |
| Tab / Shift-Tab | Switch between sidebar, active tree, and Done |
| Arrow keys / j / k | Select an initiative or task |
| Click | Select a task or initiative |
| Click a tree arrow / Space | Expand or collapse |
| Enter | Open the installed Backlog task view; press q there to return |
| Left / Right | Collapse / expand |
| o | Return to the overview |
| / | Find a task by title, ID, or person |
| s | Change the selected task's status through Backlog |
| p | Set its main person; blank means Internal |
| r | Refresh files without changing initiative order |
| ? | Show help and metadata warnings |
| q / Ctrl-C | Quit |

The overview opens first. Parents with children become initiatives. Standalone tasks appear under Other tasks.
Missing parents and cyclic links appear under Unassigned, with warnings. No tasks are hidden because their parent is missing.

The dot means an initiative contains a To Do task. It does not mean unread activity.
All unfinished descendants start expanded. Each task uses one line: tree branch, status symbol, ID, and title.
Long titles can clip. The footer shows the selected person's name and title; Enter opens the full task.
Status symbols are ● To Do, ◐ In Progress, ✓ Done, and ! Blocked. Parked and other statuses keep their names.
An ancestor can appear as context in both panes. Progress counts include each task once.

The Done pane takes 30% of the space after the sidebar. Its initiative groups start collapsed.
It includes live Done tasks and files in `backlog/completed`. Canceled entries in `backlog/archive` are excluded.

Files refresh every 1.5 seconds. Initiative order follows latest activity, but changes only when you switch initiatives or reopen.
Expansion choices last for the current session. Reopening returns to the overview with unfinished descendants expanded.

## People and attention

One label identifies the main person a task concerns:

```yaml
labels:
  - documentation
  - 'person:Jane Doe'
```

Without a `person:` label, the task displays Internal. Assignees, names in titles, and ordinary labels are not treated as people.
The `p` action preserves unrelated labels. Multiple or empty person labels show a conflict instead of guessing a name.

A small ! marks dates, explicit blockers, waiting labels, or unfinished dependencies. Select the task to read the details below.
Unfinished dependencies appear as “Depends on.” They are not automatically called blockers.
Priority, milestone, and type do not add board controls or extra task rows. Existing metadata remains unchanged.

## Existing Backlog integration

The companion reads local task files and configuration. Native task details use `backlog task view ID` in the project directory.
The task view temporarily owns the terminal. Exiting it restores the companion.

Completed-folder details are read-only. Backlog 1.29.3 cannot open those files through `task view`.

Companion edits first run on a disposable copy. The result must preserve unrelated metadata, labels, and task text.
If the preview loses data, the live edit is blocked. A second file read checks that the requested change was saved.
The companion never rewrites your task files itself.

**Backlog 1.29.3 limitation:** its serializer drops `due_date` during edits. The companion blocks such edits before touching the live task.
Read and task-opening actions still work. Changes made inside Backlog's own interface follow Backlog's own behavior.

Native edits honor the project's existing Git settings, including automatic commits if enabled.
The companion detects changes during its preview, but cannot guarantee atomic updates against another writer using an external CLI.

Only local `backlog/tasks` and `backlog/completed` files are read. Cross-branch task discovery is not part of this version.
No task database, server, telemetry, or background service is added.

## Command reference

```sh
backlog-tree --help
backlog-tree --version
backlog-tree --project "/path/to/project" --plain
backlog-tree --project "/path/to/project" --json
backlog-tree --backlog "/path/to/installed/backlog"
```

Flags override environment defaults: `BACKLOG_TREE_PROJECT` and `BACKLOG_TREE_BACKLOG`.
Without flags or environment values, the current directory and `backlog` on PATH are used.
Noninteractive output is plain text by default. `--json` provides a versioned read-only snapshot.

Exit codes: 0 for success, 1 for project/runtime errors, and 2 for invalid arguments.

## Checks

```sh
npm test
```

The unit suite checks task ancestry, metadata, selection changes, read safety, and the CLI bridge.

The terminal suite uses a disposable project and the actual installed Backlog CLI. It is tested against Backlog 1.29.3 on macOS.
To run it, install `pyte` and `pillow` in a Python environment:

```sh
python scripts/pty-check.py --out /tmp/backlog-tree-check
```

Add `--live-project "/path/to/project"` for a read-only opening check with Markdown hash verification.
The suite records actual terminal output, interpreted by a terminal emulator, and renders PNG receipts.

## Remove the launcher

```sh
npm unlink --global backlog-tree
```

This removes only the companion command. Your task files and the original Backlog installation remain available.
