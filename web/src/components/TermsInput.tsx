import { useState, type KeyboardEvent } from 'react';

const isPattern = (term: string) => /^\/.+\/[a-z]*$/s.test(term);

/** Chip-style list editor: type a word or phrase, press Enter or comma to add. */
export function TermsInput({
  terms,
  onChange,
  placeholder = 'Type a word or phrase and press Enter',
  label,
}: {
  terms: string[];
  onChange: (terms: string[]) => void;
  placeholder?: string;
  label: string;
}) {
  const [draft, setDraft] = useState('');

  const add = (raw: string) => {
    const additions = (isPattern(raw.trim()) ? [raw] : raw.split(','))
      .map((term) => term.trim())
      .filter((term) => term && !terms.includes(term));
    if (additions.length > 0) {
      onChange([...terms, ...additions]);
    }
    setDraft('');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || (event.key === ',' && !draft.startsWith('/'))) {
      event.preventDefault();
      add(draft);
    } else if (event.key === 'Backspace' && !draft && terms.length > 0) {
      onChange(terms.slice(0, -1));
    }
  };

  return (
    <div className="chips">
      {terms.map((term) => (
        <span key={term} className={`chip${isPattern(term) ? ' code' : ''}`} title={term}>
          <span className="chip-text">{term}</span>
          <button
            type="button"
            aria-label={`Remove ${term}`}
            onClick={() => onChange(terms.filter((t) => t !== term))}
          >
            ×
          </button>
        </span>
      ))}
      <input
        type="text"
        aria-label={label}
        value={draft}
        placeholder={terms.length === 0 ? placeholder : 'Add more…'}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => draft.trim() && add(draft)}
      />
    </div>
  );
}
