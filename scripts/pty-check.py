#!/usr/bin/env python3
"""Exercise the real terminal UI in a PTY; render emulator cells, not a mock UI.
QA dependencies: pip install pyte pillow. Pass --out PATH to save receipts.
"""
import argparse, codecs, fcntl, hashlib, json, os, pathlib, pty, select, shutil, signal, struct, subprocess, tempfile, termios, time
import pyte
from PIL import Image, ImageDraw, ImageFont

ROOT=pathlib.Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser();parser.add_argument('--out',required=True);parser.add_argument('--live-project');args=parser.parse_args()
OUT=pathlib.Path(args.out);OUT.mkdir(parents=True,exist_ok=True)
class Terminal:
 def __init__(self,project,cols=170,rows=40,backlog=None):
  self.cols,self.rows=cols,rows
  self.master,slave=pty.openpty();fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',rows,cols,0,0))
  env={**os.environ,'TERM':'xterm-256color','COLORTERM':'truecolor','NCURSES_NO_UTF8_ACS':'1'}
  self.proc=subprocess.Popen(['node',str(ROOT/'bin/backlog-tree.js'),'--project',str(project)]+(['--backlog',str(backlog)] if backlog else []),stdin=slave,stdout=slave,stderr=slave,env=env,cwd=ROOT,start_new_session=True)
  os.close(slave);self.screen=pyte.Screen(cols,rows);self.stream=pyte.Stream(self.screen);self.decoder=codecs.getincrementaldecoder('utf-8')('replace');self.raw=bytearray();self.read(1.2)
 def read(self,seconds=.4):
  deadline=time.monotonic()+seconds
  while time.monotonic()<deadline:
   if select.select([self.master],[],[],.03)[0]:
    try:data=os.read(self.master,65536)
    except OSError:break
    if not data:break
    self.raw.extend(data);self.stream.feed(self.decoder.decode(data))
 def send(self,text,seconds=.3):os.write(self.master,text.encode());self.read(seconds)
 def text(self):return '\n'.join(self.screen.display)
 def assert_text(self,needle):
  assert needle in self.text(),f'Missing {needle!r}\n{self.text()}'
 def save(self,name):
  (OUT/f'{name}.txt').write_text(self.text())
  (OUT/f'{name}.ansi').write_bytes(self.raw)
  fontpath='/System/Library/Fonts/Menlo.ttc'
  if not pathlib.Path(fontpath).exists():fontpath='/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf'
  font=ImageFont.truetype(fontpath,18);cw=11;ch=25
  image=Image.new('RGB',(self.cols*cw+24,self.rows*ch+24),'#101419');draw=ImageDraw.Draw(image)
  colors={'default':'#dce4eb','black':'#101419','white':'#dce4eb','brown':'#f1c56b','yellow':'#f1c56b','cyan':'#8ed3ed','blue':'#7fafff','green':'#8ad6a3','red':'#f07f89','magenta':'#d0a0ee','brightblack':'#8c98a5','brightwhite':'#ffffff'}
  def color(value,bg=False):
   if value=='default':return '#101419' if bg else '#dce4eb'
   return colors.get(value,'#'+value if len(value)==6 else '#dce4eb')
  for y in range(self.rows):
   for x in range(self.cols):
    cell=self.screen.buffer[y][x];px=12+x*cw;py=12+y*ch
    fg,bg=color(cell.fg),color(cell.bg,True)
    if cell.reverse:fg,bg=bg,fg
    if bg!='#101419':draw.rectangle((px,py,px+cw,py+ch),fill=bg)
    if cell.data.strip():draw.text((px,py),cell.data,font=font,fill=fg)
  image.save(OUT/f'{name}.png')
 def resize(self,cols,rows):
  self.cols,self.rows=cols,rows;self.screen.resize(rows,cols)
  fcntl.ioctl(self.master,termios.TIOCSWINSZ,struct.pack('HHHH',rows,cols,0,0));os.kill(self.proc.pid,signal.SIGWINCH);self.read(.5)
 def close(self):
  if self.proc.poll() is None:self.send('q');
  try:self.proc.wait(timeout=2)
  except subprocess.TimeoutExpired:self.proc.terminate();self.proc.wait(timeout=2)
  os.close(self.master)

