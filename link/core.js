// Hodo Link core: everything Hodo Link does with a Hodo folder (TASKS.md and memory/), safely. No dependencies.
// Loaded by the small shell (index.js), which also keeps it up to date from Hodo's website (1.3.0, Nov 3). Every write re-reads TASKS.md first and changes only the lines
// of the task it touches, so nothing else in the file moves. Changes made by Claude are marked "by Claude <date>".
'use strict';
const fs = require('fs');
const path = require('path');

// 1.2.3 (Nov 1): the folder is found, not only taken as given. Claude fills in Documents\Hodo Folder for people; if the
// chosen folder has no TASKS.md, a Hodo Folder inside it (Hodo Folder, Hodo, Hodo Folder 2 …) is used, the same way
// Hodo itself finds one. If the chosen one doesn't exist at all, the usual places are tried: Documents (also under
// OneDrive) and the Desktop.
const HF_RE = /^hodo( folder)?( \d+)?$/i;
const hasTasks = d => { try { return fs.statSync(path.join(d, 'TASKS.md')).isFile(); } catch (e) { return false; } };
function hodoInside(d) {
  let ents = []; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return ''; }
  const hits = ents.filter(e => e.isDirectory() && HF_RE.test(e.name) && hasTasks(path.join(d, e.name)))
    .sort((a, b) => (b.name.toLowerCase() === 'hodo folder') - (a.name.toLowerCase() === 'hodo folder'));
  return hits.length ? path.join(d, hits[0].name) : '';
}
function resolveFolder(raw) {
  raw = String(raw || '').trim(); if (!raw) return '';
  if (hasTasks(raw)) return raw;
  const inside = hodoInside(raw); if (inside) return inside;
  let exists = false; try { exists = fs.statSync(raw).isDirectory(); } catch (e) {}
  if (exists) return raw;
  const home = require('os').homedir(), places = [path.join(home, 'Documents')];
  try { fs.readdirSync(home).filter(n => /^onedrive/i.test(n)).forEach(n => places.push(path.join(home, n, 'Documents'))); } catch (e) {}
  places.push(path.join(home, 'Desktop'));
  for (const pl of places) { const f = hodoInside(pl); if (f) return f; }
  return raw;
}
const FOLDER = resolveFolder(process.env.HODO_FOLDER || process.argv[2] || '');
const TASKS = () => path.join(FOLDER, 'TASKS.md');
const LINK = () => path.join(FOLDER, 'memory', 'hodo-link.json');
const VERSION = '1.3.0';

// ---------- dates, in Hodo's own formats ----------
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const day0 = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const needsYear = d => { const n = day0(new Date()); return d.getFullYear() !== n.getFullYear() || Math.abs(day0(d) - n) > 120 * 864e5; };
const fmtDue = d => `${WD[d.getDay()]} ${MON[d.getMonth()]} ${d.getDate()}${needsYear(d) ? ', ' + d.getFullYear() : ''}`;
const fmtShort = d => `${MON[d.getMonth()]} ${d.getDate()}${needsYear(d) ? ', ' + d.getFullYear() : ''}`;
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function parseDate(s) {
  if (s == null || s === '') return null;
  const t = String(s).trim().toLowerCase(), now = day0(new Date());
  if (t === 'today') return now;
  if (t === 'tomorrow') return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/); if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  const wi = WD.findIndex(w => t.startsWith(w.toLowerCase()));
  m = t.match(/([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?/);
  if (m) { const mi = MON.findIndex(x => x.toLowerCase() === m[1]); if (mi >= 0) { let y = m[3] ? +m[3] : now.getFullYear(); let d = new Date(y, mi, +m[2]); if (!m[3] && d < new Date(now.getFullYear(), now.getMonth(), now.getDate() - 60)) d = new Date(y + 1, mi, +m[2]); return d; } }
  if (wi >= 0) { const d = new Date(now); do { d.setDate(d.getDate() + 1); } while (d.getDay() !== wi); return d; }
  const p = new Date(s); return isNaN(p) ? null : day0(p);
}
const weekStart = () => { // week starts on the user's work week (profile), Sunday by default
  let start = 0; try { const p = fs.readFileSync(path.join(FOLDER, 'memory', 'profile.md'), 'utf8'); const m = p.match(/work week[^\n]*?(sun|mon|sat)/i); if (m) start = { sun: 0, mon: 1, sat: 6 }[m[1].toLowerCase()]; } catch (e) {}
  const d = day0(new Date()); d.setDate(d.getDate() - ((d.getDay() - start + 7) % 7)); return d;
};

// ---------- reading and writing TASKS.md, line by line ----------
const TASK_RE = /^- \[( |x|X)\] \*\*(.+?)\*\*(?: - (.*?))?(?: <!-- id:([\w-]+) -->)?\s*$/;
function load() {
  if (!FOLDER) throw new Error('Hodo Link has no folder yet. In Claude: Settings → Extensions → Hodo Link → choose your Hodo Folder, and make sure Enabled is on.');
  let text; try { text = fs.readFileSync(TASKS(), 'utf8'); } catch (e) { throw new Error(`No TASKS.md in ${FOLDER}. In Claude: Settings → Extensions → Hodo Link, choose your Hodo Folder (the one with TASKS.md), or the folder it’s in.`); }
  const mtime = fs.statSync(TASKS()).mtimeMs;
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const sections = []; let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i], h = l.match(/^## (.+?)\s*(<!--\s*hodo:\s*([^>]*?)\s*-->)?\s*$/);   // notes can hold several flags: \"waiting, color #2f9e94\" (Oct 28)
    if (h) { cur = { name: h[1].trim(), tag: (h[3] || '').toLowerCase(), line: i, tasks: [] }; sections.push(cur); continue; }
    const m = cur && l.match(TASK_RE);
    if (m) { let end = i + 1; while (end < lines.length && /^ {2}/.test(lines[end])) end++;
      const body = lines.slice(i + 1, end), desc = [], steps = [], links = [];
      body.forEach(b => { let x; if ((x = b.match(/^ {2}> ?(.*)$/))) { if (/^📎 /.test(x[1])) links.push(x[1]); else desc.push(x[1]); } else if ((x = b.match(/^ {2}- \[( |x|X)\] (.*)$/))) steps.push({ text: x[2], done: x[1] !== ' ' }); });
      cur.tasks.push({ id: m[4] || '', title: m[2], note: m[3] || '', checked: m[1] !== ' ', start: i, end, desc, steps, links, section: cur }); i = end - 1; }
  }
  return { text, lines, sections, mtime };
}
function save(doc, newLines) {
  const now = fs.statSync(TASKS()).mtimeMs;
  if (now !== doc.mtime) throw new Error('TASKS.md changed while Hodo Link was working (maybe in Hodo just now). Nothing was written; please try again.');
  const out = newLines.join('\n').replace(/\n*$/, '\n'), tmp = TASKS() + '.hodolink.tmp';
  try { fs.writeFileSync(tmp, out, 'utf8'); fs.renameSync(tmp, TASKS()); } catch (e) { try { fs.unlinkSync(tmp); } catch (x) {} fs.writeFileSync(TASKS(), out, 'utf8'); }
}
const isDone = s => /\bdone\b/.test(s.tag) || /^done$/i.test(s.name);
const isWait = s => /\bwaiting\b/.test(s.tag) || /^waiting/i.test(s.name);
const SPECIAL = /^(parked|deep water|let go|released|captured|deleted|waste yard)$/i;
const boardCols = doc => doc.sections.filter(s => !SPECIAL.test(s.name));
const sec = (doc, re) => doc.sections.find(s => re.test(s.name));
const pending = doc => boardCols(doc).find(s => /pending/i.test(s.name)) || boardCols(doc).find(s => !isDone(s) && !isWait(s)) || boardCols(doc)[0];
const newUid = () => (Date.now().toString(36).slice(-3) + Math.random().toString(36).slice(2, 6)).toLowerCase();
function taskLines(t) {
  if (!t.id) t.id = newUid();   // an older line without an id gets one, so it can be found again
  const out = [`- [${t.checked ? 'x' : ' '}] **${t.title}**${t.note ? ' - ' + t.note : ''} <!-- id:${t.id} -->`];
  (t.desc || []).forEach(d => out.push(`  > ${d}`.replace(/\s+$/, d === '' ? ' ' : '')));
  (t.links || []).forEach(l => out.push(`  > ${l}`));
  (t.steps || []).forEach(s => out.push(`  - [${s.done ? 'x' : ' '}] ${s.text}`));
  return out;
}
function find(doc, id, where) {
  const pool = doc.sections.filter(s => !where || where(s));
  const all = pool.flatMap(s => s.tasks), key = String(id || '').trim();
  let t = all.find(x => x.id === key); if (t) return t;
  const lc = key.toLowerCase(), exact = all.filter(x => x.title.toLowerCase() === lc); if (exact.length === 1) return exact[0];
  const part = all.filter(x => x.title.toLowerCase().includes(lc));
  if (part.length === 1) return part[0];
  if (part.length > 1) throw new Error(`More than one task matches "${key}": ${part.slice(0, 6).map(x => `${x.title} (id ${x.id})`).join('; ')}. Use the id.`);
  throw new Error(`No task matches "${key}".`);
}

