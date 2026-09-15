const PROJECTS = {
  harbor:   { id:'harbor', name:'harbor-api', kind:'Client · Saltworks', stack:'TypeScript', meta:'api.saltworks.dev', color:'#5eb3f1', base:'main @ 4f2a91 · deployed Friday' },
  waypoint: { id:'waypoint', name:'waypoint', kind:'OSS · 2 open PRs', stack:'Rust', meta:'240 ★ · v0.9.2', color:'#e0aa4e', base:'main @ c81e07' },
  driftwood:{ id:'driftwood', name:'driftwood', kind:'Personal · essays', stack:'Eleventy', meta:'driftwood.sh', color:'#9db98a', base:'main @ 77b2c4' },
};

const BRANCHES = [
  { id:'auth', proj:'harbor', git:'feat/auth-refresh', name:'The token refresh thing', angle:42,
    status:['warm','Warm · resuming'], ahead:6, behind:1, last:'38 minutes ago', when:'Sep 13 · 11:42', spark:[0,1,2,2,0,3],
    note:'Bug is in refresh, not issue. I was wrong yesterday — the 401s start AFTER a refresh, so the issue path is fine. Check clock skew on the verifier first.',
    dirty:['verifier.ts +12 −4','clock.ts +3','refresh.test.ts +2 −1'],
    story:[
      ['Sep 9 · 10:12','branch','branched from main to chase the midnight 401s','same mystery, new angle'],
      ['Sep 9 · 10:14','commit','wip: log 401 bursts','bursts cluster at :00 — smells like a cron-issued token'],
      ['Sep 9 · 15:02','commit','instrument verifier clocks','server clock runs 340ms behind — suspicious'],
      ['Sep 10 · 09:30','win','repro: expires after 5min','first red test that is actually the bug'],
      ['Sep 10 · 17:45','wrong','try: bump issue TTL','dead end — issue path is fine. revert tomorrow'],
      ['Sep 13 · 11:24','commit','skew-aware compare in verifier','the real fix, I think'],
      ['Sep 13 · 11:31','test','ran suite — 1 failing','token refresh › expires after 5min'],
      ['Sep 13 · 11:38','files'],
      ['Sep 13 · 11:42','left','left for lunch — 3 files uncommitted','wrote the resume note before walking out'],
    ]},
  { id:'billing', proj:'harbor', git:'feat/billing-webhooks', name:'Invoices falling over at midnight', angle:118,
    status:['alert','CI red · 2 days'], ahead:9, behind:2, last:'2 days ago', when:'Sep 11 · 11:00', spark:[0,3,2,1,1,0],
    note:'Root cause: we upsert before the txn commits, so the second retry sees a half-written row. Fix is the transaction wrapper, NOT more retries. Stop adding retries.',
    story:[
      ['Sep 2 · 14:20','branch','branched from main — midnight invoice failures','new branch, same mystery as the 401s (different ending)'],
      ['Sep 2 · 16:05','commit','handle invoice.paid',''],
      ['Sep 3 · 11:40','commit','retry on 500',''],
      ['Sep 4 · 10:15','wrong','hotfix: 4th retry','stop adding retries — the race is on our side. fix = transaction wrapper'],
      ['Sep 8 · 09:00','note','root cause pinned','upsert before txn commit — second retry reads a half-written row'],
      ['Sep 11 · 09:15','commit','log retry storm','4 retries inside 40s at 00:04 UTC — definitely a race'],
      ['Sep 11 · 11:00','ci','CI red — 2 days and counting','race reproduces on the invoice table under load'],
    ]},
  { id:'tok', proj:'waypoint', git:'tok/rewrite-stream', name:'The borrow checker fight', angle:275,
    status:['ready','Green · merge-ready'], ahead:14, behind:0, last:'3 days ago', when:'Sep 10 · 14:00', spark:[1,3,3,2,0,0],
    note:'Lifetimes on the stream are SOLVED — stop re-solving them. EOF propagation was the last open item, closed Sep 10. Merge when you feel like it.',
    story:[
      ['Aug 28 · 10:00','branch','branched from main — the rewrite begins','stream parser is wrong in a way patches cannot fix'],
      ['Sep 1 · 15:20','commit','stream type skeleton',''],
      ['Sep 4 · 11:05','commit','borrow fight, round 4','the checker wins. for now.'],
      ['Sep 8 · 16:10','win','stream lifetimes finally click','SOLVED — stop re-solving. write it down: the second lifetime is the buffer, not the cursor'],
      ['Sep 10 · 14:00','commit','propagate EOF on close','last open item, closed — branch is merge-ready'],
    ]},
  { id:'mmap', proj:'waypoint', git:'perf/mmap-probe', name:'Mmap experiment', angle:331,
    status:['drift','Drifting · 9 days'], ahead:3, behind:4, last:'9 days ago', when:'Sep 9 · 16:30', spark:[0,0,0,3,1,0],
    note:'70% faster on 1GB files but 3× slower on small ones. probably a dead end — keep the bench numbers.',
    story:[
      ['Sep 4 · 09:30','branch','branched — try mmap read path','hypothesis: the page cache does the work for free'],
      ['Sep 4 · 10:12','commit','bench: mmap read path',''],
      ['Sep 4 · 12:40','commit','bench: 1GB files','70% faster. worth pursuing?'],
      ['Sep 9 · 16:20','commit','bench: small files','3× slower. ouch.'],
      ['Sep 9 · 16:30','parked','parked with a note','probably a dead end — keep the bench numbers'],
    ]},
  { id:'deps', proj:'harbor', git:'chore/deps-q2', name:'Deps cleanup, the boring one', angle:205,
    status:['rust','Rusting · 21 days'], ahead:2, behind:9, last:'21 days ago', when:'Aug 24 · 10:30', spark:[1,3,0,0,0,0],
    note:'Parked until Express 5 settles. Do not merge — it is 60% lockfile noise and rebasing will hurt more than restarting.',
    story:[
      ['Aug 23 · 09:00','branch','branched for the quarterly sweep',''],
      ['Aug 23 · 11:10','commit','bump 41 deps',''],
      ['Aug 24 · 10:05','commit','audit: 60% of diff is lockfile churn',''],
      ['Aug 24 · 10:30','parked','parked until Express 5 settles','do not merge as-is'],
    ]},
  { id:'essay', proj:'driftwood', git:'essay/typography', name:'Essay typography pass', angle:154,
    status:['drift','Drifting · 6 days'], ahead:4, behind:0, last:'6 days ago', when:'Sep 7 · 12:00', spark:[0,0,0,0,3,0],
    note:'Hanging punctuation looks precious; try a tighter measure first.',
    story:[
      ['Sep 7 · 10:20','branch','branched for a typography pass','the essays deserve better than this'],
      ['Sep 7 · 10:45','commit','hanging punctuation (test)','looks precious. try a tighter measure first.'],
      ['Sep 7 · 12:00','parked','left to let it sit overnight','never came back — parked, not forgotten'],
    ]},
];
const B = Object.fromEntries(BRANCHES.map(b => [b.id, b]));

