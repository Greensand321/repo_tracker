/**
 * A searchable dropdown.
 *
 * Replaces `<datalist>`, which looks like a solution and is not: you cannot see the
 * options without clicking into the field, it filters by prefix only, it cannot show a
 * label next to a value, and it silently accepts anything typed — which is how a display
 * name once got sent as a model ID.
 *
 * Self-contained on purpose: one mount point, no dependencies, no assumptions about the
 * page around it. It should survive the interface redesign intact.
 */

import { esc } from '../format.ts';

export type PickerOption = {
  value: string;
  /** Shown beside the value. The value is always what gets selected. */
  label?: string;
};

export type Picker = {
  setOptions(options: PickerOption[]): void;
  setValue(value: string): void;
  getValue(): string;
  setStatus(text: string): void;
};

export function createPicker(options: {
  mount: HTMLElement;
  placeholder: string;
  emptyText: string;
  onChange?: (value: string) => void;
}): Picker {
  const { mount, placeholder, emptyText, onChange } = options;

  let items: PickerOption[] = [];
  let value = '';
  let status = '';
  let open = false;
  let highlighted = 0;

  mount.classList.add('picker');
  mount.innerHTML = `
    <button type="button" class="picker-button">
      <span class="picker-value"></span>
      <span class="picker-caret">▾</span>
    </button>
    <div class="picker-panel hidden">
      <input class="picker-search" type="text" placeholder="Search…" autocomplete="off" spellcheck="false">
      <div class="picker-list" role="listbox"></div>
    </div>`;

  const button = mount.querySelector<HTMLButtonElement>('.picker-button')!;
  const valueEl = mount.querySelector<HTMLElement>('.picker-value')!;
  const panel = mount.querySelector<HTMLElement>('.picker-panel')!;
  const search = mount.querySelector<HTMLInputElement>('.picker-search')!;
  const list = mount.querySelector<HTMLElement>('.picker-list')!;

  const matching = (): PickerOption[] => {
    const needle = search.value.trim().toLowerCase();
    if (!needle) return items;
    return items.filter(
      (item) =>
        item.value.toLowerCase().includes(needle) ||
        (item.label ?? '').toLowerCase().includes(needle),
    );
  };

  function renderButton(): void {
    if (value) {
      const chosen = items.find((item) => item.value === value);
      valueEl.innerHTML = `<b>${esc(value)}</b>${chosen?.label ? `<i>${esc(chosen.label)}</i>` : ''}`;
      valueEl.classList.remove('is-placeholder');
    } else {
      valueEl.textContent = status || placeholder;
      // NOT `empty` — the lifted mockup CSS has a global `.empty` rule that turns any
      // element into a 30px-padded dashed empty-state box. Every class here is
      // namespaced for that reason.
      valueEl.classList.add('is-placeholder');
    }
  }

  function renderList(): void {
    const found = matching();
    if (found.length === 0) {
      list.innerHTML = `<div class="picker-empty">${esc(items.length === 0 ? emptyText : 'Nothing matches.')}</div>`;
      return;
    }
    highlighted = Math.min(highlighted, found.length - 1);
    list.innerHTML = found
      .map(
        (item, index) =>
          `<button type="button" class="picker-option${index === highlighted ? ' on' : ''}${
            item.value === value ? ' chosen' : ''
          }" data-value="${esc(item.value)}" role="option">
            <b>${esc(item.value)}</b>${item.label ? `<i>${esc(item.label)}</i>` : ''}
          </button>`,
      )
      .join('');
    list.querySelector<HTMLElement>('.picker-option.on')?.scrollIntoView({ block: 'nearest' });
  }

  function setOpen(next: boolean): void {
    open = next;
    panel.classList.toggle('hidden', !open);
    mount.classList.toggle('open', open);
    if (open) {
      search.value = '';
      highlighted = Math.max(0, matching().findIndex((item) => item.value === value));
      renderList();
      search.focus();
    }
  }

  function choose(next: string): void {
    value = next;
    renderButton();
    setOpen(false);
    button.focus();
    onChange?.(value);
  }

  button.addEventListener('click', () => setOpen(!open));

  search.addEventListener('input', () => {
    highlighted = 0;
    renderList();
  });

  list.addEventListener('click', (event) => {
    const option = (event.target as HTMLElement).closest<HTMLElement>('[data-value]');
    if (option) choose(option.dataset['value'] ?? '');
  });

  // Keyboard is the whole reason to hand-roll this: a datalist gives you none of it.
  panel.addEventListener('keydown', (event) => {
    const found = matching();
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (found.length === 0) return;
      highlighted = (highlighted + (event.key === 'ArrowDown' ? 1 : -1) + found.length) % found.length;
      renderList();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const picked = found[highlighted];
      if (picked) choose(picked.value);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation(); // do not also close the settings sheet
      setOpen(false);
      button.focus();
    }
  });

  document.addEventListener('mousedown', (event) => {
    if (open && !mount.contains(event.target as Node)) setOpen(false);
  });

  renderButton();

  return {
    setOptions(next: PickerOption[]): void {
      items = next;
      status = '';
      if (open) renderList();
      renderButton();
    },
    setValue(next: string): void {
      value = next;
      renderButton();
    },
    getValue: () => value,
    setStatus(text: string): void {
      status = text;
      renderButton();
    },
  };
}
