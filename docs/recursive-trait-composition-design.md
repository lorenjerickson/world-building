# Recursive Trait Composition

| Attribute | Value |
| --- | --- |
| Status | Proposed direction; core terminology and composition decisions accepted |
| Audience | Product, rule-system architecture, frontend, backend, and QA |
| Last updated | 2026-07-23 |
| Related designs | [Rule sets design](./rule-systems-design-doc.md), [Rule data authoring strategy](./rule-data-authoring.md) |

## 1. Purpose

This document records the product and implementation direction for composing fine-grained traits into progressively richer entity structures.

It addresses a concrete authoring problem in the current grants editor: a GM can define a trait such as `Speed` that grants `Walk`, `Run`, and other traits, but modifier-path completion only evaluates one trait level below the holder. A modifier author who selects `self.speed` therefore receives no useful completion even when `Speed` grants traits that eventually expose numeric fields.

That behavior is an implementation limitation, not an intended rule-model constraint.

The central decision is:

> Traits are recursively composable building blocks. A trait may add fields, add other traits locally or into an existing nested structure, require structure, and modify terminal values. Applying a high-level trait produces an effective structure by recursively expanding its grants.

The model should remain small. The product should not require GMs to learn separate engine concepts such as categories, components, profiles, or schemas merely to organize related data. A trait's role emerges from what it adds and how it is applied.

## 2. Product language

### 2.1 Trait

A **trait** is a reusable definition that may contribute:

- typed fields;
- other traits at named locations;
- requirements on existing traits or paths;
- modifiers to terminal fields; and
- later, other rule behavior such as operations or effects.

A trait can be fine-grained, such as `Walk`, or broadly compositional, such as `Speed` or `Creature`. Both use the same underlying concept.

### 2.2 Adds

**Adds** is the primary compositional verb.

Applying a trait that adds another trait changes the holder's effective structure. This is stronger and clearer than saying that one trait merely "includes" another.

Examples:

```text
Creature adds Attributes as attributes.
Creature adds Speed as speed.
Speed adds Walk as walk.
Speed adds Run as run.
```

These additions produce paths such as:

```text
self.attributes
self.speed.walk
self.speed.run
```

### 2.3 Extends

**Extends** is GM-facing authoring language for adding something into an existing nested trait.

```text
Winged extends Speed with Fly as fly.
```

The canonical meaning is:

```text
Winged requires self.speed.
Winged adds Fly at self.speed.fly.
```

`extends` should initially be syntactic or presentation sugar over a nested `adds` operation, not a separate composition primitive. This keeps the canonical model small while giving the GM a natural sentence for a common intent.

### 2.4 Applies

A high-level trait may be **applied** to an entity root.

```text
Goblin applies Creature.
```

Applying `Creature` should add Creature's contents directly to the entity:

```text
goblin.attributes
goblin.speed
goblin.senses
```

It should not introduce an unwanted `goblin.creature` path segment. A named path segment is created by an explicit named addition, not merely by applying a definition.

The ordinary compendium UI may phrase this more naturally:

```text
Goblin is a Creature.
```

### 2.5 Requires

**Requires** declares the traits or structure guaranteed to be present when a trait is applied.

Requirements serve two purposes:

- they prevent invalid composition; and
- their recursive effective structure drives path completion while authoring the dependent trait.

Requirements should not be confused with catalog visibility. A definition may be known to the rule set without being guaranteed in the current authoring context.

### 2.6 Modifies

**Modifies** contributes an attributable adjustment to a terminal typed field.

```text
Boots of Striding modifies self.speed.walk.rate by +10 feet.
```

The modifier affects walking without implicitly affecting running, swimming, or flying. Modifier evaluation must retain provenance so the system can explain the base value, each contribution, and the effective result.