// ---------- the note line ("for WHO, due DATE · waiting on X · deadline DATE · Area · Priority · …") ----------
function splitNote(note) {
  const o = { who: '', role: 'for', due: '', waitOn: '', deadline: '', areas: [], priority: '', week: '', project: '', rest: [] };
  if (!note) return o;
  const parts = note.split(/\s+·\s+/);
  let first = parts[0], m;
  if ((m = first.match(/^(for|with)\s+(.+?)(?:,\s+(.*))?$/i)) && !/^waiting/i.test(first)) { o.role = m[1].toLowerCase(); o.who = m[2].trim(); first = m[3] || ''; }
  else if ((m = first.match(/^(.+?),\s+((?:due|by|completed|deadline|no deadline)\b.*)$/i))) { o.who = m[1].trim(); first = m[2]; }
  parts[0] = first;
  const areas = readAreas().map(a => a.name.toLowerCase());
  parts.forEach(p => { p = p.trim(); if (!p) return;
    if (/^(due|by)\s/i.test(p) && !o.due) o.due = p.replace(/^(due|by)\s+/i, '');
    else if ((m = p.match(/^waiting on (.+)$/i))) o.waitOn = m[1];
    else if ((m = p.match(/^deadline (.+)$/i))) o.deadline = m[1];
    else if (/^(high|medium|low)$/i.test(p)) o.priority = p.toLowerCase();
    else if (/^(not )?this week \(/i.test(p)) o.week = p;
    else if ((m = p.match(/^project\s+(.+)$/i)) && !o.project) o.project = m[1].trim();
    else if (areas.includes(p.toLowerCase()) && !o.areas.length) o.areas.push(p);
    else o.rest.push(p); });
  return o;
}
function joinNote(o) {
  const first = o.who ? `${o.role} ${o.who}${o.due ? ', due ' + o.due : ''}` : (o.due ? 'due ' + o.due : '');
  return [first, o.waitOn ? 'waiting on ' + o.waitOn : '', o.deadline ? 'deadline ' + o.deadline : '', ...o.areas, o.priority ? o.priority[0].toUpperCase() + o.priority.slice(1) : '', o.week, ...o.rest, o.project ? 'project ' + o.project : ''].filter(Boolean).join(' · ');
}
const byClaude = () => `by Claude ${fmtShort(new Date())}`;
const markClaude = o => { o.rest = o.rest.filter(r => !/^by Claude\b/i.test(r)); o.rest.push(byClaude()); };
function applyFields(o, a) {
  if (a.for !== undefined) { o.who = String(a.for || '').trim(); o.role = 'for'; }
  if (a.with !== undefined && a.with) { o.who = String(a.with).trim(); o.role = 'with'; }
  if (a.waiting_on !== undefined) o.waitOn = String(a.waiting_on || '').trim();
  if (a.planned !== undefined) { const d = parseDate(a.planned); if (a.planned && !d) throw new Error(`Couldn't read the date "${a.planned}". Use YYYY-MM-DD.`); o.due = d ? fmtDue(d) : ''; }
  if (a.deadline !== undefined) { const d = parseDate(a.deadline); if (a.deadline && !d) throw new Error(`Couldn't read the date "${a.deadline}". Use YYYY-MM-DD.`); o.deadline = d ? fmtDue(d) : ''; }
  if (a.priority !== undefined) { const p = String(a.priority || '').toLowerCase(); if (p && !/^(high|medium|low)$/.test(p)) throw new Error('priority is high, medium or low (or empty to clear).'); o.priority = p; }
  if (a.area !== undefined) { const ar = readAreas().find(x => x.name.toLowerCase() === String(a.area || '').toLowerCase()); if (a.area && !ar) throw new Error(`"${a.area}" isn't one of the areas: ${readAreas().map(x => x.name).join(', ') || 'none yet'}.`); o.areas = ar ? [ar.name] : []; }
  if (a.project !== undefined) { const pj = String(a.project || '').trim(); if (pj) { const p = findProject(pj); if (!p) throw new Error(`No project called "${pj}". Projects: ${readProjects().filter(x => !x.closed).map(x => x.name).join(', ') || 'none yet'}. Make it first with save_project (or use add_plan).`); o.project = p.name; } else o.project = ''; }
  if (a.this_week === true) { const w = weekStart(); o.week = `this week (${MON[w.getMonth()]} ${w.getDate()})`; } else if (a.this_week === false) o.week = '';
}
const cleanTitle = s => String(s || '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim().slice(0, 90);


// ---------- projects: memory/projects.md, in the same format Hodo writes (1.3.0) ----------
const PROJ = () => path.join(FOLDER, 'memory', 'projects.md');
const pjNorm = n => String(n || '').replace(/[·\n\r]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
const pjKey = n => pjNorm(n).toLowerCase();
const GOAL_MAX = 120;
function readProjectsText() { try { return fs.readFileSync(PROJ(), 'utf8'); } catch (e) { return null; } }
function readProjects() {
  const out = []; String(readProjectsText() || '').split(/^## /m).slice(1).forEach(chunk => {
    const lines = chunk.split('\n'), name = pjNorm(lines.shift()); if (!name) return;
    const p = { name, goal: '', deadline: '', context: '', created: '', closed: '' }; let i = 0;
    for (; i < lines.length; i++) { const m = /^- (Status|Deadline|Goal|Created|Closed):\s*(.*)$/i.exec(lines[i]); if (!m) break; const k = m[1].toLowerCase(), v = m[2].trim(); if (k === 'status') { if (/closed/i.test(v) && !p.closed) p.closed = 'yes'; } else p[k] = v; }
    if (p.closed === 'yes') p.closed = iso(new Date());
    p.context = lines.slice(i).join('\n').trim(); out.push(p);
  }); return out;
}
function projectsText(list) {
  return '# Projects\n\nHodo keeps your projects here. Each has a goal, a deadline and some context; its tasks carry "project <name>" in TASKS.md.\n' + list.map(p => `\n## ${p.name}\n- Status: ${p.closed ? 'closed' : 'open'}\n${p.deadline ? `- Deadline: ${p.deadline}\n` : ''}${p.goal ? `- Goal: ${String(p.goal).replace(/\n+/g, ' ')}\n` : ''}${p.created ? `- Created: ${p.created}\n` : ''}${p.closed ? `- Closed: ${p.closed}\n` : ''}${p.context ? '\n' + String(p.context).replace(/^## /gm, '') + '\n' : ''}`).join('');
}
function writeProjects(list) { fs.mkdirSync(path.dirname(PROJ()), { recursive: true }); fs.writeFileSync(PROJ(), projectsText(list), 'utf8'); }
const findProject = n => readProjects().find(p => pjKey(p.name) === pjKey(n)) || null;
function checkGoal(g) { if (String(g || '').trim().length > GOAL_MAX) throw new Error(`The goal is ${String(g).trim().length} characters; keep it to ${GOAL_MAX} (about two lines): one sentence saying what will be true when the project is done.`); }
// ---------- guardrails (1.3.0) ----------
const DAY_STEP = /^\s*(?:(?:sun|mon|tue|wed|thu|fri|sat)[a-z]*\.?|today|tomorrow|day\s*\d+|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2})\s*[:\-–—]/i;
function checkSteps(steps) {
  const bad = (steps || []).map(s => String(typeof s === 'object' && s ? s.text : s)).filter(s => DAY_STEP.test(s));
  if (bad.length) throw new Error(`Steps are for one sitting of work, not a schedule. These steps belong to different days: ${bad.slice(0, 4).map(s => `"${s}"`).join(', ')}. Make one task per day instead, each planned for its day, in the same project (add_plan does this in one go).`);
}
function checkDates(o, title) {
  const pl = parseDate(o.due), dl = parseDate(o.deadline), p = o.project ? findProject(o.project) : null, pd = p && p.deadline ? parseDate(p.deadline) : null, nm = title ? `“${title}”: ` : '';
  if (pl && dl && day0(pl) > day0(dl)) throw new Error(`${nm}the planned day (${fmtDue(pl)}) is after the deadline (${fmtDue(dl)}). Plan it on or before the deadline, or move the deadline.`);
  if (pd && dl && day0(dl) > day0(pd)) throw new Error(`${nm}the deadline (${fmtDue(dl)}) is after the project's deadline (${fmtDue(pd)}, ${p.name}). Bring it on or before the project's deadline, or change the project's deadline first.`);
  if (pd && pl && day0(pl) > day0(pd)) throw new Error(`${nm}the planned day (${fmtDue(pl)}) is after the project's deadline (${fmtDue(pd)}, ${p.name}). Plan it earlier, or change the project's deadline first.`);
}
// ---------- areas: memory/areas.md, in the same format Hodo writes (1.3.0) ----------
const AREAS = () => path.join(FOLDER, 'memory', 'areas.md');
const AREA_COLOURS = ['Purple', 'Teal', 'Slate', 'Rose', 'Blue', 'Olive', 'Amber'];
const cell = v => String(v == null ? '' : v).replace(/\|/g, '/').replace(/\s*\n\s*/g, ' ').trim();
function readAreasFull() {
  let md = ''; try { md = fs.readFileSync(AREAS(), 'utf8'); } catch (e) { return []; }
  const L = md.split('\n'), h = L.findIndex(l => /^\s*\|/.test(l) && /\barea\b/i.test(l)); if (h < 0) return [];
  const out = []; for (let i = h + 1; i < L.length && /^\s*\|/.test(L[i]); i++) { if (/^\s*\|\s*:?-{2,}/.test(L[i])) continue; const c = L[i].trim().replace(/^\||\|$/g, '').split('|').map(x => x.trim()); if (c[0]) out.push({ name: c[0], colour: c[1] || '', words: (c[2] || '').split(',').map(x => x.trim()).filter(Boolean) }); }
  return out;
}
function writeAreas(list) {
  fs.mkdirSync(path.dirname(AREAS()), { recursive: true });
  fs.writeFileSync(AREAS(), '# Areas\nThe areas your tasks belong to (Settings → Areas). "Suggest when text mentions" = words that make Hodo suggest this area for a new task.\n\n| Area | Colour | Suggest when text mentions |\n|---|---|---|\n' + list.map(a => `| ${cell(a.name)} | ${cell(a.colour)} | ${cell((a.words || []).join(', '))} |`).join('\n') + '\n', 'utf8');
}
// ---------- a copy before big changes, so Hodo can undo them in one click (1.3.0) ----------
const UNDO = () => path.join(FOLDER, 'memory', 'hodo-link', 'undo.json');
const sha1 = t => require('crypto').createHash('sha1').update(String(t)).digest('hex');
function keepUndo(doc, what, count, extra) {
  let areasText = null; try { areasText = fs.readFileSync(AREAS(), 'utf8'); } catch (e) {}
  fs.mkdirSync(path.dirname(UNDO()), { recursive: true });
  fs.writeFileSync(UNDO(), JSON.stringify({ at: Date.now(), what, count, tasks: doc.text, areas: areasText, projects: readProjectsText() }, null, 1));
  return () => { let after = ''; try { after = fs.readFileSync(TASKS(), 'utf8'); } catch (e) {} linkWrite(Object.assign({ seen: Date.now(), last: { at: Date.now(), what }, bulk: { at: Date.now(), what, count, after: sha1(after.replace(/\r\n/g, '\n')) } }, extra || {})); };
}
// rebuild TASKS.md from the parsed doc after changing several task objects at once
function rebuild(doc, changed) {
  const lines = doc.lines.slice(), list = changed.slice().sort((a, b) => b.start - a.start);
  list.forEach(t => lines.splice(t.start, t.end - t.start, ...taskLines(t))); return lines;
}

// ---------- people, areas, permissions ----------
function readAreas() {
  try { return fs.readFileSync(path.join(FOLDER, 'memory', 'areas.md'), 'utf8').split('\n').map(l => l.match(/^\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|/)).filter(m => m && !/^(area|-+)$/i.test(m[1])).map(m => ({ name: m[1], colour: m[2] })); } catch (e) { return []; }
}
function readPeople() {   // memory/people/directory.md: | Full name | Short form | … | Role | …
  try { return fs.readFileSync(path.join(FOLDER, 'memory', 'people', 'directory.md'), 'utf8').split('\n').filter(l => /^\|/.test(l)).map(l => l.split('|').slice(1, -1).map(c => c.trim()))
    .filter(c => c[0] && !/^(full name|-+)$/i.test(c[0])).map(c => ({ name: c[0], short: c[1] || '', role: c[5] || '' })); } catch (e) { return []; }
}
function linkRead() { try { return JSON.parse(fs.readFileSync(LINK(), 'utf8')) || {}; } catch (e) { return {}; } }
// every write carries the version, so Hodo can show which one is installed and offer updates (Oct 29)
function linkWrite(patch) { try { if (!FOLDER) return; fs.mkdirSync(path.dirname(LINK()), { recursive: true }); const o = Object.assign(linkRead(), patch, { version: VERSION }); fs.writeFileSync(LINK(), JSON.stringify(o, null, 2)); } catch (e) {} }
const allowed = k => linkRead()[k] !== false;   // both are on unless switched off in Hodo's Settings

// ---------- waiting and nudge drafts ----------
// Hodo keeps when each wait started and the days it was nudged in the browser ("koi-wait"), copied to memory/hodo-settings.json.
function waitDb() { try { const o = JSON.parse(fs.readFileSync(path.join(FOLDER, 'memory', 'hodo-settings.json'), 'utf8')); return JSON.parse(o['koi-wait'] || '{}') || {}; } catch (e) { return {}; } }
const ND_RE = /^Nudge draft \(([^)]*)\):\s*(.*)$/;
function draftOf(t) {   // "Nudge draft (Oct 25): first line" then "| more lines"
  const i = t.desc.findIndex(l => ND_RE.test(l)); if (i < 0) return null;
  const m = t.desc[i].match(ND_RE), lines = [m[2]]; let j = i + 1;
  while (j < t.desc.length && /^\| ?/.test(t.desc[j])) { lines.push(t.desc[j].replace(/^\| ?/, '')); j++; }
  return { date: m[1], text: lines.join('\n').trim(), start: i, end: j };
}
function sentOf(t) {   // "Nudge sent (Oct 25): …" blocks Hodo keeps when a draft is marked as sent
  const out = []; for (let i = 0; i < t.desc.length; i++) { const m = t.desc[i].match(/^Nudge sent \(([^)]*)\):\s*(.*)$/); if (!m) continue; const ls = [m[2]]; let j = i + 1; while (j < t.desc.length && /^\| ?/.test(t.desc[j])) { ls.push(t.desc[j].replace(/^\| ?/, '')); j++; } out.push({ date: m[1], text: ls.join('\n').trim() }); i = j - 1; }
  return out;
}
function setDraft(t, text) {
  const d = draftOf(t); if (d) t.desc.splice(d.start, d.end - d.start);
  while (t.desc.length && t.desc[t.desc.length - 1] === '') t.desc.pop();
  if (!text) return;
  const ls = String(text).replace(/\r/g, '').trim().split('\n');
  if (t.desc.length) t.desc.push('');
  t.desc.push(`Nudge draft (${fmtShort(new Date())}): ${ls[0]}`, ...ls.slice(1).map(l => '| ' + l));
}
function waitView(t) {
  const o = splitNote(t.note), rec = waitDb()['id:' + t.id] || null, today = day0(new Date());
  const since = rec && rec.since ? new Date(rec.since + 'T00:00:00') : null, nudges = rec && rec.nudges ? rec.nudges : [];
  const last = nudges.length ? new Date(nudges[nudges.length - 1] + 'T00:00:00') : since;
  const planned = parseDate(o.due), dueSoon = planned && (day0(planned) - today) / 864e5 <= 1;
  const due = !nudges.includes(iso(today)) && (dueSoon || !last || (today - day0(last)) / 864e5 >= 2);
  const d = draftOf(t);
  return { id: t.id || t.title, title: t.title, waiting_on: o.waitOn || o.who || '', waiting_since: since ? iso(since) : null, nudged_on: nudges, nudge_due_today: due, planned: o.due || null, deadline: o.deadline || null, description: t.desc.filter((l, i) => !d || i < d.start || i >= d.end).join('\n'), steps: t.steps.map(s => s.text), draft: d ? d.text : null, sent_before: sentOf(t) };
}

