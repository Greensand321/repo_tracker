/**
 * The notebook — Plane B. What the owner has told the agent to remember, and the standing
 * instructions every brief follows (plans/agent-autonomy.md §5).
 *
 * Its own store rather than a corner of the conversation, because the conversation is a
 * transcript that expires (D93) and must never be where a fact lives. These do not expire:
 * they are shown, and removed only when the owner says so.
 *
 * No standing orders. A rule the agent applied on its own at every read would be the agent
 * acting unprompted, which the owner ruled out (Q77).
 */

import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import type { Note, NoteKind } from '../shared/types.ts';
import { readJson, writeJson } from './jsonfile.ts';
import { DATA_DIR } from './paths.ts';

type File = { notes: Note[] };

const FILE = join(DATA_DIR, 'notebook.json');
let cache: File | null = null;

function load(): File {
  if (cache) return cache;
  const parsed = readJson<Partial<File>>(FILE);
  // Only well-formed notes: one with no text would throw out of every place that reads it.
  const notes = Array.isArray(parsed?.notes) ? parsed.notes : [];
  cache = {
    notes: notes.filter((n): n is Note =>
      !!n && typeof n === 'object' && typeof n.id === 'string' && typeof n.text === 'string' && (n.kind === 'remember' || n.kind === 'brief'))
      .map((n) => ({ id: n.id, kind: n.kind, text: n.text, at: typeof n.at === 'string' ? n.at : new Date(0).toISOString() })),
  };
  return cache;
}

function persist(file: File): void {
  writeJson(FILE, file);
  cache = file;
}

export function listNotes(kind?: NoteKind): Note[] {
  const notes = load().notes;
  return kind ? notes.filter((n) => n.kind === kind) : [...notes];
}

export function addNote(kind: NoteKind, text: string): Note {
  // One line: it is printed into prompts, where a newline could pass for a new section.
  const note: Note = { id: randomUUID().slice(0, 8), kind, text: oneLine(text), at: new Date().toISOString() };
  persist({ notes: [...load().notes, note] });
  return note;
}

/** Removed, and handed back so an undo can put it back as it was. */
export function removeNote(id: string): Note | null {
  const file = load();
  const note = file.notes.find((n) => n.id === id) ?? null;
  if (note) persist({ notes: file.notes.filter((n) => n.id !== id) });
  return note;
}

/** Undo's door: the same note, same id, same place in time. */
export function restoreNote(note: Note): void {
  if (load().notes.some((n) => n.id === note.id)) return;
  persist({ notes: [...load().notes, note].sort((a, b) => a.at.localeCompare(b.at)) });
}

export const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();

export function resetNotebookCache(): void {
  cache = null;
}
