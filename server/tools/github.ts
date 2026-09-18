/**
 * The two tools that cost a GitHub call — and cost it once, ever.
 *
 * `repo_readme` grounds a vision in what the software *is*. It is the cheapest quality win
 * in the whole plan: one call per repo, cached permanently, and it changes "work on the
 * advisor" into something that knows what the advisor is for.
 *
 * `commit_files` is what turns *drifted* from a hunch into a finding. Which files a commit
 * touched says more about intent than any message — especially here, where the messages
 * are written by the same agent whose intent is in question.
 *
 * Neither holds a credential. They are handed a reader bound to the token on the server
 * (D77), so a tool cannot make a call nobody designed and cannot put a token in a prompt.
 */

import { str, ToolError, type Tool } from './types.ts';

/** Enough of a README to say what the software is; the rest is installation and licence. */
const MAX_README = 2500;
const MAX_FILES = 40;

export const repoReadme: Tool = {
  name: 'repo_readme',
  description:
    'What this repo says it is, in its own words. Read it when you need to know what the software does before judging what a branch is for. One GitHub call, kept forever — cheap, but do not ask twice.',
  cost: 'github',
  args: [],

  async run(_args, ctx) {
    if (!ctx.branch) throw new ToolError('this job is not about one branch, so there is no repo to read');
    if (!ctx.github) throw new ToolError('this job cannot reach GitHub');

    const text = await ctx.github.readme(ctx.branch.repoKey);
    if (!text) return `${ctx.branch.repoKey} has no README and no CLAUDE.md. Nothing to read.`;

    const trimmed = text.trim();
    const body = trimmed.length > MAX_README ? `${trimmed.slice(0, MAX_README)}\n… (the rest is not shown)` : trimmed;
    return `${ctx.branch.repoKey}, in its own words:\n\n${body}`;
  },
};

export const commitFiles: Tool = {
  name: 'commit_files',
  description:
    'The files one commit touched, with how much of each. Use it when the commit message does not say enough about what the change actually was. One GitHub call per commit, kept forever.',
  cost: 'github',
  args: [{ name: 'sha', type: 'string', required: true, about: 'a commit SHA from the list you were given' }],

  async run(args, ctx) {
    if (!ctx.branch) throw new ToolError('this job is not about one branch, so there are no commits to read');
    if (!ctx.github) throw new ToolError('this job cannot reach GitHub');

    const asked = str(args, 'sha').toLowerCase().trim();

    // The same guard the summariser's evidence has (D40): a SHA the model produced is
    // checked against the branch's own commits before it is used. An invented one must
    // not turn into a GitHub call — it would either 404 or, worse, succeed against some
    // unrelated commit in the repo and be reported as this branch's work.
    //
    // Seven characters at least, which is what the prompt shows it: a prefix shorter than
    // that would happily match the first commit that happens to start with the same
    // letter, and be wrong without ever looking wrong.
    const match =
      asked.length >= 7
        ? ctx.branch.commits.find(
            (commit) =>
              commit.sha.toLowerCase().startsWith(asked) || asked.startsWith(commit.sha.toLowerCase()),
          )
        : undefined;
    if (!match) {
      const known = ctx.branch.commits.slice(0, 8).map((c) => c.sha.slice(0, 7)).join(', ');
      throw new ToolError(`"${asked}" is not a commit on this branch. Its commits are: ${known}`);
    }

    const detail = await ctx.github.commitFiles(ctx.branch.repoKey, match.sha);
    if (!detail) return `GitHub would not say what ${match.sha.slice(0, 7)} touched.`;
    if (detail.files.length === 0) return `${match.sha.slice(0, 7)} touched no files.`;

    const shown = detail.files.slice(0, MAX_FILES);
    const lines = shown.map(
      (file) => `  ${file.status.padEnd(8)} ${file.path}  +${file.added}/-${file.removed}`,
    );
    const rest = detail.files.length - shown.length;

    return [
      `${match.sha.slice(0, 7)} "${match.message}" touched ${detail.files.length} file(s):`,
      ...lines,
      rest > 0 ? `  … and ${rest} more` : '',
      detail.truncated ? '(GitHub caps this list at 300 files, so it may be incomplete.)' : '',
    ]
      .filter(Boolean)
      .join('\n');
  },
};