const FLAGS = [
  { b:'billing', kind:'CI red · 2 days',   fc:'#e2705f', line:'Client work for Saltworks. Your note already pins the fix — the transaction wrapper. <span class="mono">hotfix: 4th retry</span> was a wrong move.' },
  { b:'tok',     kind:'Merge-ready',       fc:'#63c08a', line:'Green, 14 ahead / 0 behind. Lifetimes solved — your words. Ten minutes of work whenever you feel like it.' },
  { b:'auth',    kind:'Uncommitted',       fc:'#f2c976', line:'3 files left dirty at 11:42 — resume here, or stash before switching threads.' },
  { b:'deps',    kind:'Decide',            fc:'#c8a26e', line:'21 days untouched, 2 ahead / 9 behind. Keep or cut — the rebase only gets worse.' },
];

const WEEK = [
  ['Today — Sunday, Sep 13','you left at 11:42, back at 13:22',[
    ['13:22','now','','You are here — Bearing rebuilt the morning in four seconds','resume from the card above, or pick any thread from the week'],
    ['11:42','left','auth','left for lunch — resume note written','bug is in refresh, not issue. check clock skew first.'],
    ['11:38','commit','auth','<span class="msg">uncommitted edits: verifier.ts, clock.ts (+15 −8)</span>','still uncommitted — this is where you pick up'],
    ['11:31','ci','auth','ran the suite — 1 failing: <span class="msg">token refresh › expires after 5min</span>','the red test IS the bug — this is good news'],
    ['11:24','win','auth','<span class="msg">skew-aware compare in verifier</span>','the real fix, I think'],
  ]],
  ['Yesterday — Saturday, Sep 12','git agrees with the calendar',[
    ['—','rest','','No commits. The coast happened.','Point Reyes, per the calendar; git concurs'],
  ]],
  ['Friday, Sep 11','the day billing went red',[
    ['11:00','ci','billing','CI went red on Invoices falling over at midnight','race reproduces on the invoice table under load — still red today'],
    ['10:02','pr','waypoint','distrail opened PR #142 — <span class="msg">mmap for headers</span>','overlaps the mmap experiment; worth reading before deciding'],
    ['09:15','commit','billing','<span class="msg">log retry storm</span>','4 retries inside 40s at 00:04 UTC — definitely a race'],
  ]],
  ['Thursday, Sep 10','a breakthrough and a wrong turn, same day',[
    ['17:45','wrong','auth','<span class="msg">try: bump issue TTL</span>','dead end — issue path is fine, revert tomorrow'],
    ['14:00','commit','waypoint','<span class="msg">propagate EOF on close</span>','last open item — the rewrite is merge-ready'],
    ['09:30','win','auth','<span class="msg">repro: expires after 5min</span>','first red test that is actually the bug'],
  ]],
  ['Wednesday, Sep 9','clocks, benches, and a parked experiment',[
    ['16:30','parked','mmap','parked the mmap experiment','probably a dead end — keep the bench numbers'],
    ['16:20','commit','mmap','<span class="msg">bench: small files</span>','3× slower. ouch.'],
    ['15:02','commit','auth','<span class="msg">instrument verifier clocks</span>','server clock runs 340ms behind — suspicious'],
    ['10:14','commit','auth','<span class="msg">wip: log 401 bursts</span>','bursts cluster at :00 — smells like a cron-issued token'],
  ]],
  ['Tuesday, Sep 8','two mysteries pinned in one day',[
    ['16:10','win','waypoint','<span class="msg">stream lifetimes finally click</span>','SOLVED — stop re-solving. merge-ready once EOF lands'],
    ['09:00','note','billing','root cause pinned','upsert before txn commit — second retry reads a half-written row. fix = transaction wrapper'],
  ]],
  ['Monday, Sep 7','a quiet start to the week',[
    ['10:45','commit','essay','<span class="msg">hanging punctuation (test)</span>','looks precious — try a tighter measure first'],
    ['10:20','branch','essay','branched for a typography pass','the essays deserve better than this'],
  ]],
];