// ---------- tools ----------
const view = t => ({ id: t.id || t.title, title: t.title, column: t.section.name, finished: isDone(t.section) || t.checked, note: t.note, description: t.desc.join('\n'), steps: t.steps });
const str = (d, extra) => Object.assign({ type: 'string', description: d }, extra || {});
const FIELDS = { for: str('Who it is for (a name).'), with: str('Who it is done with (a name).'), waiting_on: str('Who you are waiting on (a name). Use with column "Waiting On".'), planned: str('The day it is planned for (YYYY-MM-DD, "today", "tomorrow", or a weekday). Empty string clears it.'), deadline: str('A hard deadline (YYYY-MM-DD). Empty string clears it.'), priority: str('high, medium or low. Only when the person said so.', { enum: ['high', 'medium', 'low', ''] }), area: str('One of the areas from list_people_and_areas.'), this_week: { type: 'boolean', description: 'true to promise it this week (above the This week line in Pending).' }, project: str('The project it belongs to (an open project from list_projects). Empty string takes it out of its project.') };
const TOOLS = [
  { name: 'list_tasks', description: 'List tasks in the Hodo folder: each with its id, title, column, note (people, dates, area, priority), description and steps. Use search to find a task by words in its title or description.',
    inputSchema: { type: 'object', properties: { column: str('Only this column (for example Pending, In Progress, Waiting On, Done).'), search: str('Words to look for.'), include_finished: { type: 'boolean', description: 'Include Done tasks (default false).' }, limit: { type: 'number', description: 'Max tasks (default 50).' } } }, annotations: { title: 'List tasks', readOnlyHint: true } },
  { name: 'add_task', description: 'Add one task to Hodo (Pending by default, at the top). One task = one day of work: steps are for one sitting, never for other days. Keep the title short (under 90 characters), starting with a verb. Put context in description and concrete steps in steps. For a plan spread over days, use add_plan. It appears in Hodo at once, marked "by Claude".',
    inputSchema: { type: 'object', required: ['title'], properties: Object.assign({ title: str('Short task title, verb first.'), column: str('Column name (default Pending).'), description: str('Context, the finish line ("Done = …" as the first line if known), links as text.'), steps: { type: 'array', items: { type: 'string' }, description: 'Sub-tasks, in order.' } }, FIELDS) }, annotations: { title: 'Add a task', readOnlyHint: false, destructiveHint: false } },
  { name: 'update_task', description: 'Change a task: title, people, dates, priority, area, project, description, or steps (add, tick, untick, remove, reorder, or move them to another task). Only the fields you pass change. For many tasks at once, use update_tasks.',
    inputSchema: { type: 'object', required: ['id'], properties: Object.assign({ id: str('The task id (or its exact title).'), title: str('New title.'), description: str('Replaces the description.'), add_steps: { type: 'array', items: { type: 'string' }, description: 'Sub-tasks to add at the end.' }, tick_steps: { type: 'array', items: { type: 'string' }, description: 'Sub-tasks to mark done (their text, or words from it).' }, untick_steps: { type: 'array', items: { type: 'string' }, description: 'Sub-tasks to mark not done.' }, remove_steps: { type: 'array', items: { type: 'string' }, description: 'Sub-tasks to remove.' }, steps: { type: 'array', items: { type: 'string' }, description: 'Replace the whole list of sub-tasks, in this order (done ones stay done when the text is the same). Use it to reorder.' }, move_steps: { type: 'array', items: { type: 'string' }, description: 'Sub-tasks to move to another task (with move_to).' }, move_to: str('The task (id or exact title) that move_steps go to.') }, FIELDS) }, annotations: { title: 'Change a task', readOnlyHint: false, destructiveHint: false } },
  { name: 'move_task', description: 'Move a task to another column: In Progress, Waiting On, Done (finished; its finish date is recorded), Pending, or Parked (set aside for later; it comes back at the weekly review).',
    inputSchema: { type: 'object', required: ['id', 'to'], properties: { id: str('The task id (or its exact title).'), to: str('Column name, "Done" or "Parked".') } }, annotations: { title: 'Move a task', readOnlyHint: false, destructiveHint: false } },
  { name: 'delete_task', description: 'Delete a task into Hodo\'s Waste Yard (it can be restored there for 30 days). Only when the person clearly asked to delete it.',
    inputSchema: { type: 'object', required: ['id'], properties: { id: str('The task id (or its exact title).') } }, annotations: { title: 'Delete a task (to the Waste Yard)', readOnlyHint: false, destructiveHint: true } },
  { name: 'capture', description: 'Drop a raw thought into Hodo\'s Captured list, for the person to decide later. Use add_task instead when it is clearly a task.',
    inputSchema: { type: 'object', required: ['text'], properties: { text: str('The thought, as said.') } }, annotations: { title: 'Capture a thought', readOnlyHint: false, destructiveHint: false } },
  { name: 'list_captures', description: 'List the items waiting in Hodo\'s Captured list, with their ids and whether they are already tidied by Claude.',
    inputSchema: { type: 'object', properties: {} }, annotations: { title: 'List captures', readOnlyHint: true } },
  { name: 'tidy_capture', description: 'Turn one capture into a proper task, kept in Captured for the person to review (Add, Edit or Discard in Hodo). Write a short verb-first title; fill people, dates, area and priority only from what the capture says; put the context and a "Done = …" line in description and concrete steps in steps. The original words are kept.',
    inputSchema: { type: 'object', required: ['id', 'title'], properties: Object.assign({ id: str('The capture id.'), title: str('Short task title, verb first.'), description: str('Context and the finish line.'), steps: { type: 'array', items: { type: 'string' } } }, FIELDS) }, annotations: { title: 'Tidy a capture', readOnlyHint: false, destructiveHint: false } },
  { name: 'list_waiting', description: 'The tasks the person is waiting on someone else for (the Waiting On column): who, since when, the days they already nudged, whether a nudge is due today, any nudge draft already saved, and the nudges already sent (so a new one can follow on from them).',
    inputSchema: { type: 'object', properties: { due_only: { type: 'boolean', description: 'Only the ones with a nudge due today.' } } }, annotations: { title: 'List what you are waiting on', readOnlyHint: true } },
  { name: 'save_nudge_draft', description: 'Save a follow-up message for a waiting task, for the person to copy and send themselves (Hodo never sends it). Write it as the person, short and polite: what is needed, by when if known, and an easy way to answer. Match the language and tone of the task and of earlier messages. One draft per task; saving again replaces it; an empty text removes it.',
    inputSchema: { type: 'object', required: ['id', 'text'], properties: { id: str('The waiting task id (or its exact title).'), text: str('The message, ready to send. Line breaks are kept.') } }, annotations: { title: 'Save a nudge draft', readOnlyHint: false, destructiveHint: false } },
  { name: 'list_people_and_areas', description: 'The people and areas Hodo knows, so names and areas match what the person already uses.',
    inputSchema: { type: 'object', properties: {} }, annotations: { title: 'People and areas', readOnlyHint: true } }
];

