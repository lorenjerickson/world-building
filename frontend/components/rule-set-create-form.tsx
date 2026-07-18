'use client';

import type { FormEvent } from 'react';
import { useState } from 'react';
import { createRuleSet, RuleSetApiError, RuleSetResource } from '@/lib/rule-sets';
import { TagEditor } from './tag-editor';

interface RuleSetCreateFormProps {
  onCancel: () => void;
  onCreated: (ruleSet: RuleSetResource) => void;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function RuleSetCreateForm({ onCancel, onCreated }: RuleSetCreateFormProps) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [summary, setSummary] = useState('');
  const [description, setDescription] = useState('');
  const [engineFeatureLevel, setEngineFeatureLevel] = useState('1');
  const [tags, setTags] = useState<string[]>([]);
  const [accentColor, setAccentColor] = useState('#e5b64c');
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    setSubmitting(true);
    try {
      const created = await createRuleSet({
        accentColor,
        description: description.trim() || undefined,
        engineFeatureLevel: engineFeatureLevel.trim(),
        name: name.trim(),
        slug,
        summary: summary.trim(),
        tags,
      });
      onCreated(created);
    } catch (cause) {
      setError(cause instanceof RuleSetApiError ? cause.message : 'The rule set could not be created.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="rule-set-create-form" onSubmit={submit}>
      <div className="rule-set-form-heading">
        <div><span className="eyebrow">New gameplay foundation</span><h4>Create a rule set</h4></div>
        <button className="secondary-action" type="button" onClick={onCancel}>Cancel</button>
      </div>
      <div className="rule-set-form-grid">
        <label className="rule-set-field"><span>Name</span><input required maxLength={120} value={name} onChange={(event) => {
          const nextName = event.target.value;
          setName(nextName);
          if (!slugEdited) setSlug(slugify(nextName));
        }} placeholder="Brass & Aether" /></label>
        <label className="rule-set-field"><span>Slug</span><input required maxLength={120} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value={slug} onChange={(event) => { setSlugEdited(true); setSlug(event.target.value.toLowerCase()); }} placeholder="brass-and-aether" /></label>
        <label className="rule-set-field rule-set-field-wide"><span>Summary</span><textarea required maxLength={1000} rows={2} value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="A concise description shown to collaborators and on the dashboard." /></label>
        <label className="rule-set-field rule-set-field-wide"><span>Authoring intent</span><textarea maxLength={20000} rows={4} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Describe the play experience, themes, and boundaries this rule set should support." /></label>
        <label className="rule-set-field"><span>Engine feature level</span><input required maxLength={64} value={engineFeatureLevel} onChange={(event) => setEngineFeatureLevel(event.target.value)} /></label>
        <div className="rule-set-field"><span>Tags</span><TagEditor tags={tags} onChange={setTags} /></div>
        <label className="rule-set-color-field"><span>Accent</span><input type="color" value={accentColor} onChange={(event) => setAccentColor(event.target.value)} /></label>
      </div>
      {error && <p className="rule-set-notice error" role="alert">{error}</p>}
      <div className="rule-set-form-actions">
        <span>Creates a private workspace draft. Nothing is published automatically.</span>
        <button className="primary-action" type="submit" disabled={submitting || !slug}>{submitting ? 'Creating…' : 'Create rule set'}</button>
      </div>
    </form>
  );
}