const ANSWERS = {
  where: `You were on <b>The token refresh thing</b> (harbor-api · <code>feat/auth-refresh</code>) until 11:42 — before lunch. Your last note: “bug is in refresh, not issue — check clock skew on the verifier first.” Last commit was <code>skew-aware compare in verifier</code> at 11:24, with 3 files left uncommitted. The failing test, <code>token refresh › expires after 5min</code>, reproduces the bug exactly — that red is good news.`,
  attention: `In order: ① <b>Invoices falling over at midnight</b> — CI red for 2 days and it's client work. Your own note pins the fix: move the upsert inside the transaction wrapper, and stop adding retries. ② <b>The borrow checker fight</b> — green, 14 ahead / 0 behind. Your note says lifetimes are solved; merging is ~10 minutes. ③ <b>Deps cleanup, the boring one</b> — 21 days untouched. Keep or cut. Everything else can wait.`,
  invoice: `From your notes and commits on <b>Invoices falling over at midnight</b>: Stripe retries <code>invoice.paid</code> just after 00:00 UTC, and two retries can land together. The handler upserts the invoice row <i>before</i> the transaction commits, so the second retry reads a half-written row. You flagged <code>hotfix: 4th retry</code> as a wrong move (“stop adding retries — the race is on our side”). The fix you wrote down: wrap the upsert in the transaction.`,
  merge: `<b>The borrow checker fight</b> (waypoint · <code>tok/rewrite-stream</code>): green CI, 14 ahead / 0 behind, last touched Sep 10. Your margin note on <code>stream lifetimes finally click</code>: “SOLVED — stop re-solving.” The only open item was EOF propagation, and <code>propagate EOF on close</code> closed it Sep 10. Nothing else is close — billing is red on purpose (a known race) and shouldn't merge until the wrapper lands.`,
  week: `Monday: started the typography pass on driftwood. Tuesday: pinned the invoice race (“upsert before txn commits”) and cracked the stream lifetimes on waypoint. Wednesday: benched the mmap experiment (3× slower on small files — parked it) and instrumented verifier clocks, finding the server 340ms behind. Thursday: wrote the red test that reproduces the refresh bug, then took a wrong turn bumping issue TTL before leaving. Friday: logged the retry storm, billing CI went red, PR #142 arrived on waypoint. Saturday: the coast. Today: the real fix — <code>skew-aware compare in verifier</code> — then lunch.`,
  mmap: `Your own bench notes on <b>Mmap experiment</b>: 70% faster on 1GB files, 3× slower on small ones — “probably a dead end — keep the bench numbers.” One thing to read first: PR #142 on waypoint (<code>mmap for headers</code>) overlaps the idea. I'd read it, then archive the branch keeping the bench results.`,
  rot: `Rusting: <b>Deps cleanup, the boring one</b> — 21 days, parked “until Express 5 settles,” 2 ahead / 9 behind. Drifting: <b>Mmap experiment</b> (9 days) and <b>Essay typography pass</b> (6 days — though your note leaves a clear next step: tighter measure first). Nothing else is at risk today.`,
  deps: `You parked it Aug 23 “until Express 5 settles,” and it's now 2 ahead / 9 behind with 60% lockfile churn. Your note says rebasing will hurt more than restarting. I'd cut the branch and re-run the upgrade fresh from main when you need it — you lose nothing but the churn.`,
  essay: `Your last note on <b>Essay typography pass</b>: “hanging punctuation looks precious; try a tighter measure first.” Next step is a measure test. The branch is 4 ahead / 0 behind with nothing rotting — safe to resume whenever the mood strikes.`,
  tok: `<b>The borrow checker fight</b> is as ready as it gets: green CI, 14 ahead / 0 behind, and your breakthrough note on <code>stream lifetimes finally click</code> says “SOLVED — stop re-solving.” EOF propagation — the last open item — landed Sep 10. Merge when you feel like it.`,
  fallback: `This prototype advisor has canned answers only — try one of the suggestions. In the real thing, every answer would come from your live repos, your notes, and whatever is currently in view.`,
};

const GREETING = `Afternoon — you left <b>The token refresh thing</b> 38 minutes ago and the trail is still warm: last commit at 11:24, 3 files uncommitted, and one red test that is actually the bug. Ask me anything, or click a branch and I'll answer in its context.`;

const CTX_CHIPS = {
  billing: 'Why do invoices fail at midnight?',
  tok: 'Is the borrow checker fight ready to merge?',
  mmap: 'Is the mmap experiment worth finishing?',
  deps: 'Keep or cut the deps cleanup?',
  essay: 'What is next on the typography pass?',
};

const VARIANTS = { A:'A — The Bridge', B:'B — The Map', C:'C — The Logbook' };
const ORDER = ['A','B','C'];

let variant = 'A';
let ctx = 'auth';

function chip(cls, label){ return `<span class="chip ${cls}">${label}</span>`; }
function sparkHtml(sp){ return `<span class="spark">${sp.map((n,i)=>`<i class="${n>=2?'on':(i===5&&n>0?'on':'')}" style="height:${4+n*6}px"></i>`).join('')}</span>`; }
function projOf(b){ return PROJECTS[b.proj]; }