// one task's changes (used by update_task and update_tasks); steps can be added, ticked, unticked, removed, reordered or moved
const stepMatch = (t, k, pred) => { k = String(k || '').toLowerCase().trim(); if (!k) return -1; let i = t.steps.findIndex(x => x.text.toLowerCase() === k && (!pred || pred(x))); if (i < 0) i = t.steps.findIndex(x => x.text.toLowerCase().includes(k) && (!pred || pred(x))); return i; };
function changeTask(doc, t, a, changed) {
  checkSteps(a.add_steps); checkSteps(a.steps);
  const o = splitNote(t.note); applyFields(o, a);
  if (a.planned !== undefined || a.deadline !== undefined || a.project !== undefined) checkDates(o, a.title ? cleanTitle(a.title) : t.title);
  markClaude(o); t.note = joinNote(o);
  if (a.title) t.title = cleanTitle(a.title);
  if (a.description !== undefined) t.desc = String(a.description || '').split('\n').filter((l, i, arr) => l || i < arr.length - 1);
  if (Array.isArray(a.steps)) { const old = t.steps; t.steps = a.steps.map(x => String(x).trim()).filter(Boolean).map(x => { const was = old.find(y => y.text.toLowerCase() === x.toLowerCase()); return { text: x, done: !!(was && was.done) }; }); }
  (a.remove_steps || []).forEach(k => { const i = stepMatch(t, k); if (i < 0) throw new Error(`“${t.title}” has no step matching "${k}".`); t.steps.splice(i, 1); });
  (a.add_steps || []).forEach(x => { x = String(x).trim(); if (x) t.steps.push({ text: x, done: false }); });
  (a.tick_steps || []).forEach(k => { const i = stepMatch(t, k, x => !x.done); if (i >= 0) t.steps[i].done = true; });
  (a.untick_steps || []).forEach(k => { const i = stepMatch(t, k, x => x.done); if (i >= 0) t.steps[i].done = false; });
  if (a.move_steps && a.move_steps.length) {
    if (!a.move_to) throw new Error('move_steps needs move_to: the task to move them to.');
    const dest = find(doc, a.move_to, s => !/^(deleted|waste yard|let go|released)$/i.test(s.name)); if (dest === t) throw new Error('move_to is the same task.');
    a.move_steps.forEach(k => { const i = stepMatch(t, k); if (i < 0) throw new Error(`“${t.title}” has no step matching "${k}".`); dest.steps.push(t.steps.splice(i, 1)[0]); });
    const od = splitNote(dest.note); markClaude(od); dest.note = joinNote(od); if (!changed.includes(dest)) changed.push(dest);
  }
}
function did(what) { linkWrite({ seen: Date.now(), last: { at: Date.now(), what } }); }
const RUN = {
  list_tasks(a) {
    const doc = load(), q = String(a.search || '').toLowerCase(), lim = Math.min(200, a.limit || 50);
    let cols = boardCols(doc); if (a.column) cols = cols.filter(s => s.name.toLowerCase() === String(a.column).toLowerCase());
    if (!a.include_finished) cols = cols.filter(s => !isDone(s));
    const out = cols.flatMap(s => s.tasks).filter(t => !q || (t.title + ' ' + t.desc.join(' ')).toLowerCase().includes(q)).slice(0, lim).map(view);
    linkWrite({ seen: Date.now() });
    return { columns: boardCols(doc).map(s => ({ name: s.name, tasks: s.tasks.length })), tasks: out };
  },
  add_task(a) {
    if (!allowed('canChange')) throw new Error('Adding and changing tasks is switched off in Hodo (Settings → Hodo Link).');
    const doc = load(), title = cleanTitle(a.title); if (!title) throw new Error('A title is needed.');
    const col = a.column ? boardCols(doc).find(s => s.name.toLowerCase() === String(a.column).toLowerCase()) : (a.waiting_on ? boardCols(doc).find(isWait) : pending(doc));
    if (!col) throw new Error(`No column called "${a.column}". Columns: ${boardCols(doc).map(s => s.name).join(', ')}.`);
    checkSteps(a.steps);
    const o = splitNote(''); applyFields(o, a); checkDates(o, title); markClaude(o);
    const t = { id: newUid(), title, note: joinNote(o), checked: isDone(col), desc: a.description ? String(a.description).split('\n') : [], links: [], steps: (a.steps || []).map(s => ({ text: String(s).trim(), done: false })).filter(s => s.text) };
    const lines = doc.lines.slice(); lines.splice(col.line + 1, 0, ...taskLines(t)); save(doc, lines); did(`added “${title}”`);
    return { added: { id: t.id, title, column: col.name, note: t.note } };
  },
  update_task(a) {
    if (!allowed('canChange')) throw new Error('Adding and changing tasks is switched off in Hodo (Settings → Hodo Link).');
    const doc = load(), t = find(doc, a.id, s => !/^(deleted|waste yard|let go|released)$/i.test(s.name)), changed = [t];
    changeTask(doc, t, a, changed);
    save(doc, rebuild(doc, changed)); did(`changed “${t.title}”`);
    return Object.assign({ updated: view(t) }, changed.length > 1 ? { also_changed: changed.slice(1).map(view) } : {});
  },
  move_task(a) {
    if (!allowed('canChange')) throw new Error('Adding and changing tasks is switched off in Hodo (Settings → Hodo Link).');
    const doc = load(), t = find(doc, a.id, s => !SPECIAL.test(s.name) || /^captured$/i.test(s.name)), to = String(a.to || '').trim(), now = new Date();
    let dest, o = splitNote(t.note);
    if (/^parked$/i.test(to)) {
      dest = sec(doc, /^(parked|deep water)$/i);
      if (!dest) { const lines0 = doc.lines.slice(); while (lines0.length && lines0[lines0.length - 1] === '') lines0.pop(); lines0.push('', '## Parked'); save(doc, lines0); return RUN.move_task(a); }   // first time: make the Parked list
      const rest = [o.who ? 'for ' + o.who : '', ...o.areas, o.priority ? o.priority[0].toUpperCase() + o.priority.slice(1) : '', ...o.rest.filter(r => !/^by Claude\b/i.test(r))].filter(Boolean);
      const dl = parseDate(o.deadline), back = dl && new Date(dl.getFullYear(), dl.getMonth(), dl.getDate() - 3);   // like Hodo: a deadline brings it back 3 days before
      t.note = [...rest, (t.steps.length > 3 || t.desc.length > 4) ? 'big' : 'small', back && back > now ? 'until ' + fmtDue(back) : '', 'added ' + fmtDue(now), byClaude()].filter(Boolean).join(' · '); t.checked = false;
    } else {
      dest = boardCols(doc).find(s => s.name.toLowerCase() === to.toLowerCase()) || (/^done$/i.test(to) ? boardCols(doc).find(isDone) : null);
      if (!dest) throw new Error(`No column called "${to}". Columns: ${boardCols(doc).map(s => s.name).join(', ')}, or Parked.`);
      o.rest = o.rest.filter(r => !/^(completed|caught|via)\s/i.test(r)); if (isDone(dest)) o.rest.push('completed ' + fmtShort(now)); markClaude(o); t.note = joinNote(o); t.checked = isDone(dest);
    }
    if (dest === t.section) return { unchanged: `“${t.title}” is already in ${dest.name}.` };
    const block = taskLines(t), lines = doc.lines.slice();
    lines.splice(t.start, t.end - t.start);
    const at = dest.line > t.start ? dest.line - (t.end - t.start) : dest.line;
    lines.splice(at + 1, 0, ...block); save(doc, lines); did(`moved “${t.title}” to ${dest.name}`);
    return { moved: { id: t.id, title: t.title, to: dest.name } };
  },
  delete_task(a) {
    if (!allowed('canDelete')) throw new Error('Deleting is switched off in Hodo (Settings → Hodo Link).');
    const doc = load(), t = find(doc, a.id, s => !/^(deleted|waste yard)$/i.test(s.name)), was = t.section.name, lines = doc.lines.slice();
    t.note = (t.note ? t.note.replace(/\s*·?\s*deleted \d{4}-\d{2}-\d{2}( · was [^·]+)?/g, '') + ' · ' : '') + `deleted ${iso(new Date())} · was ${was}`;
    let bin = sec(doc, /^(deleted|waste yard)$/i);
    lines.splice(t.start, t.end - t.start);
    if (bin) { const at = bin.line > t.start ? bin.line - (t.end - t.start) : bin.line; lines.splice(at + 1, 0, ...taskLines(t)); }
    else { while (lines.length && lines[lines.length - 1] === '') lines.pop(); lines.push('', '## Deleted', ...taskLines(t)); }
    save(doc, lines); did(`deleted “${t.title}”`);
    return { deleted: { id: t.id, title: t.title, was, note: 'It is in the Waste Yard in Hodo for 30 days.' } };
  },
  capture(a) {
    if (!allowed('canChange')) throw new Error('Adding and changing tasks is switched off in Hodo (Settings → Hodo Link).');
    const doc = load(), text = String(a.text || '').trim(); if (!text) throw new Error('Nothing to capture.');
    const cap = sec(doc, /^captured$/i), title = cleanTitle(text.split('\n')[0]);
    const t = { id: newUid(), title, note: `via Claude · caught ${fmtShort(new Date())}`, checked: false, desc: title !== text ? ['Captured: ' + text.replace(/\n/g, ' ')] : [], links: [], steps: [] };
    const lines = doc.lines.slice();
    if (cap) lines.splice(cap.line + 1, 0, ...taskLines(t)); else { while (lines.length && lines[lines.length - 1] === '') lines.pop(); lines.push('', '## Captured', ...taskLines(t)); }
    save(doc, lines); did(`caught “${title}”`);
    return { captured: { id: t.id, title } };
  },
  list_captures() {
    const doc = load(), cap = sec(doc, /^captured$/i); linkWrite({ seen: Date.now() });
    return { captures: (cap ? cap.tasks : []).map(t => ({ id: t.id, title: t.title, tidied: /(^|·\s*)tidied by Claude/i.test(t.note), note: t.note, description: t.desc.join('\n'), steps: t.steps.map(s => s.text) })) };
  },
  tidy_capture(a) {
    if (!allowed('canChange')) throw new Error('Adding and changing tasks is switched off in Hodo (Settings → Hodo Link).');
    const doc = load(), t = find(doc, a.id, s => /^captured$/i.test(s.name)), title = cleanTitle(a.title);
    if (!title) throw new Error('A title is needed.');
    const keep = (t.note.split(/\s+·\s+/).filter(p => /^(via|caught)\s/i.test(p)));
    checkSteps(a.steps);
    const o = splitNote(''); applyFields(o, a); checkDates(o, title); o.rest = [...keep, `tidied by Claude ${fmtShort(new Date())}`];
    const capLine = t.desc.find(l => /^Captured:\s/i.test(l)), original = capLine ? capLine.replace(/^Captured:\s*/i, '') : [t.title, ...t.desc].join(' ').trim();
    const desc = a.description ? String(a.description).split('\n') : [];
    if (!desc.some(l => /^Captured:\s/i.test(l))) { if (desc.length) desc.push(''); desc.push('Captured: ' + original); }
    t.title = title; t.note = joinNote(o); t.desc = desc; t.steps = (a.steps || []).map(s => ({ text: String(s).trim(), done: false })).filter(s => s.text);
    const lines = doc.lines.slice(); lines.splice(t.start, t.end - t.start, ...taskLines(t)); save(doc, lines);
    linkWrite({ seen: Date.now(), tidiedAt: Date.now(), last: { at: Date.now(), what: `tidied “${title}”` } });
    return { tidied: { id: t.id, title, note: t.note }, next: 'It waits in Captured for the person to review.' };
  },
  list_waiting(a) {
    const doc = load(); linkWrite({ seen: Date.now() });
    const out = boardCols(doc).filter(isWait).flatMap(s => s.tasks).filter(t => !t.checked).map(waitView).filter(w => !a.due_only || w.nudge_due_today);
    return { waiting: out };
  },
  save_nudge_draft(a) {
    if (!allowed('canChange')) throw new Error('Adding and changing tasks is switched off in Hodo (Settings → Hodo Link).');
    const doc = load(), t = find(doc, a.id, s => isWait(s) && !SPECIAL.test(s.name));
    setDraft(t, a.text);
    const o = splitNote(t.note); markClaude(o); t.note = joinNote(o);
    const lines = doc.lines.slice(); lines.splice(t.start, t.end - t.start, ...taskLines(t)); save(doc, lines);
    linkWrite({ seen: Date.now(), draftedAt: Date.now(), last: { at: Date.now(), what: a.text ? `drafted a nudge for “${t.title}”` : `removed the nudge draft for “${t.title}”` } });
    return a.text ? { saved: { id: t.id, title: t.title }, next: 'It shows in Hodo as “Draft ready” on the card, for the person to copy and send.' } : { removed: { id: t.id, title: t.title } };
  },
  list_people_and_areas() { linkWrite({ seen: Date.now() }); return { people: readPeople(), areas: readAreas() }; }
};


