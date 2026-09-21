# The "happening now" band — five ways to say the same thing

**Status:** proposals, 21 Sep 2026. Nothing here is built. Open
[`index.html`](index.html) — it runs from disk, no server and no build, and the four
buttons at the top switch the branch state every design is drawn against.

## The complaint

The band ships five labelled rows — **for · last · done · open · now** — and on a branch
that finished cleanly, four of them say one sentence four times:

| row | what it says on `claude/affectionate-davinci-vlzdbq` |
|---|---|
| for | make the chapter row a clean project picker, name only, number in a tooltip |
| last | the newest commit simplified the chapter row to display just the project name… |
| done | pull request #630 merged, delivering the simplified chapter row… |
| open | Nothing looks unfinished. |
| now | done — vision met. The commit and merged PR deliver exactly the stated purpose… |

Ninety words to say *finished, and it is what you wanted*. That is the opposite of the
job: the tool exists so more threads can be held with **less** load, not so each one
arrives pre-filed into a schema the reader has to reassemble.

Four things are wrong, and only the last of them is cosmetic:

1. **It repeats.** Four stations each write a full sentence about one branch and the page
   prints all four whether or not they differ.
2. **Labels are filing, not reading.** Five keys mean the reader assembles the sentence.
3. **Nothing is ranked.** "Nothing looks unfinished." — a non-event — is printed at the
   weight of a finding, and the verdict that decides what you do sits last.
4. **Identifiers leaked into the prose.** "Pull request #630 merged…" — D90 already ruled
   that names are identifiers, not words. A number you never type belongs in a chip.

## The rule the five share

> The band answers one question first — **is there anything here for me?** — and only
> then, if asked, what happened.

And: **nothing is printed twice, and nothing is printed about a non-event.**

## The five

| | Design | In one line |
|---|---|---|
| N1 | **The paragraph** | No labels. One serif paragraph in four slots — lead, body, hinge, tail — three of which vanish when they have nothing to add. |
| N2 | **One line, and a fold** | The band asserts one sentence; everything printed today sits one disclosure away. The only one that ships without touching a prompt. |
| N3 | **Meant, then did** | Only the comparison — intent, reality, and a hinge word between them — because that comparison is the one thing here GitHub cannot show you. |
| N4 | **The shape follows the state** | Not one layout but four. Finished is one line; working is the next thing and nothing else; drifting is the comparison and two buttons; undescribed is the question. |
| N5 | **The note** | Written as though whoever worked on it left you a note. Ends on what you would do. |

## The change underneath all five

Every one of them gets shorter the moment the summary station stops writing four
sentences for a page that wants one. The contract moves from `last / done / open` to:

- **`state`** — one word, the thing the band leads with.
- **`gist`** — one *clause* saying what the work is, with no branch name, PR number or
  SHA inside it (D90, extended from the brief to the recap).
- **`next`** — the one thing left, or **null**. `"Nothing looks unfinished."` becomes null
  and nothing is drawn, rather than a row saying a non-event happened.

`PROMPT_VERSION` goes to `v3`, so nothing written on the old shape survives. The
four-sentence recap stays *in the data* — N2's fold reads it, and search still needs it.
It stops being what the band prints. Rule 4 holds throughout: every design above is a
different rendering of one structure, and none of them computes a fact of its own.

The three new fields are the only thing the Snapshot does not carry today; wherever a
design uses one, [`data.js`](data.js) says so rather than faking it quietly.
