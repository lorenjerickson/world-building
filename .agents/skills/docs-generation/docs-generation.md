---
name: docs-generation
description: Standardize repository documentation metadata. Use when creating or updating documentation stored in a source repository, including plans, design notes, proposals, decision records, specifications, and other Markdown documents.
---

# Repository Document Generation

Require every document created in a source repository to begin with this common YAML header:

```yaml
---
title: <document title>
created: YYYY-MM-DD
last_updated: YYYY-MM-DD
completion_status: not-started | in-progress | complete | unknown
disposition: exploratory | draft | approved | rejected | unknown
---
```

## Header rules

- Set `title` to the document's human-readable title.
- Set `created` to the document's creation date. Preserve this value for the lifetime of the document.
- Set `last_updated` to the creation date when creating a document.
- Update `last_updated` to the current date whenever any document content or metadata is changed.
- Set `completion_status` to exactly one of:
  - `not-started`: The intended content has not yet been developed.
  - `in-progress`: The document is being developed or remains incomplete.
  - `complete`: The intended content is complete, regardless of its disposition.
  - `unknown`: The document does not provide enough evidence to determine its completion state.
- Set `disposition` to exactly one of:
  - `exploratory`: Material is investigatory and is not yet a proposal for adoption.
  - `draft`: Material is proposed or under review but has not been approved.
  - `approved`: Material has been accepted for use.
  - `rejected`: Material has been considered and declined.
  - `unknown`: The document does not provide enough evidence to determine its disposition.

Do not infer that `complete` means `approved`; completion and disposition are independent. Preserve valid existing header values unless the document's state has changed. When editing a repository document that lacks this header, add it and derive dates or status from document content or repository evidence when available. Use `unknown` instead of guessing a completion status or disposition.