// ---------- 1.3.0: projects, whole plans, many changes at once, areas ----------
const projView = (doc, p) => { const ts = boardCols(doc).flatMap(s => s.tasks).filter(t => pjKey(splitNote(t.note).project) === pjKey(p.name));
  return { name: p.name, status: p.closed ? 'closed' : 'open', goal: p.goal, deadline: p.deadline || null, context: p.context, tasks: ts.length, done: ts.filter(t => isDone(t.section) || t.checked).length,
    open_tasks: ts.filter(t => !(isDone(t.section) || t.checked)).map(t => ({ id: t.id, title: t.title, column: t.section.name, planned: splitNote(t.note).due || null, deadline: splitNote(t.note).deadline || null })) }; };
const ymdOf = (v, what) => { if (v === '' || v === null) return ''; const d = parseDate(v); if (!d) throw new Error(`Couldn't read the ${what} "${v}". Use YYYY-MM-DD.`); return iso(d); };
function upsertProject(list, a, doc) {
  const name = pjNorm(a.name); if (!name) throw new Error('A project needs a name.');
  let p = list.find(x => pjKey(x.name) === pjKey(name)), renamed = null;
  if (!p) { p = { name, goal: '', deadline: '', context: '', created: iso(new Date()), closed: '' }; list.push(p); }
  if (a.goal !== undefined) { checkGoal(a.goal); p.goal = String(a.goal || '').replace(/\s*\n+\s*/g, ' ').trim(); }
  if (a.deadline !== undefined) p.deadline = ymdOf(a.deadline, 'deadline');
  if (a.context !== undefined) p.context = String(a.context || '').trim();
  if (a.status === 'closed' && !p.closed) p.closed = iso(new Date()); else if (a.status === 'open') p.closed = '';
  if (a.new_name && pjKey(a.new_name) !== pjKey(p.name)) { const nn = pjNorm(a.new_name); if (list.some(x => x !== p && pjKey(x.name) === pjKey(nn))) throw new Error(`There's already a project called "${nn}".`); renamed = { from: p.name, to: nn }; p.name = nn; }
  if (p.deadline && doc) { const pd = parseDate(p.deadline); const late = boardCols(doc).flatMap(s => s.tasks).filter(t => { const o = splitNote(t.note); if (pjKey(o.project) !== pjKey(renamed ? renamed.from : p.name) || isDone(t.section) || t.checked) return false; const dl = parseDate(o.deadline), pl = parseDate(o.due); return (dl && day0(dl) > day0(pd)) || (pl && day0(pl) > day0(pd)); });
    if (late.length) throw new Error(`The project's deadline (${fmtDue(pd)}) would come before tasks already planned or due later: ${late.slice(0, 5).map(t => `“${t.title}”`).join(', ')}. Move those first (update_tasks), or pick a later deadline.`); }
  return { p, renamed };
}
TOOLS.push(
  { name: 'list_projects', description: 'The person\'s projects: each with its goal, deadline, context, how many tasks are done, and its open tasks. A project is a goal with an end, made of several tasks (an area never ends; a project does).',
    inputSchema: { type: 'object', properties: { include_closed: { type: 'boolean', description: 'Include finished (closed) projects.' } } }, annotations: { title: 'List projects', readOnlyHint: true } },
  { name: 'save_project', description: 'Create a project, or change one: goal (one sentence, at most 120 characters, saying what will be true when it is done), deadline, context, status (open or closed), or rename it (every task follows).',
    inputSchema: { type: 'object', required: ['name'], properties: { name: str('The project\'s name (an existing one to change it).'), new_name: str('A new name.'), goal: str('What will be true when it is done. One sentence, at most 120 characters.'), deadline: str('The project\'s deadline (YYYY-MM-DD). Empty string clears it.'), context: str('Background: why it matters, who is involved, links. Any length.'), status: str('open or closed.', { enum: ['open', 'closed'] }) } }, annotations: { title: 'Save a project', readOnlyHint: false, destructiveHint: false } },
  { name: 'add_plan', description: 'Put a whole plan into Hodo in one go: a project (created or updated) and its tasks, one task per day of work, each planned for its day. Everything is checked first and written all at once or not at all; the person can undo it in Hodo with one click. Use this whenever a plan spreads work over several days.',
    inputSchema: { type: 'object', required: ['tasks'], properties: { project: { type: 'object', description: 'The project these tasks belong to (created if new).', properties: { name: str('Project name.'), goal: str('What will be true when it is done (at most 120 characters).'), deadline: str('YYYY-MM-DD.'), context: str('Background.') }, required: ['name'] },
      tasks: { type: 'array', description: 'The tasks, in order. Each is one day\'s piece of work.', items: { type: 'object', required: ['title'], properties: Object.assign({ title: str('Short task title, verb first.'), column: str('Column (default Pending).'), description: str('Context, and "Done = …" as the first line if known.'), steps: { type: 'array', items: { type: 'string' }, description: 'Steps for this one sitting (no day names).' } }, FIELDS) } } } }, annotations: { title: 'Add a whole plan', readOnlyHint: false, destructiveHint: false } },
  { name: 'update_tasks', description: 'Change many tasks in one go (areas, projects, dates, priority, people, titles, steps…). Each change is like update_task. Everything is checked first and applied all at once or not at all; the person can undo it in Hodo with one click.',
    inputSchema: { type: 'object', required: ['changes'], properties: { changes: { type: 'array', description: 'One entry per task: its id plus the fields to change.', items: { type: 'object', required: ['id'], properties: Object.assign({ id: str('The task id (or its exact title).'), title: str('New title.'), description: str('Replaces the description.') }, FIELDS) } } } }, annotations: { title: 'Change many tasks', readOnlyHint: false, destructiveHint: false } },
  { name: 'manage_areas', description: 'Change the person\'s areas: add new ones, rename (every task follows), recolour, or remove (taken off its tasks). Colours: Purple, Teal, Slate, Rose, Blue, Olive, Amber. The person can undo it in Hodo with one click.',
    inputSchema: { type: 'object', properties: { add: { type: 'array', items: { type: 'object', required: ['name'], properties: { name: str('Area name.'), colour: str('Purple, Teal, Slate, Rose, Blue, Olive or Amber.') } } }, rename: { type: 'array', items: { type: 'object', required: ['from', 'to'], properties: { from: str('Current name.'), to: str('New name.') } } }, recolour: { type: 'array', items: { type: 'object', required: ['name', 'colour'], properties: { name: str('Area name.'), colour: str('Colour.') } } }, remove: { type: 'array', items: { type: 'string' }, description: 'Areas to remove (taken off their tasks).' } } }, annotations: { title: 'Change areas', readOnlyHint: false, destructiveHint: true } }
);
TOOLS.find(t => t.name === 'list_tasks').inputSchema.properties.project = str('Only tasks in this project.');
{ const _lt = RUN.list_tasks; RUN.list_tasks = function (a) { const r = _lt.call(this, Object.assign({}, a, { limit: a.project ? 200 : a.limit })); if (a.project) r.tasks = r.tasks.filter(t => pjKey(splitNote(t.note).project) === pjKey(a.project)); return r; }; }
Object.assign(RUN, {
  list_projects(a) { const doc = load(); linkWrite({ seen: Date.now() }); return { projects: readProjects().filter(p => a.include_closed || !p.closed).map(p => projView(doc, p)) }; },
  save_project(a) {
    if (!allowed('canChange')) throw new Error('Adding and changing tasks is switched off in Hodo (Settings → Hodo Link).');
    const doc = load(), list = readProjects(), { p, renamed } = upsertProject(list, a, doc);
    if (renamed) {
      const ts = boardCols(doc).concat(doc.sections.filter(s => /^(parked|deep water)$/i.test(s.name))).flatMap(s => s.tasks).filter(t => pjKey(splitNote(t.note).project) === pjKey(renamed.from));
      const finish = keepUndo(doc, `renamed the project “${renamed.from}” to “${renamed.to}”`, ts.length);
      ts.forEach(t => { const o = splitNote(t.note); o.project = renamed.to; t.note = joinNote(o); });
      writeProjects(list); if (ts.length) save(doc, rebuild(doc, ts)); finish();
    } else { writeProjects(list); did(`saved the project “${p.name}”`); }
    return { saved: projView(load(), p) };
  },
  add_plan(a) {
    if (!allowed('canChange')) throw new Error('Adding and changing tasks is switched off in Hodo (Settings → Hodo Link).');
    const doc = load(), list = readProjects(), items = Array.isArray(a.tasks) ? a.tasks : [];
    if (!items.length) throw new Error('A plan needs at least one task.');
    let proj = null; if (a.project) proj = upsertProject(list, a.project, doc).p;
    // check everything first, against the project as it will be
    const projBefore = readProjectsText(); writeProjects(list);
    const built = [];
    try {
      items.forEach((it, n) => {
        const title = cleanTitle(it.title); if (!title) throw new Error(`Task ${n + 1} has no title.`);
        checkSteps(it.steps);
        const col = it.column ? boardCols(doc).find(s => s.name.toLowerCase() === String(it.column).toLowerCase()) : (it.waiting_on ? boardCols(doc).find(isWait) : pending(doc));
        if (!col) throw new Error(`“${title}”: no column called "${it.column}". Columns: ${boardCols(doc).map(s => s.name).join(', ')}.`);
        const o = splitNote(''); applyFields(o, Object.assign({}, it, proj && it.project === undefined ? { project: proj.name } : {})); checkDates(o, title); markClaude(o);
        built.push({ col, t: { id: newUid(), title, note: joinNote(o), checked: isDone(col), desc: it.description ? String(it.description).split('\n') : [], links: [], steps: (it.steps || []).map(x => ({ text: String(x).trim(), done: false })).filter(x => x.text) } });
      });
    } catch (e) { if (projBefore == null) { try { fs.unlinkSync(PROJ()); } catch (x) {} } else fs.writeFileSync(PROJ(), projBefore, 'utf8'); throw e; }
    const what = `added a plan of ${built.length} task${built.length === 1 ? '' : 's'}${proj ? ` to “${proj.name}”` : ''}`;
    const finish = keepUndo(Object.assign({}, doc, { text: doc.text }), what, built.length);
    if (projBefore != null || proj) { try { const u = JSON.parse(fs.readFileSync(UNDO(), 'utf8')); u.projects = projBefore; fs.writeFileSync(UNDO(), JSON.stringify(u, null, 1)); } catch (e) {} }
    const lines = doc.lines.slice();
    // insert per column, keeping the plan's order, below each column's heading
    const byCol = new Map(); built.forEach(b => { if (!byCol.has(b.col)) byCol.set(b.col, []); byCol.get(b.col).push(b.t); });
    [...byCol.entries()].sort((x, y) => y[0].line - x[0].line).forEach(([col, ts]) => lines.splice(col.line + 1, 0, ...ts.flatMap(taskLines)));
    save(doc, lines); finish();
    return { added: built.map(b => ({ id: b.t.id, title: b.t.title, column: b.col.name, planned: splitNote(b.t.note).due || null, deadline: splitNote(b.t.note).deadline || null })), project: proj ? projView(load(), proj) : null, summary: what + '. Tell the person what was added, and that Hodo can undo it in one click.' };
  },
  update_tasks(a) {
    if (!allowed('canChange')) throw new Error('Adding and changing tasks is switched off in Hodo (Settings → Hodo Link).');
    const doc = load(), changes = Array.isArray(a.changes) ? a.changes : []; if (!changes.length) throw new Error('No changes given.');
    const changed = [];
    changes.forEach((c, n) => { let t; try { t = find(doc, c.id, s => !/^(deleted|waste yard|let go|released)$/i.test(s.name)); } catch (e) { throw new Error(`Change ${n + 1}: ${e.message}`); } if (!changed.includes(t)) changed.push(t); changeTask(doc, t, c, changed); });
    const what = `changed ${changed.length} task${changed.length === 1 ? '' : 's'}`, finish = keepUndo(doc, what, changed.length);
    save(doc, rebuild(doc, changed)); finish();
    return { changed: changed.length, tasks: changed.map(t => ({ id: t.id, title: t.title, note: t.note })), summary: what + '. Hodo can undo it in one click.' };
  },
  manage_areas(a) {
    if (!allowed('canChange')) throw new Error('Adding and changing tasks is switched off in Hodo (Settings → Hodo Link).');
    const doc = load(), list = readAreasFull(), key = n => String(n || '').trim().toLowerCase(), colour = c => { if (!c) return ''; const m = AREA_COLOURS.find(x => x.toLowerCase() === String(c).trim().toLowerCase()); if (!m) throw new Error(`"${c}" isn't a colour Hodo has: ${AREA_COLOURS.join(', ')}.`); return m; };
    const notes = []; let used = list.map(x => x.colour);
    (a.add || []).forEach(x => { const n = cell(x.name); if (!n) throw new Error('An area needs a name.'); if (list.some(y => key(y.name) === key(n))) { notes.push(`“${n}” already exists`); return; } const c = colour(x.colour) || AREA_COLOURS.find(k => !used.includes(k)) || AREA_COLOURS[list.length % AREA_COLOURS.length]; used.push(c); list.push({ name: n, colour: c, words: [] }); });
    const renames = (a.rename || []).map(r => { const ar = list.find(y => key(y.name) === key(r.from)); if (!ar) throw new Error(`No area called "${r.from}". Areas: ${list.map(y => y.name).join(', ')}.`); const to = cell(r.to); if (!to) throw new Error('A new name is needed.'); if (key(to) !== key(ar.name) && list.some(y => y !== ar && key(y.name) === key(to))) throw new Error(`There's already an area called "${to}".`); const from = ar.name; ar.name = to; return { from, to }; });
    (a.recolour || []).forEach(r => { const ar = list.find(y => key(y.name) === key(r.name)); if (!ar) throw new Error(`No area called "${r.name}".`); ar.colour = colour(r.colour); });
    const removes = (a.remove || []).map(n => { const i = list.findIndex(y => key(y.name) === key(n)); if (i < 0) throw new Error(`No area called "${n}".`); return list.splice(i, 1)[0].name; });
    const touched = [];
    doc.sections.forEach(s => s.tasks.forEach(t => { const parts = t.note ? t.note.split(/\s+·\s+/) : []; let ch = false;
      const out = parts.map(p => { const r = renames.find(x => key(x.from) === key(p)); if (r) { ch = true; return r.to; } if (removes.some(x => key(x) === key(p))) { ch = true; return null; } return p; }).filter(x => x !== null);
      if (ch) { t.note = out.join(' · '); touched.push(t); } }));
    const what = [ (a.add || []).length ? `added ${(a.add || []).length} area${(a.add || []).length === 1 ? '' : 's'}` : '', renames.length ? `renamed ${renames.length}` : '', (a.recolour || []).length ? `recoloured ${(a.recolour || []).length}` : '', removes.length ? `removed ${removes.length}` : '' ].filter(Boolean).join(', ') || 'changed nothing';
    const finish = keepUndo(doc, `${what} (areas)${touched.length ? `, ${touched.length} task${touched.length === 1 ? '' : 's'} updated` : ''}`, touched.length);
    writeAreas(list); if (touched.length) save(doc, rebuild(doc, touched)); finish();
    return { areas: list.map(x => ({ name: x.name, colour: x.colour })), tasks_updated: touched.length, notes, summary: what + '. Hodo can undo it in one click.' };
  }
});
// the step guard also covers tidy_capture and add_task; areas from manage_areas are what applyFields accepts (readAreas)

