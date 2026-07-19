"use client";

import Link from "next/link";
import { ChangeEvent, ReactNode, useRef, useState } from "react";
import { RichMarkdownEditor } from "@/components/mdx-editor";
import { deleteLoreImage, uploadLoreImage } from "@/lib/image-uploads";

export interface LoreReference { id: string; name: string; href: string; kind: string; }
export interface LoreFact { label: string; value: string; emptyLabel?: string; options?: { value: string; label: string }[]; onChange: (value: string) => void; }

function LinkedText({ text, references }: { text: string; references: LoreReference[] }) {
  if (!text) return <span className="document-placeholder">Click to add lore and GM notes...</span>;
  const matches = references.filter((reference) => text.toLocaleLowerCase().includes(reference.name.toLocaleLowerCase())).sort((a, b) => b.name.length - a.name.length);
  if (!matches.length) return <>{text}</>;
  const pattern = new RegExp(`(${matches.map((match) => match.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return <>{text.split(pattern).map((part, index) => { const match = matches.find((reference) => reference.name.toLocaleLowerCase() === part.toLocaleLowerCase()); return match ? <Link href={match.href} className="inline-lore-link" key={`${part}-${index}`}>{part}</Link> : part; })}</>;
}

function MarkdownInline({ text, references }: { text: string; references: LoreReference[] }) {
  const tokens = text.split(/(\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
  return <>{tokens.map((token, index) => {
    const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) return <a href={link[2]} key={index}>{link[1]}</a>;
    if (token.startsWith("**") && token.endsWith("**")) return <strong key={index}>{token.slice(2, -2)}</strong>;
    if (token.startsWith("*") && token.endsWith("*")) return <em key={index}>{token.slice(1, -1)}</em>;
    if (token.startsWith("`") && token.endsWith("`")) return <code key={index}>{token.slice(1, -1)}</code>;
    return <LinkedText text={token} references={references} key={index} />;
  })}</>;
}

export function MarkdownContent({ value, references = [] }: { value: string; references?: LoreReference[] }) {
  if (!value.trim()) return <span className="document-placeholder">Click to add lore and GM notes...</span>;
  return <div className="markdown-content">{value.split("\n").map((line, index) => {
    if (!line.trim()) return <div className="markdown-spacer" key={index} />;
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) { const content = <MarkdownInline text={heading[2]} references={references} />; return heading[1].length === 1 ? <h2 key={index}>{content}</h2> : heading[1].length === 2 ? <h3 key={index}>{content}</h3> : <h4 key={index}>{content}</h4>; }
    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) return <ul key={index}><li><MarkdownInline text={bullet[1]} references={references} /></li></ul>;
    const quote = line.match(/^>\s?(.+)$/);
    if (quote) return <blockquote key={index}><MarkdownInline text={quote[1]} references={references} /></blockquote>;
    return <p key={index}><MarkdownInline text={line} references={references} /></p>;
  })}</div>;
}

function InlineTitle({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  if (editing) return <input autoFocus className="document-title-input" value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={() => { const next = draft.trim() || value; onChange(next); setDraft(next); setEditing(false); }} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") { setDraft(value); setEditing(false); } }} />;
  return <button className="document-title" onClick={() => { setDraft(value); setEditing(true); }}>{value}</button>;
}

export function MarkdownLongText({ value, onChange, references = [], label = "long text" }: { value: string; onChange: (value: string) => void; references?: LoreReference[]; label?: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  if (editing) return <div className="document-prose-editor"><RichMarkdownEditor markdown={value} onChange={setDraft} contentEditableClassName="lore-mdx-content" aria-label={`Edit ${label} as Markdown`} /><div className="markdown-editor-footer"><span>Stored as Markdown · lore names become links automatically</span><div><button className="markdown-cancel" onClick={() => { setDraft(value); setEditing(false); }} type="button">Cancel</button><button onClick={() => { onChange(draft); setEditing(false); }} type="button">Done</button></div></div></div>;
  return <div className="document-prose" role="button" tabIndex={0} onClick={(event) => { if ((event.target as HTMLElement).closest("a")) return; setDraft(value); setEditing(true); }} onKeyDown={(event) => { if (event.key === "Enter") { setDraft(value); setEditing(true); } }}><MarkdownContent value={value} references={references} /></div>;
}

function InlineFact({ fact }: { fact: LoreFact }) {
  const [editing, setEditing] = useState(false);
  if (editing && fact.options) return <select autoFocus className="document-fact-control" value={fact.value} onChange={(event) => { fact.onChange(event.target.value); setEditing(false); }} onBlur={() => setEditing(false)}><option value="">{fact.emptyLabel || "None"}</option>{fact.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>;
  if (editing) return <input autoFocus className="document-fact-control" defaultValue={fact.value} onBlur={(event) => { fact.onChange(event.target.value); setEditing(false); }} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />;
  const selectedLabel = fact.options?.find((option) => option.value === fact.value)?.label;
  return <button className="document-fact-value" onClick={() => setEditing(true)}>{selectedLabel || fact.value || fact.emptyLabel || "Not set"}</button>;
}

function DocumentImage({ imageUrl, label, onChange }: { imageUrl?: string; label: string; onChange: (value?: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string>();
  async function upload(event: ChangeEvent<HTMLInputElement>) { const file = event.target.files?.[0]; event.target.value = ""; if (!file) return; setUploading(true); setUploadError(undefined); try { const nextUrl = await uploadLoreImage(file); await deleteLoreImage(imageUrl); onChange(nextUrl); } catch (cause) { setUploadError(cause instanceof Error ? cause.message : "Upload failed."); } finally { setUploading(false); } }
  return <div className={`document-image ${imageUrl ? "has-image" : ""}`} style={imageUrl ? { backgroundImage: `url(${imageUrl})` } : undefined} onClick={() => !uploading && input.current?.click()} role="button" tabIndex={0}><input ref={input} type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={upload} /><div className="document-image-action"><strong>{uploading ? "Uploading..." : imageUrl ? `Change ${label}` : `Add ${label}`}</strong><span>{uploadError || "PNG, JPG, GIF, or WebP · up to 5 MB"}</span></div>{imageUrl && <button type="button" onClick={async (event) => { event.stopPropagation(); await deleteLoreImage(imageUrl); onChange(undefined); }}>Remove</button>}</div>;
}

export function LoreDocument({ eyebrow, title, description, imageUrl, imageLabel = "image", facts, references, related, onTitleChange, onDescriptionChange, onImageChange, actions, media }: { eyebrow: string; title: string; description: string; imageUrl?: string; imageLabel?: string; facts: LoreFact[]; references: LoreReference[]; related?: LoreReference[]; onTitleChange: (value: string) => void; onDescriptionChange: (value: string) => void; onImageChange?: (value?: string) => void; actions?: ReactNode; media?: ReactNode; }) {
  return <article className="lore-document">
    <header className="lore-document-header"><div><span className="eyebrow">{eyebrow}</span><InlineTitle value={title} onChange={onTitleChange} /></div>{actions}</header>
    {media}
    {onImageChange && <DocumentImage imageUrl={imageUrl} label={imageLabel} onChange={onImageChange} />}
    <section className="lore-document-body"><div className="document-main"><span className="document-section-label">Lore and notes</span><MarkdownLongText value={description} onChange={onDescriptionChange} references={references} label={`${title} lore`} /></div><aside className="document-facts">{facts.map((fact) => <div className="document-fact" key={fact.label}><span>{fact.label}</span><InlineFact fact={fact} /></div>)}</aside></section>
    {!!related?.length && <footer className="document-related"><span className="document-section-label">Connected lore</span><div>{related.map((reference) => <Link href={reference.href} key={`${reference.kind}-${reference.id}`}><span>{reference.kind}</span>{reference.name}</Link>)}</div></footer>}
  </article>;
}