The detailed semantics for modifiers declared locally inside a nested trait remain a follow-up design decision. See [Open decisions](#11-open-decisions).

### 2.7 Replaces and suppresses

The following verbs are promising but are not required for the first recursive-composition milestone:

- **replaces** deliberately substitutes one contribution at a path;
- **suppresses** makes a matching contribution ineffective while preserving its provenance.

Literal **removes** is not recommended as the first negative-composition primitive. Permanent removal creates order-dependent ambiguity:

```text
Winged adds Fly.
Grounded removes Fly.
Magical Flight adds Fly.
```

Without explicit precedence and conflict rules, the result depends on evaluation order. Suppression is reversible and explainable: Wings may still contribute Fly while Grounded prevents that contribution from currently taking effect.

## 3. Traits create an effective shape

A trait definition describes contributions. Recursively composing the applied traits produces the entity's **effective shape**.

"Effective shape" is useful documentation and UI language, not necessarily a new authored rule type.

For example:

```text
Creature
├── adds Attributes as attributes
├── adds Speed as speed
└── adds Senses as senses

Speed
├── adds Walk as walk
└── adds Run as run

Walk
└── rate: movement-rate

Run
├── rate: movement-rate
└── exertion: number

Senses
├── adds Vision as vision
└── adds Hearing as hearing

Vision
├── range: distance
├── lighting: enum
└── requiresLineOfSight: boolean
```

Applying Creature yields:

```text
self.attributes
self.speed.walk.rate
self.speed.run.rate
self.speed.run.exertion
self.senses.vision.range
self.senses.vision.lighting
self.senses.vision.requiresLineOfSight
self.senses.hearing
```

There is no fixed trait depth. A branch may grant another trait for as many levels as the authored domain requires, subject to compiler cycle detection and bounded expansion.

## 4. Why Walk may remain a trait

The engine should not force every apparently simple value to be a scalar field on its parent.

`Walk` may begin with one field:

```text
Walk
└── rate: movement-rate
```

It may later grow without changing its position in the composed structure:

```text
Walk
├── rate: movement-rate
├── actionCost: number
├── difficultTerrainMultiplier: decimal
├── minimumClearance: distance
└── canUseWhileEncumbered: boolean
```

The GM decides whether a concept deserves its own trait based on expected reuse and growth. The product does not need a separate component type to permit that evolution.

This also permits targeted mechanics:

```text
Boots of Striding modifies self.speed.walk.rate.
Webbed Feet modifies self.speed.swim.rate.
Haste may eventually select several movement modes.
```

The first implementation should support exact paths. Trait selectors or wildcards such as `self.speed.*.rate` should be designed separately because they require explicit matching, typing, stacking, and explanation rules.

## 5. Definition identity, catalog organization, and placement

Three currently adjacent ideas must remain semantically independent.

### 5.1 Definition identity

A trait has a stable identity:

```text
trait:fly
```

Renaming or reorganizing its presentation must not break references.

### 5.2 Catalog organization

Modules, tags, search facets, or a catalog tree help the GM find Fly:

```text
Movement / Modes / Fly
```

Catalog organization must not create runtime path segments.

### 5.3 Placement

A named trait addition establishes placement:

```text
Winged adds trait:fly at self.speed.fly.
```

The same definition can theoretically be mounted in different structures. Whether the authoring UI permits broad reuse or guides the GM toward conventional placements is a product choice, but identity must not silently determine placement.

For current `trait/1` definitions, the `key` on a trait grant already approximates a local placement name. The next metamodel revision must make local versus nested placement explicit.

## 6. Path and scope semantics

The expected path language is:

- `this` — the current trait instance or local addition scope;
- `self` — the root entity holding the composed traits;
- `target` — an external target selected by the surrounding rule; and
- `owner` — the owning entity of equipment, attachments, or similar objects.

The ordinary UI should avoid making a GM type these tokens. It should present readable breadcrumbs and sentences.

Examples:

```text
Speed adds Walk locally as walk.
```

Canonical destination:

```text
this.walk
```

```text
Winged adds Fly to the holder's Speed as fly.
```

Canonical destination:

```text
self.speed.fly
```

```text
Boots of Striding increases the holder's Walking Rate.
```

Canonical target:

```text
self.speed.walk.rate
```

When a high-level trait such as Creature is applied at the entity root, its local additions are merged at that root. Consequently, Creature's `this.speed` becomes the entity's `self.speed`; the Creature definition name does not become a path segment.

The precise canonical encoding of `this` and path rebasing must be proven with compiler tests before publication support is added.

## 7. Structural addition semantics

The initial composition algebra should have one canonical structural operation:

```text
add <trait reference> at <destination path>
```

Local authoring is shorthand:

```text
add Walk as walk
```

Canonical form:

```text
add trait:walk at this.walk
```

Nested authoring is:

```text
extend Speed with Fly as fly
```

Canonical form:

```text
require self.speed
add trait:fly at self.speed.fly
```

### 7.1 Collision rules

Composition must be deterministic.

At minimum:

- adding the same trait identity to the same path more than once should be idempotent or merge explicitly attributable applications;
- adding different trait identities to the same singular path should produce a conflict unless an explicit replacement or coexistence policy applies;
- adding a child beneath a path that is not a trait branch should be a type error;
- modifying a branch instead of a terminal field should be a type error;
- numeric modifier operations should only target compatible numeric fields; and
- every conflict diagnostic should name the destination path and the contributing definitions.

The first milestone should reject ambiguous collisions rather than infer precedence.

### 7.2 Cycles and expansion limits

Recursive grants make cycle detection mandatory.

Invalid direct cycle:

```text
A adds A as child.
```

Invalid indirect cycle:

```text
A adds B.
B adds C.
C adds A.
```

The compiler should:

- detect cycles by stable definition identity during recursive expansion;
- report the complete grant chain that closes the cycle;
- enforce maximum expanded-node and maximum-depth budgets;
- memoize reusable definition expansion without losing placement-specific diagnostics; and
- never rely on unbounded browser recursion.

## 8. Completion behavior

### 8.1 Guaranteed effective shape

Modifier completions should be derived from the recursively expanded effective shape guaranteed by:

1. the current trait's requirements;
2. the current trait's already-declared additions; and
3. any explicitly selected preview or application context.

Known definitions that are not reachable from this context should not appear as though they are currently available.

For a trait requiring Creature, the completion tree should resemble:

```text
Self
├── Attributes
├── Speed
│   ├── Walk
│   │   └── Rate                    movement-rate
│   └── Run
│       ├── Rate                    movement-rate
│       └── Exertion                number
└── Senses
    ├── Vision
    │   ├── Range                   distance
    │   ├── Lighting                enum
    │   └── Requires line of sight  boolean
    └── Hearing
```

Branch nodes such as Speed and Walk open their children. They are not terminal modifier targets and must not produce an empty result merely because their immediate grants are traits.

### 8.2 Search

Search should match labels, stable identities, placement keys, and complete paths.

Searching for "walk" should be able to return:

```text
Self › Speed › Walk › Rate       movement-rate
```

Results should show:

- a readable breadcrumb;
- terminal type and unit when applicable;
- the definition that contributes the terminal field; and
- why the path is available, when useful for diagnostics.

### 8.3 Operation-aware filtering

After resolving the recursive path tree, the picker should filter or disable terminal fields based on the selected operation:

- increase, decrease, multiply, and divide require compatible numeric terminals;
- set may target any supported terminal type;
- enum setters should offer allowed values;
- Boolean setters should offer true and false; and
- units must be checked before accepting a modifier amount.

Filtering must not remove intermediate branches just because some descendants are incompatible. A branch should remain visible when it contains at least one compatible terminal descendant.

### 8.4 Unavailable known paths

A later enhancement may expose a secondary section for definitions known to the rule set but not guaranteed by the current context:

```text
Other known paths
  Self › Speed › Fly › Rate
  Requires Winged or another Fly provider
```

Selecting one should propose the missing requirement or leave the draft incomplete with a clear diagnostic. It must not silently make an unavailable path valid.

## 9. Authoring examples

### 9.1 Foundational Creature trait

GM-facing form:

```text
Creature adds:
  Attributes as "attributes"
  Speed as "speed"
  Senses as "senses"
```

Effective shape preview:

```text
Creature
├── attributes
├── speed
└── senses
```

### 9.2 Recursive Speed trait

GM-facing form:

```text
Speed adds:
  Walk as "walk"
  Run as "run"
```

Walk:

```text
Walk adds the following values:
  Rate — movement-rate, default 30 feet per turn
```

The preview under Creature becomes:

```text
Creature
└── speed
    ├── walk
    │   └── rate
    └── run
        └── rate
```

### 9.3 Winged extends Speed

GM-facing sentence:

```text
Winged extends the holder's Speed with Fly as "fly".
```

Expanded meaning:

```text
Winged requires self.speed.
Winged adds Fly at self.speed.fly.
```

Effective-shape diff:

```diff
 self.speed
 ├── walk
 ├── run
+└── fly
```

### 9.4 Targeted walking modifier

GM-facing sentence:

```text
Boots of Striding increases Self › Speed › Walk › Rate by 10 feet per turn.
```

Conceptual evaluation trace:

```text
self.speed.walk.rate
  Base from Walk:                  30 feet per turn
  Boots of Striding contribution: +10 feet per turn
  Effective value:                40 feet per turn
```

The exact persisted representation of the contribution ledger is an evaluator decision. The compiled artifact and trace must retain source identity even if runtime state stores only the minimum necessary data.

### 9.5 Creature compendium entry

GM-facing form:

```text
Goblin is:
  Creature
  Humanoid
  Small
```

Applying Creature recursively provides the foundational structure. Applying other traits may fill values, add new branches, or contribute modifiers.

The editor should preview the effective structure and identify which trait contributes each node.

## 10. Canonical model direction

The current grants editor emits `metamodelVersion: "trait/1"` entries where a trait grant has a `ref` and optional `key`. This supports local named grants but does not explicitly represent arbitrary placement or recursive expansion semantics.

A future canonical revision should represent, at minimum:

- a stable referenced trait identity;
- a destination scope and path;
- parameters or initial values supplied to the added trait, if supported;
- source provenance;
- requirements; and
- terminal modifiers.

Illustrative, non-final source:

```json
{
  "metamodelVersion": "trait/2",
  "requires": [
    { "path": "self.speed", "trait": "trait:speed" }
  ],
  "contributions": [
    {
      "kind": "add-trait",
      "trait": "trait:fly",
      "at": "self.speed.fly"
    }
  ]
}
```

A local grant could normalize to:

```json
{
  "kind": "add-trait",
  "trait": "trait:walk",
  "at": "this.walk"
}
```

This JSON is a design sketch, not a locked schema. The implementation should settle names after writing compiler fixtures for local application, nested extension, rebasing, duplicate additions, collisions, and cycles.

Existing `trait/1` trait grants can be interpreted as:

```text
{ dataType: "trait", ref: X, key: K }
→ add X at this.K
```

That provides a likely non-destructive migration path for existing authored definitions.

## 11. Open decisions

The following questions are intentionally not resolved by this document:

1. **Local modifier scope:** When a nested trait declares `this.rate`, does `this` always refer to its mounted trait instance, and how is that reference represented after compilation?
2. **Modifier storage:** Which parts of the base value and contribution ledger are persisted as runtime state versus recomputed from the compiled composition?
3. **Stacking:** How do additive, multiplicative, replacement, minimum, maximum, and conditional modifiers combine?
4. **Suppression:** Does suppression target a path, a trait identity, a particular source contribution, or a selector?
5. **Replacement:** What compatibility rules allow one trait to replace another at an existing path?
6. **Multiple instances:** May the same trait be mounted more than once under different keys, and how are individual instances addressed?
7. **Parameters:** How does a grant configure fields or parameters on the trait it adds without creating a new definition?
8. **Collections:** When should repeated children be represented as named trait grants versus typed collections?
9. **Selectors:** Should a future modifier support paths such as `self.speed.*.rate`, trait-identity selectors, or semantic tags?
10. **Optional paths:** How should evaluation behave when a conditional or suppressed addition makes a previously valid path unavailable?
11. **Negative composition precedence:** What deterministic policies govern replaces and suppresses when several releases contribute competing rules?

The recursive completion and local/nested add milestones do not require speculative answers to all of these questions.

## 12. Current implementation findings

The current grants authoring implementation is concentrated in:

- `apps/frontend/components/guided-trait-grants-editor.tsx`;
- `apps/frontend/components/rule-set-child-create-forms.tsx`; and
- the rule definition resource types under `apps/frontend/lib`.

The relevant behavior today is:

- modifier paths are stored as ordered string segments and serialized as a dotted `field`;
- path roots include `self`, `target`, and `owner`;
- first-level completion is derived primarily from prerequisite trait definitions and named sibling trait grants;
- trait grants are treated as navigable intermediates;
- `grantGrantsFrom` deliberately excludes trait-valued grants from terminal property choices;
- path completion after the first trait segment inspects only that matched definition's immediate non-trait grants;
- terminal resolution searches the immediately identified trait rather than recursively walking mounted grants; and
- a generic fallback aggregates terminal property names from all definitions, which can suggest a field without preserving its actual reachable path.

As a result, a definition shaped like:

```text
self → speed → walk → rate
```

cannot be reliably completed when `Speed` grants `Walk` and `Walk` grants `rate`.

There is also a broader metamodel split:

- guided creature-capability definitions use closed semantic contracts such as `movement.walk.rate` and `perception.visual.maximumRange`;
- the general grants editor emits an open-ended `trait/1` graph.

The implementation should reconcile these approaches around typed recursive paths rather than allowing browser-only grants semantics and backend capability semantics to drift independently.

## 13. Implementation plan

### Phase 0: Characterize and lock the decisions

1. Add executable fixtures for:
   - Creature adding Speed and Senses;
   - Speed adding Walk and Run;
   - Walk exposing a numeric or movement-rate terminal;
   - Winged adding Fly beneath Speed;
   - a modifier targeting `self.speed.walk.rate`;
   - direct and indirect grant cycles; and
   - two incompatible additions at the same path.
2. Decide the canonical `trait/2` names only after the fixtures express the desired outcomes.
3. Document whether the first shipped implementation treats `extends` purely as UI language.
4. Preserve the decisions in this document as acceptance criteria for implementation review.

Deliverable: reviewed fixtures and a versioned canonical schema proposal.

### Phase 1: Extract a shared recursive trait-shape resolver

1. Move path discovery out of React component-local helpers into an application-owned, framework-independent module.
2. Define resolver inputs:
   - definitions indexed by stable identity;
   - starting requirements or applied traits;
   - current draft contributions;
   - root scope;
   - expansion budgets; and
   - optional expected terminal type or modifier operation.
3. Define resolver output as a typed tree or graph containing:
   - path segments;
   - branch versus terminal classification;
   - terminal value schema;
   - contributing definition identity;
   - mount provenance;
   - availability status; and
   - diagnostics.
4. Recursively follow trait grants at every depth.
5. Rebase local `this` additions at each mount location.
6. Detect missing references, invalid child placement, cycles, depth limits, and node-budget exhaustion.
7. Make traversal deterministic by stable identity and placement key.

Deliverable: a pure resolver with unit tests independent of React and Payload.

The resolver should ultimately be shared with or implemented behind the NestJS compiler boundary. The browser must not become the sole authority for composition semantics.

### Phase 2: Replace modifier completion with recursive completion

1. Replace `buildSegmentOptions`, `resolveNamedTraitGrantDef`, and `resolveTerminalGrant` behavior with queries against the typed recursive shape.
2. Allow any number of branch selections before reaching a terminal.
3. Keep branches visible when they contain compatible terminal descendants.
4. Remove the generic all-definitions terminal fallback from the primary completion path.
5. Filter terminal options by modifier operation and typed value compatibility.
6. Show full breadcrumbs, field types, units, and contributing trait labels.
7. Add explicit empty states:
   - no structure is guaranteed;
   - this branch has no compatible terminal fields;
   - a referenced trait is missing; or
   - recursive expansion is invalid.
8. Preserve keyboard navigation and searchable selection.

Deliverable: `self.speed.walk.rate` and similarly deep paths can be authored without manual segment entry.

### Phase 3: Add effective-shape preview

1. Add a read-only tree preview to the trait grants editor.
2. Show:
   - local fields;
   - recursively added traits;
   - complete mounted paths;
   - source trait for each node;
   - draft additions not yet persisted; and
   - conflicts or cycles inline.
3. Add a diff view for traits that extend an existing required structure.
4. Use the frontend's established dashboard, card, field, and action classes rather than introducing ad hoc page styling.
5. Test the nearest analogous production authoring flows for responsive layout and keyboard accessibility.

Deliverable: the GM can see the structure a trait produces before saving it.

### Phase 4: Author nested additions

1. Extend the trait-grant sentence so the GM can choose:
   - add locally; or
   - add to an existing path on the holder.
2. Present nested addition in natural language:

   ```text
   Winged extends Self › Speed with Fly as "fly".
   ```

3. Compile `extends` to a nested add plus a structural requirement.
4. Validate that the destination exists and is a trait branch.
5. Detect path collisions before save.
6. Preview the effective-shape diff immediately.
7. Continue to use stable references internally even when the UI shows labels.

Deliverable: Winged can add Fly at `self.speed.fly` through guided authoring.

### Phase 5: Backend validation and compilation

1. Add the versioned recursive trait schema to the authoritative rule metamodel.
2. Validate recursive grants, destinations, types, cycles, collision rules, and expansion budgets in NestJS or a shared compiler package.
3. Normalize syntactic sugar such as local additions and `extends`.
4. Produce an immutable compiled trait-shape artifact with stable hashes.
5. Include source provenance for every mounted node and modifier target.
6. Reject invalid drafts at publication even if a browser accepted them.
7. Expose descriptors needed by the frontend rather than duplicating semantic rules in React.
8. Add deterministic compiler and evaluator traces.

Deliverable: browser and server agree on the same recursive effective shape.

### Phase 6: Compatibility and migration

1. Read existing `trait/1` local trait grants as additions at `this.<key>`.
2. Provide an explicit `trait/1` to `trait/2` source migration.
3. Preserve stable trait references and placement keys.
4. Diagnose missing or blank keys rather than inventing unstable placement from display names.
5. Produce a semantic diff showing path changes before a rule-set release is upgraded.
6. Keep published releases immutable; migration creates a new draft or release.
7. Add round-trip tests for old source, migrated source, and compiled shape.

Deliverable: existing authored traits remain understandable and can be upgraded without silent path changes.

### Phase 7: Modifier composition follow-up

After recursive structural composition is stable:

1. Decide `this` semantics for modifiers declared by mounted traits.
2. Specify contribution provenance and stacking order.
3. Implement base, contribution, and effective-value traces.
4. Add unit-aware modifier validation.
5. Design suppression and replacement as deterministic, attributable operations.
6. Consider trait or path selectors only after exact-path behavior is proven.

Deliverable: modifiers remain explainable and reversible across composed traits.

## 14. Test plan

### 14.1 Resolver unit tests

- expands zero, one, and many nested trait levels;
- rebases local grants under each mount;
- expands the same definition safely at different mount paths;
- detects direct and indirect cycles;
- reports missing references with the complete source path;
- enforces depth and node budgets;
- distinguishes branches from typed terminals;
- preserves value constraints and enum choices;
- filters operations without hiding valid descendant branches;
- rejects a child addition under a terminal field;
- reports incompatible additions at the same path; and
- produces deterministic ordering and hashes.

### 14.2 Authoring UI tests

- selecting Self, Speed, Walk, and Rate completes the full path;
- searching "walk" returns the full reachable breadcrumb;
- selecting a branch advances rather than prematurely closing the picker;
- an unresolved branch displays a useful diagnostic instead of a blank list;
- enum, Boolean, text, and numeric terminals render the appropriate value control;
- changing the operation invalidates or filters incompatible terminals;
- adding Fly beneath Speed updates the preview immediately;
- keyboard-only navigation can traverse arbitrary depth; and
- accessible labels describe both branch and terminal options.

### 14.3 Compiler tests

- local additions normalize to explicit mounted additions;
- nested additions require a valid destination branch;
- applying Creature merges its local additions at the entity root;
- applying Winged adds Fly beneath Speed without creating a Winged path segment;
- compiled output retains mount and source provenance;
- collisions and cycles block publication;
- `trait/1` migration preserves existing local paths; and
- clean compilation does not depend on Payload or mutable CMS access.

### 14.4 Acceptance scenario

The milestone is accepted when a GM can:

1. define Walk with a typed `rate`;
2. define Speed that adds Walk as `walk`;
3. define Creature that adds Speed as `speed`;
4. define Boots of Striding that requires Creature;
5. choose `Self › Speed › Walk › Rate` entirely through completion;
6. author a compatible numeric modifier;
7. define Winged that extends Speed with Fly;
8. see Fly appear in the effective-shape preview and in contexts that require Winged;
9. receive clear diagnostics for an unavailable Fly path in contexts that do not guarantee it; and
10. publish only after the backend independently validates the same structure.

## 15. Deferred features

The following should not block recursive trait composition:

- wildcard modifier paths;
- arbitrary trait selectors;
- suppression and replacement authoring;
- conditional structural additions;
- multiple competing instances at one path;
- collection-valued trait mounts;
- automatic catalog reorganization;
- generalized inheritance;
- runtime mutation of published definitions; and
- AI inference of unresolved collision policies.

## 16. Decision summary

The accepted direction is:

- keep **trait** as the primary reusable abstraction;
- permit traits to add fields and other traits recursively without a fixed depth;
- use **adds** as the precise compositional verb;
- use **extends** as GM-friendly language for a nested add, initially compiled to `requires` plus `adds`;
- allow a high-level trait such as Creature to establish the foundational shape of a compendium entry;
- derive runtime paths from explicit named placement, not definition IDs or catalog organization;
- drive completions from the recursively expanded structure guaranteed by requirements and current draft additions;
- support exact, typed modifier targets such as `self.speed.walk.rate`;
- preserve provenance and reject ambiguous collisions;
- defer replacement, suppression, wildcard selection, and detailed local-modifier semantics until the recursive structural model is proven; and
- make the backend compiler, not the React editor, authoritative for published composition semantics.
