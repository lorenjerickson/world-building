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
POST   /api/rule-sets/:ruleSetId/releases
GET    /api/rule-sets/:ruleSetId/releases/:releaseId

GET    /api/rule-authoring/metamodel
GET    /api/rule-authoring/definition-types/:type/descriptor
POST   /api/rule-authoring/validate
POST   /api/rule-authoring/preview
POST   /api/rule-authoring/fixtures/run
```

Rule-set, module, and definition mutations write Payload drafts. Publishing a release requires a semantic version, the last observed rule-set revision, and optional release notes. NestJS validates every definition, compiles each supported metamodel, resolves recursive trait contracts, creates a canonical source snapshot and dependency lock, and stores the compiled artifacts in a single immutable Payload release document. The operation double-checks module and definition revisions after compilation and aborts when the draft changes concurrently. Repeating the same version and content is idempotent; reusing a version for different content is rejected.

Composition and binding mutation endpoints remain closed pending aggregate compilation and migration work.

Resolution previews return scalar operation data plus a `rolls` collection. Each roll contains its optional source Dice Roll trait, purpose subtotals, and individual die results with reusable trait identity, roll-trait provenance, raw/effective value, origin, replacement links, active state, source definition, and applied modifiers. Entropy remains explicit and is consumed for original, added, and replacement dice in deterministic modifier order.

Modifier activation is resolved independently from applicability. After the context's traits, effects, and explicit overrides establish the active set, the evaluator applies each modifier only when its exact check or semantic `appliesTo` scope matches the current check. Purpose and Dice Roll trait targeting are stable authored selectors; publication validates Dice Roll trait targets against compiled trait collections.

Resolution contexts may supply `activeTraitIds`, `activeEffectIds`, and the compatibility override `activeModifierIds`. Modifiers declare activating traits; effects contribute their existing `modifierIds`. Applying an effect to the actor activates its modifiers for subsequent operation steps. Each preview roll reports applied modifier IDs plus their explicit, trait, or effect activation sources.

When trait definitions or a compiled trait artifact accompany the resolution artifact, `activeTraitIds` are high-level roots. The evaluator expands compiled requirement and addition edges, returns the effective active-trait set, and includes root and chain information in modifier provenance. Mixed authoring preview and fixture endpoints accept trait envelopes alongside resolution bodies so draft behavior matches release behavior. An unknown root is rejected when a compiled trait artifact is present.

Compiled traits with multiple `any` prerequisites expose activation-choice contracts. Runtime contexts resolve them with `traitPrerequisiteSelections`, keyed by the owning trait ID. Selections must contain one or more allowed alternatives. Preview responses return the resolved choices and whether each came from the explicit context or the compatibility fallback of an already-active alternative root.

Callers that need repeated copies use `activeTraitInstances`, where each root supplies a stable `instanceId`, `traitId`, and optional independent values. Instance-specific alternatives use `traitInstancePrerequisiteSelections`; `traitInstanceValues` can address deterministic generated children. Preview responses return every mounted instance with its root, parent, relation, path, ordinal, trait chain, instance chain, and values. Counted additions materialize one child instance per count. Trait-ID-keyed selections are rejected when more than one active instance would make them ambiguous.

Instance values are validated against direct terminal fields in the compiled trait contract. The `trait-instance-field` resolution expression reads one value using an exact `instanceId` and direct field `key`; unavailable instances or values are errors. Local compiled trait modifiers materialize same-instance effective values, including reusable Die traits that set their own `sides`. Preview output returns those effective values.

Active instances also report canonical `mountPath` values. Compiled trait modifiers preserve their `self` or `this` anchor and resolve exact paths against this mounted tree before operation evaluation. Every applied modifier is returned on the target instance with source trait/instance IDs, anchor, operation, path, amount, and before/after values. Missing or ambiguous targets and missing numeric base values are rejected; exact paths never fan out implicitly across repeated collection entries.

Repeated collection modifiers use a `[]` path segment plus a required `mountSelector`. `{ "mode": "all" }` targets every counted entry; `{ "mode": "ordinal", "ordinal": 2 }` targets one one-based contribution ordinal. The compiler validates the selected direct field through the collection's accepted base traits. Runtime provenance on each target includes the selector. Selectors without `[]`, repeated paths without selectors, missing ordinals, and ambiguous ordinal matches are rejected.

Resolution expressions may read the effective mounted value by structural contract path with `{ "op": "trait-path-field", "path": "self.speed.walk.rate" }`. The path is evaluated after trait value modifiers and must resolve to exactly one field-owning instance. Repeated reads use one `[]` segment and the required one-based ordinal selector, for example `self.dice[].sides` with `{ "mode": "ordinal", "ordinal": 2 }`; scalar expressions do not support an all-entries selector. Missing and ambiguous values are errors. Guided authoring uses one expression control across check, modifier, validation, resource-consumption, event-payload, and return-value fields, offering only terminal paths derived from available compiled trait shapes. The instance-ID expression remains available for mechanics that deliberately address a named runtime instance.

Checks, modifiers, and operations may include `subjectTraitIds`, declaring the traits that `self` must have when the rule executes. Guided path completion resolves only fields guaranteed by those recursive contracts. The resolution compiler requires a non-empty list of stable `trait:*` IDs when the field is present. Release compilation verifies every reference against published traits and rejects structural expressions outside the declared effective shape. Runtime rejects an operation, check, or applicable modifier whose subject traits are absent from the expanded active instances. The declaration never grants traits. Omitting it preserves broad catalog completion for legacy definitions but does not add a runtime requirement.

`subjectTraitSelections` may narrow a reachable trait's multiple `any` prerequisites to one or more required alternatives, for example `{ "trait:adaptive-training": ["trait:brutal"] }`. Branch fields then become guaranteed completion and publication targets. Publication verifies the owner and alternatives against the published trait graph; runtime verifies the entity's resolved prerequisite choice. The editor labels branch-only unavailable paths and can repair them by requiring the appropriate branch.

An operation inherits the subject contracts of every check on a reachable `perform-check` step. Its compiled `operationSubjectContracts` entry contains `directTraitIds`, `inheritedTraitIds`, `effectiveTraitIds`, optional `effectiveTraitSelections`, and `checkSources`. Guided completion, sample preview, release path validation, and runtime operation-entry validation use the effective roots and selections; the authored operation continues to store only its direct contract. Unreachable draft branches do not contribute. Applicable modifiers are not propagated because their activation is conditional and their own contracts are checked when they execute.

Guided path options derive explanatory provenance from the effective trait shape. Each option identifies its guaranteeing root, ordered trait chain, direct/inherited/catalog origin, and inherited check IDs. Collection-field provenance includes the accepted base trait that owns the field. This explanation is UI data only; persisted expressions retain the stable `path` and optional ordinal selector.

When a persisted path is outside the current effective contract, guided authoring derives repair candidates from catalog roots that guarantee that exact path. Every candidate is test-composed with the existing direct and inherited roots; candidates producing conflicts or failing to restore the path are withheld. Accepting a repair adds the chosen root to the rule's direct `subjectTraitIds` and never edits an inherited check contract. Paths absent from the catalog and paths blocked by composition conflicts receive distinct explanations.

Rule-set deletion is limited to unreleased drafts. It requires the last observed `updatedAt` value, rejects stale requests, deletes dependent draft definitions and documents before modules and the rule set, and returns a conflict when immutable releases exist. Released rule sets must be retired instead.

Draft modules and definitions can be renamed through their normal revision-aware PATCH operations and deleted using the last observed `updatedAt` value. Published artifacts cannot be deleted. A module must be empty before deletion so the API never silently cascades definitions or leaves their external references ambiguous.

Legacy trait drafts expose an explicit compatibility workflow:

```text
POST /api/rule-sets/:ruleSetId/definitions/:definitionId/migration/preview
POST /api/rule-sets/:ruleSetId/definitions/:definitionId/migration
```

Preview returns canonical `trait/2` source, compiler diagnostics, and added, removed, or changed effective paths. Apply requires `expectedUpdatedAt`, stores the current `trait/1` source in definition history, and advances the same stable definition to schema version 2. Published release snapshots are never rewritten. Missing legacy placement keys block migration rather than falling back to names.

Collection reads are workspace-scoped by Payload using the authenticated Auth0 subject propagated by NestJS. Every nested route independently verifies that the addressed module, definition, clone target, or release belongs to the rule set in the URL.

## Trust boundary

Requests require `x-auth0-sub` and an `x-rule-api-token` matching `RULE_API_INTERNAL_TOKEN`. The Auth0 subject header must be removed from public inbound traffic and set by an authenticated application gateway. Docker Compose requires the token; the browser must never receive it. A future direct-browser integration should replace this trusted-header guard with Auth0 JWT validation rather than disabling the shared-secret check.

NestJS authenticates to private Payload with `CMS_INTERNAL_TOKEN` and forwards the actor subject plus the Auth0 email obtained by the server-side application gateway. Payload resolves the actor to a provisioned user and applies workspace access controls. Clients cannot choose a workspace in an API body.

On an empty installation, the first identity to cross this trusted boundary creates the primary workspace and is provisioned as its administrator. This bootstrap is serialized within the CMS process and is disabled automatically as soon as a Payload user exists. Every later unknown Auth0 identity remains denied until an administrator provisions it; the bootstrap never grants a second identity administrative access.

The Payload user collection disables the built-in local-password strategy while retaining its auth fields for schema compatibility. Rule-set users authenticate exclusively through the trusted Auth0 strategy and are never assigned synthetic local passwords.

The Next.js frontend exposes same-origin backend-for-frontend routes at `/api/rule-sets` and `/api/rule-authoring`. They obtain the Auth0 subject from the server-side session, add `RULE_API_INTERNAL_TOKEN` only on the server, and proxy supported catalog and metamodel requests to NestJS. Browser code never sends either trusted header and cannot select an identity. The gateway has no development identity bypass and fails closed without an Auth0 session.

## Dashboard experience

The authenticated landing page presents rule sets as a first-class section ahead of the world catalog. It lists the three most recently updated rule sets owned by the current workspace and provides an inline create flow. `/rule-sets` provides the complete owned catalog and `/rule-sets/:ruleSetId` provides the catalog overview, including authored modules, definitions, and releases. Search and filtering are available in the detail view. Guided authoring supports recursive trait grants, typed counted trait collections, nested additions, effective-shape previews, resolution definitions, and immutable publication. Die and die-result controls offer only concrete traits in the current rule set that satisfy the Die contract; the canonical normalized source remains visible as a read-only advanced view. Existing noncanonical traits are not replaced until the GM saves a guided version.

## API conventions

- Creation returns HTTP 201; reads and updates return HTTP 200.
- List pagination defaults to 25 and is capped at 100.
- Mutation bodies never accept Payload IDs for workspaces or external IDs.
- Every PATCH body requires `expectedUpdatedAt` from the last representation. A stale write returns HTTP 409 with `RULE_DRAFT_STALE` and the current revision timestamp for optimistic reconciliation.
- Descriptions are plain strings at the application API and are translated to and from Lexical documents internally.
- Errors emitted by the rule-set layer include stable `code`, `message`, and `retryable` fields.
- Definition clones preserve canonical body and presentation data, set `clonedFrom`, and record source provenance. They remain drafts.