function matchAnswer(q){
  const s = q.toLowerCase();
  if (/invoice|midnight/.test(s)) return ANSWERS.invoice;
  if (/mmap/.test(s)) return ANSWERS.mmap;
  if (/borrow|rewrite|stream/.test(s)) return ANSWERS.tok;
  if (/week|monday|summary|summariz/.test(s)) return ANSWERS.week;
  if (/where|was i|resume|left off|pick up/.test(s)) return ANSWERS.where;
  if (/rot|rust|stale|drift|risk/.test(s)) return ANSWERS.rot;
  if (/deps|express|cleanup|boring/.test(s)) return ANSWERS.deps;
  if (/essay|typograph/.test(s)) return ANSWERS.essay;
  if (/merge|safe/.test(s)) return ANSWERS.merge;
  if (/attention|first|priorit|today|start/.test(s)) return ANSWERS.attention;
  return ANSWERS.fallback;
}

function advisorHTML(title){
  return `
  <div class="adv">
    <div class="adv-head">
      <div class="adv-title"><span>${title}</span><span style="letter-spacing:0;text-transform:none;font-weight:400">✦</span></div>
      <div class="adv-ctx" data-ctx-chip></div>
    </div>
    <div class="adv-thread" id="advThread">
      <div class="bub bot"><div class="bub-inner">${GREETING}</div></div>
    </div>
    <div class="adv-chips" id="advChips"></div>
    <div class="adv-input">
      <input id="advInput" type="text" placeholder="Ask about your projects, branches, commits…" autocomplete="off">
      <button data-adv-send>Ask</button>
    </div>
  </div>`;
}

function renderChips(){
  const host = document.getElementById('advChips');
  if (!host) return;
  const base = ['Where was I?','What deserves my attention today?','What is safe to merge?','What did I do last week?'];
  const extra = CTX_CHIPS[ctx];
  const all = extra ? [...base.slice(0,3), extra] : base;
  host.innerHTML = all.map(q => `<button data-q="${q}">${q}</button>`).join('');
}

function ask(q){
  const thread = document.getElementById('advThread');
  if (!thread) return;
  const u = document.createElement('div');
  u.className = 'bub user'; u.textContent = q;
  thread.appendChild(u);
  const a = document.createElement('div');
  a.className = 'bub bot';
  a.innerHTML = `<div class="bub-inner">${matchAnswer(q)}</div>`;
  thread.appendChild(a);
  thread.scrollTop = thread.scrollHeight;
  renderChips();
}

function setCtx(id){
  ctx = id;
  document.querySelectorAll('[data-ctx-chip]').forEach(el => {
    if (!id) { el.innerHTML = '<span class="dot" style="background:#5d6979;box-shadow:none"></span> <span style="color:#8b93a8">Nothing selected — click a branch for context</span>'; return; }
    const b = B[id], p = projOf(b);
    el.innerHTML = `<span class="dot"></span> Looking at <b>${b.name}</b> <span class="sub">${p.name} · ${b.git}</span>`;
  });
  document.querySelectorAll('.compass .c-needle').forEach(n => n.style.transform = `rotate(${id ? B[id].angle : 0}deg)`);
  document.querySelectorAll('.compass .c-needle-back').forEach(n => n.style.transform = `rotate(${id ? B[id].angle+180 : 180}deg)`);
  document.querySelectorAll('.c-item').forEach(el => el.classList.toggle('sel', el.dataset.branch === id));
  const sw = document.getElementById('swState');
  sw.textContent = `ctx: ${id ? B[id].name : '—'} · 6 branches · 3 projects`;
  renderChips();
}

function dossierHTML(b){
  const p = projOf(b);
  const [cls, label] = b.status;
  const total = Math.max(b.ahead + b.behind, 1);
  const events = b.story.map(([when, kind, msg, note]) => {
    let inner = '';
    if (kind === 'files') {
      inner = `<div class="ev-msg" style="color:#8b93a8">uncommitted when you left:</div><div class="ev-files">${b.dirty.map(f=>`<span>${f}</span>`).join('')}</div>`;
    } else {
      inner = `<div class="ev-when">${when}</div><div class="ev-msg">${msg}</div>` +
        (note ? `<div class="ev-note">${note}</div>` : '');
    }
    return `<div class="ev ${kind}" data-glyph="•">${inner}</div>`;
  }).join('');
  return `
  <button class="doss-close" data-close>✕</button>
  <div class="doss-eyebrow">${p.name} <span class="mono">${b.git}</span></div>
  <h2 class="doss-name">${b.name}</h2>
  <div class="doss-status">${chip(cls,label)} <span class="mono" style="font-size:11px;color:#8b93a8">↑${b.ahead} ahead / ↓${b.behind} behind · last touch ${b.last}</span></div>
  <div class="doss-note">
    <label>Your notes</label>
    <textarea>${b.note}</textarea>
    <div class="note-hint">your words, kept with the branch — not the commit</div>
  </div>
  <div class="doss-activity">
    <label>Position</label>
    <div class="ab-bars">
      <span class="lbl">↑ ahead</span><div class="ab-track ab-ahead"><i style="width:${Math.round(b.ahead/total*100)}%"></i></div>
      <span class="lbl">↓ behind</span><div class="ab-track ab-behind"><i style="width:${Math.round(b.behind/total*100)}%"></i></div>
    </div>
    <div class="ab-legend">vs ${p.base.split(' ·')[0]} &nbsp;·&nbsp; last 6 weeks ${sparkHtml(b.spark)}</div>
  </div>
  <div class="doss-story">
    <label>How it unfolded</label>
    <div class="story-line">${events}</div>
  </div>
  <div class="doss-actions">
    <button class="btn btn-primary" data-action="pickup">Pick up the thread</button>
    <button class="btn btn-ghost" data-action="askbranch">Ask about this branch</button>
    <button class="btn btn-ghost" data-action="park">${b.status[0]==='rust'?'Cut it':'Park it'}</button>
  </div>`;
}

