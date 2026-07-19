'use client';

import { useRef, useState } from 'react';

type TagEditorProps = {
  tags: string[];
  onChange: (tags: string[]) => void;
  knownTags?: string[];
  placeholder?: string;
};

export function TagEditor({
  tags,
  onChange,
  knownTags = [],
  placeholder = 'Add tags…',
}: TagEditorProps) {
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const trimmed = input.trim();
  const suggestions = trimmed
    ? knownTags.filter((tag) => tag.toLowerCase().includes(trimmed.toLowerCase()) && !tags.includes(tag))
    : [];

  function commit(value: string) {
    const tag = value.trim();
    if (tag && !tags.includes(tag)) onChange([...tags, tag]);
    setInput('');
    setOpen(false);
  }

  function remove(tag: string) {
    onChange(tags.filter((existingTag) => existingTag !== tag));
  }

  return (
    <div className="tag-editor" ref={wrapRef}>
      <div className="tag-editor-field" onClick={() => wrapRef.current?.querySelector('input')?.focus()}>
        {tags.map((tag) => (
          <span key={tag} className="tag-badge">
            {tag}
            <button
              type="button"
              className="tag-badge-remove"
              aria-label={`Remove ${tag}`}
              onClick={(event) => {
                event.stopPropagation();
                remove(tag);
              }}
            >
              ×
            </button>
          </span>
        ))}
        <input
          type="text"
          className="tag-editor-input"
          value={input}
          placeholder={tags.length === 0 ? placeholder : ''}
          onChange={(event) => {
            setInput(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(event) => {
            if ((event.key === ' ' || event.key === 'Tab' || event.key === ',') && trimmed) {
              event.preventDefault();
              commit(trimmed);
            }
            if (event.key === 'Enter') {
              event.preventDefault();
              if (trimmed) commit(trimmed);
            }
            if (event.key === 'Backspace' && !input && tags.length > 0) {
              remove(tags[tags.length - 1]);
            }
            if (event.key === 'Escape') {
              setInput('');
              setOpen(false);
            }
          }}
        />
      </div>
      {open && suggestions.length > 0 && (
        <div className="tag-suggestions">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              className="tag-suggestion"
              onMouseDown={() => commit(suggestion)}
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}