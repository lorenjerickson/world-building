# Rule-set application API

The initial NestJS rule-set API exposes the authored catalog already backed by Payload CMS. Public responses use application-owned resources; Payload relationship shapes, pagination fields, draft flags, Lexical rich text, internal credentials, and errors remain private to the repository adapter.

## Implemented endpoints

```text
GET    /api/rule-sets
POST   /api/rule-sets
GET    /api/rule-sets/:ruleSetId
PATCH  /api/rule-sets/:ruleSetId
DELETE /api/rule-sets/:ruleSetId?expectedUpdatedAt=:revision

GET    /api/rule-sets/:ruleSetId/modules
POST   /api/rule-sets/:ruleSetId/modules
PATCH  /api/rule-sets/:ruleSetId/modules/:moduleId
DELETE /api/rule-sets/:ruleSetId/modules/:moduleId?expectedUpdatedAt=:revision

GET    /api/rule-sets/:ruleSetId/definitions
POST   /api/rule-sets/:ruleSetId/definitions
PATCH  /api/rule-sets/:ruleSetId/definitions/:definitionId
DELETE /api/rule-sets/:ruleSetId/definitions/:definitionId?expectedUpdatedAt=:revision
POST   /api/rule-sets/:ruleSetId/definitions/:definitionId/clone

GET    /api/rule-sets/:ruleSetId/releases
GET    /api/rule-sets/:ruleSetId/releases/:releaseId

GET    /api/rule-authoring/metamodel
GET    /api/rule-authoring/definition-types/:type/descriptor
POST   /api/rule-authoring/validate
POST   /api/rule-authoring/preview
POST   /api/rule-authoring/fixtures/run
```

Rule-set, module, and definition mutations write Payload drafts. Release endpoints are read-only because publication requires compiler, fixture, compatibility, and authorization gates that are not implemented yet. Composition and binding mutation endpoints remain closed for the same reason.

Rule-set deletion is limited to unreleased drafts. It requires the last observed `updatedAt` value, rejects stale requests, deletes dependent draft definitions and documents before modules and the rule set, and returns a conflict when immutable releases exist. Released rule sets must be retired instead.

Draft modules and definitions can be renamed through their normal revision-aware PATCH operations and deleted using the last observed `updatedAt` value. Published artifacts cannot be deleted. A module must be empty before deletion so the API never silently cascades definitions or leaves their external references ambiguous.

Collection reads are workspace-scoped by Payload using the authenticated Auth0 subject propagated by NestJS. Every nested route independently verifies that the addressed module, definition, clone target, or release belongs to the rule set in the URL.

## Trust boundary

Requests require `x-auth0-sub` and an `x-rule-api-token` matching `RULE_API_INTERNAL_TOKEN`. The Auth0 subject header must be removed from public inbound traffic and set by an authenticated application gateway. Docker Compose requires the token; the browser must never receive it. A future direct-browser integration should replace this trusted-header guard with Auth0 JWT validation rather than disabling the shared-secret check.

NestJS authenticates to private Payload with `CMS_INTERNAL_TOKEN` and forwards the actor subject plus the Auth0 email obtained by the server-side application gateway. Payload resolves the actor to a provisioned user and applies workspace access controls. Clients cannot choose a workspace in an API body.

On an empty installation, the first identity to cross this trusted boundary creates the primary workspace and is provisioned as its administrator. This bootstrap is serialized within the CMS process and is disabled automatically as soon as a Payload user exists. Every later unknown Auth0 identity remains denied until an administrator provisions it; the bootstrap never grants a second identity administrative access.

The Payload user collection disables the built-in local-password strategy while retaining its auth fields for schema compatibility. Rule-set users authenticate exclusively through the trusted Auth0 strategy and are never assigned synthetic local passwords.

The Next.js frontend exposes same-origin backend-for-frontend routes at `/api/rule-sets` and `/api/rule-authoring`. They obtain the Auth0 subject from the server-side session, add `RULE_API_INTERNAL_TOKEN` only on the server, and proxy supported catalog and metamodel requests to NestJS. Browser code never sends either trusted header and cannot select an identity. The gateway has no development identity bypass and fails closed without an Auth0 session.

## Dashboard experience

The authenticated landing page presents rule sets as a first-class section ahead of the world catalog. It lists the three most recently updated rule sets owned by the current workspace and provides an inline create flow. `/rule-sets` provides the complete owned catalog and `/rule-sets/:ruleSetId` provides the catalog overview, including authored modules, definitions, and releases. Search and filtering are available in the detail view. The first guided authoring slice supports Vision and Running traits as controlled semantic sentences and accessible forms, with canonical JSON relegated to a read-only advanced view and authoritative NestJS validation before save. Existing noncanonical traits can opt into either guided template; their old body is not replaced until save. Favorites, usage summaries, the general expression builder, and the complete authoring workspace remain subsequent milestones.

## API conventions

- Creation returns HTTP 201; reads and updates return HTTP 200.
- List pagination defaults to 25 and is capped at 100.
- Mutation bodies never accept Payload IDs for workspaces or external IDs.
- Every PATCH body requires `expectedUpdatedAt` from the last representation. A stale write returns HTTP 409 with `RULE_DRAFT_STALE` and the current revision timestamp for optimistic reconciliation.
- Descriptions are plain strings at the application API and are translated to and from Lexical documents internally.
- Errors emitted by the rule-set layer include stable `code`, `message`, and `retryable` fields.
- Definition clones preserve canonical body and presentation data, set `clonedFrom`, and record source provenance. They remain drafts.