function openDossier(id){
  const b = B[id];
  if (!b) return;
  setCtx(id);
  if (variant === 'B') {
    const fn = document.getElementById('fieldnotes');
    fn.innerHTML = dossierHTML(b);
    fn.classList.add('open');
  } else {
    const d = document.getElementById('drawer');
    d.innerHTML = dossierHTML(b);
    d.classList.add('open');
    document.getElementById('scrim').classList.add('open');
  }
}

function closePanels(){
  document.getElementById('drawer').classList.remove('open');
  document.getElementById('scrim').classList.remove('open');
  document.getElementById('fieldnotes').classList.remove('open');
  const m = document.getElementById('advModal');
  if (m) m.classList.remove('open');
}

function toast(msg){
  const t = document.getElementById('toast');
  t.innerHTML = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), 2600);
}

const compassSVG = `
<svg class="compass" viewBox="0 0 40 40" aria-hidden="true">
  <circle class="c-ring" cx="20" cy="20" r="17"/>
  <circle class="c-ring" cx="20" cy="20" r="11.5" opacity=".45"/>
  <path class="c-tick" d="M20 3.5v4 M20 32.5v4 M3.5 20h4 M32.5 20h4"/>
  <polygon class="c-needle-back" points="20,33 17,20 23,20"/>
  <polygon class="c-needle" points="20,7 17,20 23,20"/>
  <circle class="c-dot" cx="20" cy="20" r="2"/>
</svg>`;

function bcardHTML(b){
  const resuming = b.id === 'auth' ? ' resuming' : '';
  return `
  <div class="bcard${resuming}" data-branch="${b.id}" role="button" tabindex="0">
    <div class="bc-top">
      <div><div class="bc-name">${b.name}</div><div class="bc-ref">${b.git}</div></div>
      ${chip(b.status[0], b.status[1])}
    </div>
    <div class="bc-note">“${b.note}”</div>
    <div class="bc-foot">
      <div class="bc-last">last touch <b>${b.last}</b> · <span class="mono" style="font-size:10.5px">↑${b.ahead} ↓${b.behind}</span></div>
      ${sparkHtml(b.spark)}
    </div>
  </div>`;
}

function renderA(){
  const hero = B.auth, hp = projOf(hero);
  document.getElementById('app').innerHTML = `
  <div class="a-wrap">
    <div class="a-top">
      <div class="a-brand">${compassSVG}
        <div><div class="a-word">Bearing</div><div class="a-brand-sub">personal command center</div></div>
      </div>
      <div class="a-clock">Sun Sep 13 · 13:22<br>back from lunch <b>38 min</b> ago</div>
    </div>
    <div class="a-columns">
      <div class="a-main">
        <div class="hero">
          <div class="hero-eyebrow">Resume here <span class="sep">·</span> <span class="mono">BRG 042°</span> <span class="sep">·</span> <span class="mono">you left 38 minutes ago</span></div>
          <h1 class="hero-name">${hero.name}</h1>
          <div class="hero-sub"><span>${hp.name}</span><span>${hero.git}</span><span>↑${hero.ahead} ahead / ↓${hero.behind} behind</span><span>3 files uncommitted</span></div>
          <div class="hero-note">Bug is in refresh, not issue. I was wrong yesterday — the 401s start <span class="hm">after</span> a refresh. Check clock skew on the verifier first.</div>
          <div class="hero-foot">
            <div class="trail">
              <div>
                <div class="trail-label">Your last 18 minutes</div>
                <div style="display:flex">
                  <div class="trail-step"><div class="t-dot"></div><div class="t-when">11:24</div><div class="t-what mono">skew-aware compare</div></div>
                  <div class="trail-step test"><div class="t-dot"></div><div class="t-when">11:31</div><div class="t-what">suite — 1 red test</div></div>
                  <div class="trail-step edit"><div class="t-dot"></div><div class="t-when">11:38</div><div class="t-what mono">verifier.ts +12 −4</div></div>
                  <div class="trail-step note"><div class="t-dot"></div><div class="t-when">11:42</div><div class="t-what">resume note → lunch</div></div>
                </div>
              </div>
            </div>
            <div class="hero-actions">
              <button class="btn btn-primary" data-action="pickup">Pick up the thread</button>
              <button class="btn btn-ghost" data-action="askbranch">Ask about it</button>
            </div>
          </div>
        </div>
        <div class="flags">
          ${FLAGS.map(f => `
          <div class="flag" data-branch="${f.b}" style="--fc:${f.fc}" role="button" tabindex="0">
            <div class="f-kind">${f.kind}</div>
            <div class="f-name">${B[f.b].name}</div>
            <div class="f-line">${f.line}</div>
          </div>`).join('')}
        </div>
        ${Object.values(PROJECTS).map(p => `
        <div class="proj">
          <div class="proj-head">
            <span class="proj-name">${p.name}</span>
            <span class="proj-kind">${p.kind} · ${p.stack}</span>
            <span class="proj-base">base: ${p.base}</span>
          </div>
          <div class="proj-cards">
            ${BRANCHES.filter(b => b.proj === p.id).map(bcardHTML).join('')}
            ${p.id === 'waypoint' ? `<div class="incoming"><span class="arr">↗</span> <span class="mono">distrail</span> opened PR #142 — <span class="mono">mmap for headers</span> · 2 days, overlaps <i>Mmap experiment</i></div>` : ''}
          </div>
        </div>`).join('')}
      </div>
      <div class="a-rail" id="advisorRail">
        ${advisorHTML('Advisor')}
      </div>
    </div>
  </div>`;
  setCtx(ctx);
}