// ---------- how Claude should work with Hodo (sent once, when Claude starts the extension) ----------
const INSTRUCTIONS = [
  'Hodo is the person\'s task app; its tasks live in TASKS.md in their Hodo folder. Use these tools to see and change their tasks.',
  'One task = one day of work. Steps are for one sitting, never a schedule: never put steps for different days in one task. When work spreads over several days, make one task per day, each planned for its day, all in the same project. add_plan does this in one go (all or nothing) and is the way to put any multi-day plan into Hodo.',
  'A project is a goal with an end, made of several tasks; an area never ends. Before adding tasks for a goal, check list_projects; reuse an existing project rather than making a near-duplicate. A project\'s goal is one sentence, at most 120 characters, saying what will be true when it is done (an outcome, not an activity).',
  'Dates: a task\'s planned day must be on or before its deadline, and both on or before its project\'s deadline. Hodo Link refuses anything else; fix the plan rather than forcing it.',
  'For many changes at once (re-sorting areas, moving dates, renaming), use update_tasks or manage_areas: one call, all or nothing, and the person can undo it in Hodo with one click. Say what changed in one or two lines afterwards.',
  'Keep titles short and verb-first. Only set priority, dates or people the person actually gave. Ask before deleting anything. Never send messages on the person\'s behalf; nudge drafts are for them to send.'
].join('\n');
// ---------- prompts: Hodo's rituals, ready to start from Claude's prompt menu ----------
const PROMPTS = [
  { name: 'plan_my_day', title: 'Plan my day with Hodo', description: 'Choose today\'s Three from your Hodo tasks.' },
  { name: 'land_the_day', title: 'Land the day', description: 'Close the day: what got done, what moves to tomorrow.' },
  { name: 'weekly_reset', title: 'Weekly reset', description: 'Close last week and set this one.' },
  { name: 'tidy_captures', title: 'Tidy my captures', description: 'Turn your Captured items into proper tasks to review.' },
  { name: 'plan_a_project', title: 'Turn a plan into a Hodo project', description: 'Paste a plan; Claude puts it into Hodo as a project with one task per day.', arguments: [{ name: 'plan', description: 'The plan, in your words.', required: false }] }
];
const PROMPT_TEXT = {
  plan_my_day: 'Help me plan my day in Hodo. Read my tasks (list_tasks) and my projects (list_projects). Suggest three tasks for today, the ones that matter most, with a one-line reason each, looking at deadlines, what is planned for today and what has waited longest. Ask me to confirm or swap, then plan the three for today (update_tasks with planned: today). Keep it short.',
  land_the_day: 'Help me land the day in Hodo. Look at what I planned for today (list_tasks) and what is done. Tell me in a few lines what got done. For each unfinished task, ask whether it moves to tomorrow, later this week, or gets parked, then make those changes in one go (update_tasks). End with one line on what tomorrow starts with.',
  weekly_reset: 'Help me do my weekly reset in Hodo. Summarise last week from my tasks (what got done, what slipped), check my projects (list_projects) against their deadlines, and help me choose this week\'s tasks (this_week: true). Flag anything planned after its deadline. Make the changes in one go (update_tasks) once I agree.',
  tidy_captures: 'Tidy my Hodo captures: list_captures, then turn each untidied one into a proper task with tidy_capture (short verb-first title, a "Done = …" line, steps for one sitting). Leave them in Captured for me to review, and tell me how many you tidied.',
  plan_a_project: 'Put this plan into Hodo as a project. Give it a short name, a goal of at most 120 characters (what will be true when it is done) and a deadline. Split the work into one task per day of work, each planned for its day, with steps only for that sitting, and every date on or before the project\'s deadline. Show me the list first; when I agree, add it all with add_plan and tell me what was added.'
};
function getPrompt(name, args) {
  const t = PROMPT_TEXT[name]; if (!t) throw new Error(`Unknown prompt: ${name}`);
  const extra = args && args.plan ? `\n\nThe plan:\n${args.plan}` : '';
  return { description: (PROMPTS.find(p => p.name === name) || {}).description || '', messages: [{ role: 'user', content: { type: 'text', text: t + extra } }] };
}
function onStart(shell) { linkWrite(Object.assign({ startedAt: Date.now() }, shell ? { shell } : {})); }
module.exports = { VERSION, TOOLS, RUN, PROMPTS, getPrompt, INSTRUCTIONS, onStart, linkWrite, FOLDER, load, splitNote, joinNote, parseDate, fmtDue, readProjects };
