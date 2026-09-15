/* Shared advisor rail. Read-only, tool-driven, context-bound.
   Prototype code — canned answers over the mock dataset. */
(function () {
  const D = window.BEARING;
  const branches = [];
  D.repos.forEach(r => r.branches.forEach(b => branches.push(Object.assign({}, b, { repo: r.name }))));
  const find = (repo, name) => branches.find(b => b.repo === repo && b.name === name);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function respond(q, ctx) {
    const t = (q || '').toLowerCase();
    const b = ctx.branch ? find(ctx.repo, ctx.branch) : null;
    const label = ctx.label || 'workspace';
    const tools = [];
    const call = (n, a) => tools.push(n + '(' + (a || '') + ')');
    const noBranch = () => '<span class="muted">Scope a branch (click one) and I can go deeper — CI, diffs, commits, conflict risk.</span>';

    if (ctx.type === 'step') {
      call('routine_context', '"' + label + '"');
      call('branch_state', 'api-service/feat/webhooks');
      return { tools, html: 'For this step: the failing tests are <b>test_retry_410</b> and <b>test_replay_guard</b>, both added by your last WIP commit. Want the diffs, or should I draft the fix?' };
    }

    if (/merge|safe to merge|ship|ready/.test(t)) {
      if (!b) return { tools, html: noBranch() };
      call('branch_state', b.repo + '/' + b.name); call('checks', '#' + (b.pr ? b.pr.number : '—'));
      const ready = (b.flags || []).includes('merge_ready');
      return { tools, html: ready
        ? '<b>' + esc(b.name) + '</b> is merge-ready: ' + (b.pr ? 'PR #' + b.pr.number + ', ' + b.pr.approvals + ' approval(s), CI ' + b.pr.ci : 'CI green') + '. Nothing blocking — merge when you like.'
        : '<b>' + esc(b.name) + '</b> is not ready: ' + (b.pr ? 'review is <b>' + b.pr.review.replace('_', ' ') + '</b>, CI <b>' + b.pr.ci + '</b>' : 'no PR open') + '.' + (b.behind ? ' It is also <b>' + b.behind + ' behind</b> main.' : '') };
    }
    if (/fail|ci|test|broken|red|error/.test(t)) {
      if (!b) return { tools, html: noBranch() };
      call('branch_state', b.repo + '/' + b.name); call('checks', '(branch=' + b.name + ')');
      return { tools, html: b.ciFail
        ? 'CI on <b>' + esc(b.name) + '</b> is failing: <b>' + esc(b.ciFail) + '</b>. The two failures were introduced in your most recent commit.'
        : 'CI on <b>' + esc(b.name) + '</b> is <b>passing</b> (' + (b.pr ? 'PR #' + b.pr.number : 'no PR') + ').' };
    }
    if (/conflict|rebase|behind|diverg/.test(t)) {
      if (!b) return { tools, html: noBranch() };
      call('divergence', b.repo + '/' + b.name + ', base=' + b.base);
      return { tools, html: b.behind
        ? '<b>' + esc(b.name) + '</b> is <b>' + b.ahead + ' ahead / ' + b.behind + ' behind</b> ' + b.base + '. Rebased files likely to conflict: ' + (b.files || []).slice(0, 2).map(f => '<span class="mono">' + esc(f) + '</span>').join(', ') + '.'
        : '<b>' + esc(b.name) + '</b> is up to date with ' + b.base + ' (' + b.ahead + ' ahead, 0 behind) — no conflict risk.' };
    }
    if (/stale|old|abandon|dead|cold|days/.test(t)) {
      if (!b) {
        call('hygiene_scan', '(all repos)');
        return { tools, html: 'Across 4 repos: <b>2 stale</b> (mobile/exp/new-nav, api-service/chore/deps-bump) and <b>1 diverged</b>. The oldest is exp/new-nav at 9 days.' };
      }
      call('branch_state', b.repo + '/' + b.name);
      return { tools, html: '<b>' + esc(b.name) + '</b> last moved <b>' + b.last + ' ago</b>. ' + (b.flags.includes('stale') ? 'That puts it over your 7-day staleness threshold — worth a keep/rebase/close decision.' : 'Still within your staleness window.') };
    }
    if (/next|should i|what now|todo|priorit|do first/.test(t)) {
      if (!b) { call('prioritize', '(fleet)'); return { tools, html: 'Highest-leverage right now: fix CI on <b>api-service/feat/webhooks</b> (unblocks a PR), then merge the two green branches to shrink the board.' }; }
      call('branch_state', b.repo + '/' + b.name); call('gap_analysis', b.name);
      return { tools, html: 'Next on <b>' + esc(b.name) + '</b>: <b>' + esc(b.next) + '</b>' };
    }
    if (/summar|wip|where|doing|recap|status/.test(t)) {
      if (!b) { call('sessions', 'today'); return { tools, html: 'You last worked on <b>api-service/feat/webhooks</b> 47m ago, before that web-app/fix/auth-refresh and docs-site/site-revamp.' }; }
      call('branch_state', b.repo + '/' + b.name); call('commits', b.name + ', range=5');
      return { tools, html: '<b>' + esc(b.wip) + '</b>' };
    }
    if (/diff|change|files|touch|size/.test(t)) {
      if (!b) return { tools, html: noBranch() };
      call('diff', b.base + '...' + b.name);
      return { tools, html: '<b>' + esc(b.name) + '</b>: <b>+' + b.diff.add + ' −' + b.diff.del + '</b> across <b>' + b.diff.files + ' files</b> vs ' + b.base + '. Touches ' + (b.files || []).map(f => '<span class="mono">' + esc(f.split('/').pop()) + '</span>').join(', ') + '.' };
    }
    if (/commit|history|when/.test(t)) {
      if (!b) return { tools, html: noBranch() };
      call('commits', b.name + ', range=5');
      return { tools, html: 'Recent commits on <b>' + esc(b.name) + '</b>:<br>' + b.commits.map(c => '• <span class="mono">' + esc(c) + '</span>').join('<br>') };
    }
    if (/pr|review|approv/.test(t)) {
      if (!b) return { tools, html: noBranch() };
      call('pr_status', b.repo + '/' + b.name);
      return { tools, html: b.pr
        ? 'PR <b>#' + b.pr.number + '</b> on <b>' + esc(b.name) + '</b>: ' + b.pr.state + ', CI <b>' + b.pr.ci + '</b>, review <b>' + b.pr.review.replace('_', ' ') + '</b>, ' + b.pr.approvals + ' approval(s).'
        : 'No PR open for <b>' + esc(b.name) + '</b> yet.' };
    }
    if (/risk|danger|worry|careful/.test(t)) {
      if (!b) { call('hygiene_scan', '(all)'); return { tools, html: 'Top risks: <b>mobile/exp/new-nav</b> (diverged, 9d cold) and <b>api-service/feat/webhooks</b> (CI red, uncommitted work).' }; }
      call('risk', b.repo + '/' + b.name);
      const risk = b.flags.includes('ci_failing') || b.flags.includes('diverged') ? 'high' : b.flags.includes('stale') ? 'medium' : 'low';
      return { tools, html: 'Risk on <b>' + esc(b.name) + '</b>: <b>' + risk + '</b>. ' + (b.behind ? b.behind + ' commits behind main increases merge cost. ' : '') + (b.wt && b.wt.modified ? b.wt.modified + ' uncommitted file(s) at risk of being lost.' : '') };
    }
    if (/who|author|own/.test(t)) {
      call('ownership', ctx.label || '(all)');
      return { tools, html: 'On <b>' + esc(label) + '</b>, recent authorship is concentrated in a single contributor (you) — bus factor 1 for this work.' };
    }
    call('branch_state', ctx.label || '(workspace)');
    return { tools, html: 'Here is what I know about <b>' + esc(label) + '</b>' + (b ? '. ' + esc(b.wip) : '.') + ' Ask me to dig into CI, diffs, commits, conflicts, risk, or what to do next.' };
  }

  const DEFAULTS = ['What should I do next?', 'Is it safe to merge?', 'Why is CI failing?', 'Summarize this branch'];

  function bubble(html, tools) {
    const trace = tools && tools.length ? '<div class="rtools">' + tools.map(t => '<span class="call">' + esc(t) + '</span>').join('') + '</div>' : '';
    return trace + '<div class="bubble">' + html + '</div>';
  }

  window.BearingAdvisor = {
    mount(el, opts) {
      el.innerHTML =
        '<div class="rail-hd"><div class="av">✦</div><div><b>Bearing Advisor</b><div class="tiny muted" style="line-height:1">read-only · tool-driven</div></div><div class="st"><span class="d"></span>online</div></div>' +
        '<div class="rail-ctx" id="adv-ctx"></div>' +
        '<div class="rail-msgs scroll" id="adv-msgs"></div>' +
        '<div class="rail-sug" id="adv-sug"></div>' +
        '<div class="rail-in"><input id="adv-in" placeholder="Ask about this branch, commit, or repo…" /><button id="adv-go">➤</button></div>';
      const msgs = el.querySelector('#adv-msgs');
      const ctxEl = el.querySelector('#adv-ctx');
      const sugEl = el.querySelector('#adv-sug');
      const input = el.querySelector('#adv-in');

      const add = (role, html, tools) => {
        const d = document.createElement('div');
        d.className = 'rmsg fade-in ' + role;
        d.innerHTML = role === 'user' ? esc(html) : bubble(html, tools);
        msgs.appendChild(d); msgs.scrollTop = msgs.scrollHeight;
        return d;
      };

      const refresh = () => {
        const c = opts.getContext();
        ctxEl.innerHTML = 'scope: <span class="mono">' + esc(c.label) + '</span>';
        const sug = (opts.suggestions ? opts.suggestions(c) : DEFAULTS).slice(0, 4);
        sugEl.innerHTML = sug.map(s => '<button data-q="' + esc(s) + '">' + esc(s) + '</button>').join('');
        sugEl.querySelectorAll('button').forEach(b => b.addEventListener('click', () => ask(b.dataset.q)));
      };

      const ask = (q) => {
        if (!q) return;
        add('user', q);
        const ctx = opts.getContext();
        const pending = add('bot', '<span class="cursor"></span>', []);
        setTimeout(() => {
          const r = respond(q, ctx);
          pending.innerHTML = bubble(r.html, r.tools);
          msgs.scrollTop = msgs.scrollHeight;
        }, 520);
      };

      el.querySelector('#adv-go').addEventListener('click', () => { ask(input.value.trim()); input.value = ''; });
      input.addEventListener('keydown', e => { if (e.key === 'Enter') { ask(input.value.trim()); input.value = ''; } });

      add('bot', 'Hi. I am scoped to whatever you select. Click a branch, commit, or step — then ask me anything about it.', []);
      refresh();
      return { refresh, add, ask };
    }
  };
})();