function trailDots(dots){
  return dots.map(([x,y,note]) => note
    ? `<polygon class="t-note-dot" points="${x},${y-5.5} ${x+5.5},${y} ${x},${y+5.5} ${x-5.5},${y}"/>`
    : `<circle class="t-dot" cx="${x}" cy="${y}" r="5"/>`).join('');
}

function trailG(id, cls, d, dots, endX, endY, labelX, labelY, name, sub, endMark){
  return `
  <g class="trail ${cls}" data-branch="${id}">
    <path d="${d}"/>
    ${trailDots(dots)}
    ${endMark || ''}
    <text class="t-label" x="${labelX}" y="${labelY}">${name}</text>
    <text class="island-sub" x="${labelX}" y="${labelY+16}">${sub}</text>
    <circle cx="${endX}" cy="${endY}" r="0"/>
  </g>`;
}

function renderB(){
  document.getElementById('app').innerHTML = `
  <div class="b-stage">
    <div class="b-horizon">
      <div class="b-here">
        <span class="pulse-dot"></span>
        <div>
          <div class="b-label">You are here</div>
          <div class="b-where">The token refresh thing <span class="b-sub">· harbor-api · you left 38 minutes ago</span></div>
        </div>
      </div>
      <div class="b-beacons">
        <span class="beacon red" data-branch="billing">⚑ CI red · 2 days <span class="n">1</span></span>
        <span class="beacon green" data-branch="tok">✦ merge-ready <span class="n">1</span></span>
        <span class="beacon rust" data-branch="deps">⚓ rusting <span class="n">1</span></span>
        <span class="beacon" style="border-color:#cdbb94;color:#6b5f48" data-branch="auth">◆ uncommitted <span class="n" style="background:#6b5f48">3</span></span>
      </div>
    </div>
    <svg class="b-map" viewBox="0 0 1440 820" preserveAspectRatio="xMidYMid meet">
      <defs>
        <filter id="warmGlow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="4.5" result="b"/>
          <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <g class="contours">
        <path class="contour" d="M60 180 q 60 -40 130 -10 t 120 60"/>
        <path class="contour" d="M700 700 q 90 50 200 30 t 180 -60"/>
        <path class="contour" d="M1250 60 q 50 30 40 90 t -60 70"/>
      </g>
      <g>
        <ellipse class="island-blob2" cx="335" cy="312" rx="262" ry="182"/>
        <ellipse class="island-blob" cx="330" cy="310" rx="250" ry="172"/>
        <ellipse class="contour" cx="330" cy="310" rx="185" ry="118" style="stroke:#e0d2b2"/>
        <text class="island-name" x="330" y="152" text-anchor="middle">harbor-api</text>
        <text class="island-sub" x="330" y="190" text-anchor="middle">client · Saltworks · TypeScript</text>
        <circle cx="300" cy="330" r="5" fill="#34302a"/>
        <text class="island-sub" x="300" y="352" text-anchor="middle">main</text>
      </g>
      <g>
        <ellipse class="island-blob2" cx="1055" cy="312" rx="282" ry="202"/>
        <ellipse class="island-blob" cx="1050" cy="310" rx="270" ry="190"/>
        <ellipse class="contour" cx="1050" cy="310" rx="200" ry="130" style="stroke:#e0d2b2"/>
        <text class="island-name" x="1050" y="122" text-anchor="middle">waypoint</text>
        <text class="island-sub" x="1050" y="200" text-anchor="middle">OSS · Rust · 240 ★ · 2 open PRs</text>
        <circle cx="1080" cy="345" r="5" fill="#34302a"/>
        <text class="island-sub" x="1108" y="352" text-anchor="middle">main</text>
      </g>
      <g>
        <ellipse class="island-blob2" cx="333" cy="652" rx="200" ry="120"/>
        <ellipse class="island-blob" cx="330" cy="650" rx="190" ry="110"/>
        <text class="island-name" x="330" y="530" text-anchor="middle">driftwood</text>
        <text class="island-sub" x="330" y="550" text-anchor="middle">personal · essays</text>
        <circle cx="330" cy="628" r="5" fill="#34302a"/>
        <text class="island-sub" x="330" y="650" text-anchor="middle">main</text>
      </g>
      ${trailG('auth','warm','M300,330 C255,300 205,295 185,245 S155,205 148,182',
        [[258,303,0],[210,288,1],[183,246,1],[158,206,0],[148,184,1]], 148,182, 96,158, 'The token refresh thing', 'harbor-api · warm · 38 min ago',
        `<circle class="here-ring" cx="148" cy="182" r="13"/><circle cx="148" cy="182" r="6.5" fill="#c76b1f" stroke="#f6eedd" stroke-width="2"/>`)}
      ${trailG('billing','alert','M300,330 C345,305 385,325 425,285 S462,235 470,205',
        [[345,306,0],[388,324,0],[425,286,1],[455,236,0],[470,207,0]], 470,205, 492,196, 'Invoices falling over at midnight', 'harbor-api · CI red · 2 days',
        `<text class="beaconflag" x="470" y="188" fill="#b5432f" text-anchor="middle">⚑</text>`)}
      ${trailG('deps','rust','M300,330 C282,362 265,395 255,432',
        [[282,362,0],[266,396,1],[255,430,0]], 255,432, 272,462, 'Deps cleanup, the boring one', 'harbor-api · rusting · 21 days',
        `<text class="beaconflag" x="255" y="426" fill="#9c7f4e" text-anchor="middle">⚓</text>`)}
      ${trailG('tok','fresh','M1080,345 C1020,305 955,325 915,262 S885,205 878,165',
        [[1018,307,0],[955,327,1],[915,264,1],[888,207,0],[878,167,0]], 878,165, 895,163, 'The borrow checker fight', 'waypoint · green · merge-ready',
        `<text class="beaconflag" x="878" y="148" fill="#4a7a59" text-anchor="middle">✦</text>`)}
      ${trailG('mmap','drift','M1080,345 C1135,322 1185,300 1215,240 S1238,205 1235,178',
        [[1135,323,0],[1185,302,1],[1215,242,1],[1235,180,0]], 1235,178, 1258,158, 'Mmap experiment', 'waypoint · 9 days adrift',
        `<text class="beaconflag" x="1235" y="164" fill="#8d8168" text-anchor="middle">⚓</text>`)}
      ${trailG('essay','drift','M330,628 C285,605 235,605 200,565',
        [[285,607,1],[232,606,0],[200,567,0]], 200,565, 148,585, 'Essay typography pass', 'driftwood · drifting · 6 days',
        `<text class="beaconflag" x="200" y="550" fill="#8d8168" text-anchor="middle">⚓</text>`)}
      <g class="trail" data-pr="1">
        <path d="M1408,415 L1218,396" style="stroke:#4a7a59;stroke-width:2;stroke-dasharray:3 6"/>
        <text class="island-sub" x="1408" y="440" text-anchor="end">↗ PR #142 · distrail · mmap for headers · 2d</text>
        <circle cx="1218" cy="396" r="4" fill="#4a7a59"/>
      </g>
      <g opacity=".9">
        <rect x="34" y="46" width="252" height="86" rx="10" fill="#faf4e6" stroke="#d8c9a8"/>
        <text class="b-cartouche" x="52" y="80" font-size="21" font-style="italic">The Map</text>
        <text class="b-cartouche-sub" x="52" y="102">SUNDAY · SEP 13 · 13:22</text>
        <text class="b-cartouche-sub" x="52" y="120">3 PROJECTS · 6 BRANCHES · 1 WARM TRAIL</text>
      </g>
      <g class="compass-rose-wrap">
        <circle class="compass-rose" cx="1330" cy="700" r="34" fill="none" stroke="#8a7a5c" stroke-width="1.5" opacity=".4"/>
        <circle class="compass-rose" cx="1330" cy="700" r="24" fill="none" stroke="#8a7a5c" stroke-width="1" opacity=".35"/>
        <polygon class="compass-rose" points="1330,672 1336,700 1330,696 1324,700"/>
        <text class="compass-rose" x="1330" y="665" text-anchor="middle" font-size="11">N</text>
      </g>
    </svg>
    <div class="b-legend">
      <b>Trail warmth</b>
      <div class="lg"><span class="sw" style="border-color:#c76b1f"></span> walked today — still warm</div>
      <div class="lg"><span class="sw" style="border-color:#a5763a"></span> this week</div>
      <div class="lg"><span class="sw" style="border-color:#8d8168"></span> drifting · 6–9 days</div>
      <div class="lg"><span class="sw" style="border-color:#9c7f4e;border-style:dashed"></span> rusting · 3 weeks</div>
      <div class="lg"><span style="color:#c76b1f;font-size:13px">◆</span> commit carrying one of your notes</div>
    </div>
  </div>
  <div class="b-nav">${advisorHTML('Navigator')}</div>`;
  setCtx(ctx);
}