def hashes(project):return {str(p.relative_to(project)):hashlib.sha256(p.read_bytes()).hexdigest() for p in pathlib.Path(project).rglob('*.md') if p.is_file()}
results=[]
with tempfile.TemporaryDirectory(prefix='backlog-tree-pty-') as tmp:
 project=pathlib.Path(tmp);shutil.copytree(ROOT/'fixtures/demo',project,dirs_exist_ok=True)
 term=Terminal(project)
 try:
  term.assert_text('Backlog Tree Demo');term.assert_text('Collect test data');term.assert_text('Done');term.save('01-overview')
  # Click the actual indented expansion arrow, not a hard-coded left margin.
  y=next(i for i,line in enumerate(term.screen.display) if 'Prepare release package' in line)
  x=term.screen.display[y].index('▾')
  press='\x1b[M'+chr(32)+chr(33+x)+chr(33+y)
  release='\x1b[M'+chr(35)+chr(33+x)+chr(33+y)
  term.send(press);term.send(release);assert 'Collect test data' not in term.text(),term.text()
  term.send(press);term.send(release);term.assert_text('Collect test data');term.save('01b-mouse-expanded')
  # Return selection to the initiative root before native handoff.
  term.send('k')
  # Native viewer from initiative root; exit back to overlay.
  term.send('\r',1.3);term.assert_text('TASK-');term.save('02-native-view')
  term.send('q',.8);term.assert_text('Backlog Tree Demo');term.assert_text('Collect test data');term.save('03-return')
  # Right archive pane begins collapsed; select and expand Release planning.
  term.send('\t');term.send('jj');term.send(' ');term.assert_text('Previous release');term.save('04-done-expanded')
  # The first historical task opens the explicit read-only detail fallback.
  term.send('j');term.send('\r');term.assert_text('read-only history');term.assert_text('Read-only historical task');term.send('\x1b');
  # Return to Overview active pane, find task and edit its status through native CLI.
  term.send('o');term.send('/');term.send('Collect test data\r',.5);term.send('\r');term.assert_text('TASK-1.1.1')
  term.send('s');term.send('j');term.send('\r',1.0)
  term.assert_text('No live edit made')
  cv=next((project/'backlog/tasks').glob('task-1.1.1*.md'))
  assert "due_date: '2026-10-01'" in cv.read_text()
  assert 'status: To Do' in cv.read_text()
  # Remove unsupported metadata only in this disposable fixture to test native writes.
  cv.write_text(cv.read_text().replace("due_date: '2026-10-01'\n",''))
  term.read(1.8);term.send('s');term.send('j');term.send('\r',1.0)
  assert 'status: In Progress' in next((project/'backlog/tasks').glob('task-1.1.1*.md')).read_text()
  term.save('05-status-edited')
  # Set a person via native CLI; preserve existing other labels.
  term.send('p');term.send('\x7f'*len('Alex'));term.send('Jane Doe\r',1.0)
  text=next((project/'backlog/tasks').glob('task-1.1.1*.md')).read_text();assert 'person:Jane Doe' in text,text
  assert 'person:Alex' not in text,text
  term.assert_text('Jane Doe');term.save('06-person-edited')
  # External task updates must appear without a manual refresh.
  f=project/'backlog/tasks/task-1.1.2.md';f.write_text(f.read_text().replace('Review draft','Review updated draft'))
  term.read(1.8);term.assert_text('Review updated draft');term.assert_text('Jane Doe');term.save('07-live-update')
  term.resize(78,24);term.assert_text('Widen this terminal');term.save('08-narrow')
  term.resize(170,40);term.assert_text('Review updated draft');term.save('09-resized')
  results.extend(['nested mouse arrow collapse and expand','native viewer handoff and return','collapsed Done expansion','completed history fallback','unsupported metadata edit blocked without live write','native status mutation','native person label mutation','external file refresh','narrow/restore resize'])
 finally:term.save('last-screen');term.close()
 if term.proc.returncode != 0:raise AssertionError(f'UI exit {term.proc.returncode}')
 fake=project/'fake-backlog'
 fake.write_text('#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo 1.29.3; else exit 7; fi\n');fake.chmod(0o755)
 term=Terminal(project,backlog=fake)
 try:
  term.send('\r');term.assert_text('Backlog exited with code 7');term.send('j');term.save('native-failure-return')
 finally:term.close()
 results.append('native child failure restores overlay input')
 if args.live_project:
  live=pathlib.Path(args.live_project);before=hashes(live/'backlog');term=Terminal(live,190,44)
  try:term.assert_text('Backlog Tree');term.save('10-existing-project')
  finally:term.close()
  assert hashes(live/'backlog')==before,'Live Markdown files changed during read-only smoke test'
  results.append('existing project opens read-only; all Markdown hashes unchanged')
(OUT/'receipt.json').write_text(json.dumps({'passed':results,'rendering':'actual PTY output interpreted by pyte, rasterized with Pillow'},indent=2))
print(json.dumps({'passed':results,'out':str(OUT)},indent=2))