function renderC(){
  document.getElementById('app').innerHTML = `
  <div class="c-wrap">
    <nav class="c-nav">
      <div class="c-brand">${compassSVG}
        <div><div class="c-word">Bearing</div><small>the logbook</small></div>
      </div>
      ${Object.values(PROJECTS).map(p => `
      <div class="c-proj">
        <div class="c-proj-head"><span class="p-dot" style="background:${p.color}"></span>${p.name} <span style="margin-left:auto;font-size:10px;color:#57616b">${p.base.split(' ·')[0]}</span></div>
        ${BRANCHES.filter(b => b.proj === p.id).map(b => `
        <button class="c-item ${b.status[0]}" data-branch="${b.id}"><span class="s-dot"></span><span>${b.name}</span></button>`).join('')}
      </div>`).join('')}
    </nav>
    <main class="c-main">
      <div class="c-now">
        <div>
          <div class="n-eyebrow">Resume</div>
          <div class="n-title">The token refresh thing</div>
          <div class="n-sub">harbor-api · feat/auth-refresh · left 11:42 · 3 files uncommitted · 1 red test that is the bug</div>
        </div>
        <div class="n-actions">
          <div class="c-counts">
            <span><b>6</b> branches</span><span><b>2</b> flags</span><span><b>1</b> merge-ready</span><span><b>1</b> rusting</span>
          </div>
          <button class="c-ask" data-open-adv>Ask Bearing about anything in view <span class="kbd">⌘K</span></button>
        </div>
      </div>
      ${WEEK.map(([day, sub, events]) => `
      <div class="day">
        <div class="day-head"><span class="d-name">${day.split(' — ')[0]}</span><span class="d-sub">${day.includes(' — ') ? day.split(' — ')[1] : sub}</span></div>
        <div class="stream">
          ${events.map(([when, kind, bid, head, note]) => {
            const b = bid ? B[bid] : null;
            const p = b ? projOf(b) : null;
            return `
            <div class="sev ${kind}" data-glyph="•"${b ? ` data-branch="${bid}" style="cursor:pointer"` : ''}>
              <span class="s-when">${when}</span>
              ${b ? `<button class="s-chip" style="color:${p.color};border-color:${p.color}44;background:${p.color}12">${b.name}</button>` : `<span class="s-chip" style="color:#57616b;border-color:#232c35">·</span>`}
              <span class="s-text">${head}${note ? `<span class="snote">${note}</span>` : ''}</span>
            </div>`;
          }).join('')}
        </div>
      </div>`).join('')}
    </main>
  </div>
  <div id="advModal">${advisorHTML('Advisor — answers in the context of this view')}</div>`;
  setCtx(ctx);
}

function setVariant(v){
  variant = v;
  closePanels();
  document.body.className = 'v' + v;
  document.getElementById('swName').textContent = VARIANTS[v];
  if (v === 'A') renderA();
  else if (v === 'B') renderB();
  else renderC();
  const url = new URL(location.href);
  url.searchParams.set('variant', v);
  history.replaceState(null, '', url);
}

document.addEventListener('click', e => {
  const q = e.target;
  const trailEl = q.closest('.trail');
  const branchEl = q.closest('[data-branch]');
  const chipBtn = q.closest('[data-q]');
  const sendBtn = q.closest('[data-adv-send]');
  const openAdv = q.closest('[data-open-adv]');
  const action = q.closest('[data-action]');
  const closeBtn = q.closest('[data-close]');
  if (chipBtn) { ask(chipBtn.dataset.q); return; }
  if (sendBtn) { const i = document.getElementById('advInput'); if (i && i.value.trim()) { ask(i.value.trim()); i.value = ''; } return; }
  if (openAdv) { const m = document.getElementById('advModal'); if (m) { m.classList.add('open'); const i = document.getElementById('advInput'); if (i) i.focus(); } return; }
  if (closeBtn) { closePanels(); return; }
  if (action) {
    const a = action.dataset.action;
    if (a === 'pickup') toast(`<b>Prototype</b> — in the real tool this would open your editor at the last diff: <span class="mono">verifier.ts</span>, cursor where you left it, test run ready.`);
    if (a === 'park') toast(`<b>Prototype</b> — “Park it” would stash your note on the branch and drop it from the attention list.`);
    if (a === 'askbranch') {
      if (variant === 'C') { const m = document.getElementById('advModal'); if (m) m.classList.add('open'); }
      else { const t = document.getElementById('advThread'); if (t) t.scrollIntoView({behavior:'smooth', block:'nearest'}); }
      const i = document.getElementById('advInput'); if (i) i.focus();
      ask(ctx === 'billing' ? 'Why do invoices fail at midnight?' : 'Where was I?');
    }
    return;
  }
  if (branchEl) { openDossier(branchEl.dataset.branch); return; }
  if (trailEl && trailEl.dataset.pr) {
    const tt = document.getElementById('tooltip');
    tt.innerHTML = `<div class="tt-name">PR #142 — mmap for headers</div><div class="tt-meta">distrail · waypoint · opened Friday</div><div class="tt-note">“overlaps the mmap experiment — read before deciding” (your Friday note)</div>`;
    return;
  }
  if (q.id === 'scrim') closePanels();
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closePanels(); return; }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    const m = document.getElementById('advModal');
    if (m) { m.classList.toggle('open'); const i = document.getElementById('advInput'); if (m.classList.contains('open') && i) i.focus(); }
    return;
  }
  const typing = /^(INPUT|TEXTAREA)$/.test(e.target.tagName) || e.target.isContentEditable;
  if (typing) {
    if (e.key === 'Enter' && e.target.id === 'advInput' && e.target.value.trim()) { ask(e.target.value.trim()); e.target.value = ''; }
    return;
  }
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    const i = ORDER.indexOf(variant);
    const next = e.key === 'ArrowRight' ? ORDER[(i+1) % 3] : ORDER[(i+2) % 3];
    setVariant(next);
  }
});

document.addEventListener('mouseover', e => {
  const t = e.target.closest('.trail');
  const tt = document.getElementById('tooltip');
  if (!t || !t.dataset.branch) { tt.classList.remove('show'); return; }
  const b = B[t.dataset.branch];
  if (!b) { tt.classList.remove('show'); return; }
  tt.innerHTML = `<div class="tt-name">${b.name}</div><div class="tt-meta">${projOf(b).name} · ${b.git} · ${b.last}</div><div class="tt-note">“${b.note}”</div>`;
  tt.classList.add('show');
});
document.addEventListener('mousemove', e => {
  const tt = document.getElementById('tooltip');
  if (!tt.classList.contains('show')) return;
  const x = Math.min(e.clientX + 16, window.innerWidth - 290);
  const y = Math.min(e.clientY + 16, window.innerHeight - 130);
  tt.style.left = x + 'px';
  tt.style.top = y + 'px';
});

document.getElementById('swPrev').addEventListener('click', () => setVariant(ORDER[(ORDER.indexOf(variant)+2) % 3]));
document.getElementById('swNext').addEventListener('click', () => setVariant(ORDER[(ORDER.indexOf(variant)+1) % 3]));

const initial = new URLSearchParams(location.search).get('variant');
setVariant(ORDER.includes(initial) ? initial : 'A');
