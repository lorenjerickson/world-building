# Recursive Trait Composition

| Attribute | Value |
| --- | --- |
| Status | Recursive composition Phases 0–6 are complete; `trait/2` migration and semantic diff are implemented; advanced modifier semantics remain |
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

## 4.1 Typed repeatable trait collections

A trait may declare a named, repeatable destination that accepts traits compatible with one or more base traits. This generalizes the acceptance behavior used by equipment slots without treating every repeated concept as equipment.

Example reusable die definitions:

```text
Die
└── sides: number

D4
├── requires Die
└── sets this.sides to 4

D10
├── requires Die
└── sets this.sides to 10
```

Dice Roll may then declare:

```text
Dice Roll
├── kind: enum
└── dice: trait collection accepting Die
```

An authored `3d10 + 4d4` roll becomes:

```text
Dice Roll adds 3 D10 to dice.
Dice Roll adds 4 D4 to dice.
```

The initial `trait/1` source encoding is:

```json
{
  "dataType": "trait-collection",
  "key": "dice",
  "acceptedTraits": ["trait:die"]
}
```

```json
{
  "dataType": "trait",
  "ref": "trait:d10",
  "into": "self.dice",
  "count": 3
}
```

`self` addresses the composed holder. `this` addresses the current trait mount, so a reusable nested trait can contribute to a collection relative to where it was added.

The effective-shape preview summarizes the authored contributions:

```text
self
└── dice: collection accepting Die
    ├── D10 ×3
    └── D4 ×4
```

It does not expand them into seven structural nodes. Evaluation may produce seven individual runtime die results, each retaining its die trait identity and contribution provenance.

Compatibility is defined through recursive prerequisite closure:

- a collection accepting Die accepts Die itself;
- it also accepts D4, D10, or another trait whose recursive requirements contain Die;
- `any` acceptance requires at least one listed base trait;
- `all` acceptance requires every listed base trait; and
- a contribution that does not satisfy the collection contract is invalid.

A counted contribution contains:

- referenced trait identity;
- positive whole-number count;
- destination collection path;
- source trait identity; and
- later, optional purpose, conditions, or other contribution metadata.

Count defaults to one. The first implementation supports literal positive integers; expression-based counts are deferred.

Typed trait collections and singular named additions have different collision behavior. Multiple compatible counted contributions may coexist in a collection. A singular addition may not silently replace a collection, and a counted contribution may not target a singular trait path.

Equipment slots may later share the same underlying typed-collection acceptance engine while retaining capacity and equipment-specific authoring language.

Dice mechanics also require a distinction between authored traits and runtime results:

```text
Die Roll Result
├── dieTrait
├── rawResult
├── effectiveResult
└── sourceContribution
```

This provenance supports later mechanics such as adding a D10 to a roll, replacing an original result of 1 with a D20 result, or increasing matching D4 results. Result replacement, reroll prevention, quantifiers such as `each` versus `one`, and evaluation-stage ordering remain part of the resolution/effect design rather than structural trait composition.

### 4.2 Runtime die-result effects

The first resolution integration preserves the reusable trait identity all the way through evaluation. A GM selects an available Die-derived trait such as D4, D10, or D20. The guided editor derives its sides from that trait's compiled `sets self.sides` contribution; the GM does not re-enter the side count.

The resolution source carries both `dieTraitId` and normalized `sides` so standalone previews remain deterministic. Publication cross-checks that normalized value against the compiled trait contract and rejects missing, non-Die, non-concrete, or mismatched selections. The duplicated number is compiler data, not a second authoring decision.

A check may contain several counted die selections:

```json
{
  "dice": [
    { "dieTraitId": "trait:d10", "count": 3, "sides": 10 },
    { "dieTraitId": "trait:d4", "count": 4, "sides": 4 }
  ],
  "rollKind": "damage"
}
```

A check may also bind those normalized selections to a complete Dice Roll trait:

```json
{
  "rollTraitId": "trait:heavy-damage-roll",
  "dice": [
    { "dieTraitId": "trait:d10", "count": 3, "sides": 10 },
    { "dieTraitId": "trait:d4", "count": 4, "sides": 4 }
  ],
  "rollKind": "damage"
}
```

The guided check editor offers only traits whose recursively expanded shape produces exactly one non-empty collection accepting Die. It displays the resolved notation, such as `3d10 + 4d4`, and stores that pool as a deterministic snapshot. Publication recompiles the selected roll trait and rejects the release if the snapshot has missing dice, extra dice, or changed counts. The check therefore references the reusable concept while remaining independently previewable.

Original runtime results record the selected `rollTraitId` as their roll source. Added and replacement dice instead retain their modifier source, preventing later effects from being misreported as part of the original Dice Roll contract.

Each evaluated die becomes an individual result with:

- stable result ID;
- die trait ID and compiled sides;
- raw and effective values;
- purpose (`hit`, `damage`, `saving`, or `other`);
- origin (`original`, `added`, or `replacement`);
- contributing definition;
- replacement links;
- active/inactive state; and
- applied modifier IDs.

Roll-result modifiers execute by integer priority and then stable definition ID. Their initial operations are:

- `add-dice` — add a designated count of one reusable die trait;
- `replace-result` — replace matching active results, optionally with a maximum application count; and
- `increase-result` — add a value to each matching active die result.

Selectors may constrain die trait, purpose, raw result, and origin. Replacements retain the inactive original and link it to the active replacement, so a result is explainable rather than overwritten.

Purposes are separate subtotal channels. This makes the intended examples precise:

```text
Brutal adds 1 D10 damage to the Attack Roll.
Blessed replaces one original D20 result of 1 with a new D20 result.
Empowered increases each D4 result by 2.
```

Brutal's D10 appears in the attack's `damage` subtotal but does not increase the target-number `hit` total. Blessed consumes new entropy and retains both the original 1 and its replacement. Empowered retains the raw D4 result while changing its effective result.

The guided modifier editor exposes these three operations and only offers concrete Die-derived traits found in the current rule set. The check editor can choose either a counted die directly or one of the actually available complete Dice Roll traits. Advanced sources are still validated by the backend and again at publication.

### 4.3 Semantic modifier targeting

Modifiers are reusable rule concepts, so they must not always be coupled to one check definition. A modifier now chooses one explicit roll scope:

- one specific check;
- every roll with one purpose (`hit`, `damage`, `saving`, or `other`);
- every check using one complete Dice Roll trait; or
- all rolls.

The canonical semantic target is `appliesTo`:

```json
{ "rollKinds": ["hit"] }
```

```json
{ "rollTraitIds": ["trait:heavy-damage-roll"] }
```

```json
{ "allRolls": true }
```

Legacy `targetCheckId` remains readable and means one exact check. A modifier may use either `targetCheckId` or `appliesTo`, never both. `allRolls` is explicit and cannot be combined with narrower roll targets. Empty or implicit targeting is invalid.

When semantic target lists are combined in an advanced source, they are conjunctive: the current check must satisfy every populated list. Result selectors then narrow the active dice within that matching check.

The motivating rules therefore read and compile as:

```text
Brutal applies to hit rolls and adds 1 D10 to the damage subtotal.
Blessed applies to hit rolls and replaces one original D20 result of 1 with a D20 result.
Empowered applies to all rolls and increases each matching D4 result by 2.
```

The guided editor obtains specific-check and Dice Roll trait choices from actual definitions in the current rule set. Publication verifies referenced roll traits against their compiled non-empty Die collections.

### 4.4 Trait and effect activation

Applicability and activation are separate questions:

```text
Is Brutal active for this actor?
If active, does it apply to this roll?
If applicable, which results does it change?
```

A modifier may declare `activatedByTraitIds`. It becomes active when the resolution context reports any of those traits on the acting entity. The guided editor offers actual traits from the current rule set, and publication rejects missing trait references.

Effects already declare `modifierIds`. A context's active effects contribute those modifiers automatically. Applying an effect to the actor during an operation also activates its modifiers for later steps in that same bounded preview. Effects applied to an external target are recorded as intents but do not alter the acting entity's subsequent checks.

`activeModifierIds` remains a backward-compatible explicit override for integrations that have already resolved activation elsewhere. It is no longer required for ordinary trait- and effect-driven rules.

Preview output records activation provenance for every modifier that actually changes a roll:

```json
{
  "modifierId": "modifier:brutal",
  "sources": [
    { "kind": "trait", "id": "trait:brutal" }
  ]
}
```

The same modifier may have multiple activation sources. Sources are deduplicated and remain distinct from applicability and per-die selection, keeping the explanation reversible.

### 4.5 Runtime expansion from high-level traits

Runtime callers provide the entity's selected high-level traits as `activeTraitIds`. They do not flatten every recursively required or added trait themselves.

The compiled trait artifact now includes deterministic activation edges:

```text
All Features adds Brutal.
All Features adds Empowered.
D10 requires Die.
Dice Roll adds D10 to dice.
```

Before resolving modifier activation, the evaluator walks those edges from each active root. The resulting active-trait set records one bounded path per root and trait:

```json
{
  "traitId": "trait:brutal",
  "roots": [
    {
      "rootTraitId": "trait:all-features",
      "traitChain": ["trait:all-features", "trait:brutal"]
    }
  ]
}
```

The graph contains:

- every unconditional trait addition, including named, nested, and counted collection contributions;
- every `all` prerequisite;
- a sole `any` prerequisite when there is only one choice.

For multiple `any` prerequisites, the artifact stores a choice contract instead of activating every alternative:

```json
{
  "traitId": "trait:adaptive-training",
  "optionTraitIds": ["trait:brutal", "trait:empowered"]
}
```

An entity instance resolves that contract without promoting the choice to a top-level trait:

```json
{
  "activeTraitIds": ["trait:adaptive-training"],
  "traitPrerequisiteSelections": {
    "trait:adaptive-training": ["trait:brutal"]
  }
}
```

One or more allowed alternatives may be selected because `any` means at least one, not exactly one. Empty selections, unknown options, selections for inactive owners, and missing selections are runtime contract errors. For compatibility, an allowed option already supplied as an active root resolves the choice automatically and is reported with source `active-roots`.

The resolved choice is returned in preview output and the selected alternative is appended to the trait activation chain. This preserves the same guaranteed-contract rule used by completion while making the entity's actual choice explicit.

When a compiled trait artifact is supplied, unknown active roots are rejected. Standalone resolution-only previews retain compatibility by treating supplied trait IDs as already expanded leaves. Mixed authoring previews compile both metamodels and exercise the same expansion used by a published release.

Modifier activation provenance includes the activating leaf, root trait, and full trait chain. This makes an explanation such as “Brutal applied because All Features adds Brutal” available without reconstructing source definitions at runtime.

### 4.6 Mounted trait instances

A trait ID identifies a reusable definition. An instance ID identifies one mounted copy of that definition on a particular entity or composed value. Runtime contexts may therefore name roots explicitly:

```json
{
  "activeTraitInstances": [
    { "instanceId": "training:left", "traitId": "trait:adaptive-training" },
    { "instanceId": "training:right", "traitId": "trait:adaptive-training" }
  ],
  "traitInstancePrerequisiteSelections": {
    "training:left": ["trait:brutal"],
    "training:right": ["trait:empowered"]
  }
}
```

The two copies share one contract but resolve independently. A trait-ID-keyed selection remains valid when only one active instance owns that choice; it is rejected as ambiguous when multiple instances do.

Required, added, and selected child traits receive deterministic instance IDs derived from their parent instance and mount relationship. Counted collection additions retain their count in the compiled activation edge, so `Dice Roll adds 3 D10 to dice` materializes three D10 instances with ordinals 1 through 3. These IDs are stable, opaque runtime addresses; callers should consume them from preview or materialization output rather than reproduce their encoding.

Each active instance reports its definition ID, root and parent instance, relation, mount path, optional ordinal, trait and instance chains, and its own value bag. Root values may be supplied inline; generated-child values may be supplied through `traitInstanceValues` keyed by the returned instance ID. This establishes independent storage for two copies of the same trait; the following section defines its validation and expression semantics.

`activeTraitIds` remains shorthand for one synthetic root instance per unique trait ID. Existing callers therefore keep their behavior, while instance-aware authoring can represent repeated equipment, dice, movements, or other reusable concepts without collapsing identity.

### 4.7 Typed instance values and expressions

An instance value bag contains fields declared directly at that trait mount. For example, two Walk instances may each own a different `rate`:

```json
{
  "activeTraitInstances": [
    { "instanceId": "movement:left", "traitId": "trait:walk", "values": { "rate": 2 } },
    { "instanceId": "movement:right", "traitId": "trait:walk", "values": { "rate": 7 } }
  ]
}
```

The evaluator validates each supplied key against the compiled trait contract. Numeric, Boolean, text, and enum values must match their terminal types and enum constraints. A parent instance cannot duplicate a child's storage with a dotted key such as `walk.rate`; the mounted Walk instance owns `rate`.

Mechanics address one mounted value explicitly:

```json
{
  "op": "trait-instance-field",
  "instanceId": "movement:right",
  "key": "rate"
}
```

Missing instances, missing values, unknown fields, type mismatches, and invalid enum members fail with precise runtime errors. The resolution compiler also validates the expression structure and requires one direct field key.

Local trait modifiers materialize effective values on the same instance. In particular, D10's `sets self.sides to 10` produces `{ "sides": 10 }` without asking the GM to enter it. Numeric modifiers require a numeric base value.

### 4.8 Cross-mount value modifiers

Every active trait instance has a canonical `mountPath` relative to its root composition. Requirements and selected prerequisites share their parent's mount. An added trait advances the path according to its authored `self` or `this` destination.

Given:

```text
Boots of Striding requires Creature.
Boots of Striding increases self.speed.walk.rate by 5.
```

the evaluator resolves `speed.walk` to the exact mounted Walk instance, reads its direct `rate`, and writes the effective value before resolution expressions run. A modifier anchored at `this` begins from the contributing instance's mount instead. Thus a Speed trait mounted at `speed` can modify `this.walk.rate` and reach the same Walk without knowing its holder's complete path.

Each applied value modifier records:

- source trait and instance IDs;
- `self` or `this` anchor;
- authored field path and operation;
- modifier amount;
- value before application; and
- effective value afterward.

Sources and their modifiers use deterministic ordering so stacking is reproducible. Exact-path resolution prefers the instance that owns the terminal field. No match, a missing numeric base, division by zero, or more than one equally valid mounted target is an evaluation error. Repeated collections require the explicit selector described below rather than silently applying an exact modifier to every element.

### 4.9 Explicit repeated-mount selectors

A `[]` segment marks a repeated collection mount. It must be paired with an explicit selector:

```json
{
  "dataType": "modifier",
  "operation": "increases",
  "field": "self.dice[].sides",
  "amount": 2,
  "mountSelector": { "mode": "all" }
}
```

or:

```json
{
  "dataType": "modifier",
  "operation": "increases",
  "field": "self.dice[].sides",
  "amount": 3,
  "mountSelector": { "mode": "ordinal", "ordinal": 2 }
}
```

`all` applies independently to every actual collection entry. `ordinal` selects the one-based contribution ordinal. A repeated path without a selector is invalid, and a selector on an ordinary exact path is invalid.

The compiler resolves the field after `[]` through the collection's accepted base-trait contract. Thus a collection accepting Die offers `sides` even when its concrete entries are D4 and D10. The first implementation intentionally supports one repeated segment followed by one direct field; nested collection-element paths can be added after their selection and provenance rules are proven.

Runtime selection considers only counted instances mounted into that collection. Prerequisite traits that share an entry's mount do not become additional selected entries. Local modifiers materialize first, followed by cross-mount modifiers in deterministic order. For example, three D10 instances can become 12, 15, and 12 after “all sides +2” and “entry #2 sides +3,” with each target retaining its own before/after trace.

Guided modifier authoring exposes collection entries as actual path completions, then requires the GM to choose “all entries” or “entry number.” The generated source preserves the explicit selector rather than inferring fan-out from runtime cardinality.

### 4.10 Path-addressed resolution expressions

Rules normally care about a value's place in the composed contract, not the opaque instance ID generated while that contract is materialized. A resolution expression can therefore read an exact mounted field directly:

```json
{
  "op": "trait-path-field",
  "path": "self.speed.walk.rate"
}
```

The evaluator resolves this after local and cross-mount value modifiers have produced effective values. The path must identify exactly one mounted instance that owns the terminal field. No match and multiple matches are evaluation errors; an exact path never silently chooses one of several roots or repeated contributions.

A repeated collection path requires a one-based ordinal:

```json
{
  "op": "trait-path-field",
  "path": "self.dice[].sides",
  "mountSelector": { "mode": "ordinal", "ordinal": 2 }
}
```

Unlike a modifier, a scalar expression cannot use an `all` selector because its result must be one value. The initial form supports at most one `[]` segment followed by one direct terminal field. `trait-instance-field` remains available when a mechanic intentionally refers to a specific named runtime instance rather than its structural role.

Guided resolution authoring derives its path choices from terminal fields that actually exist in the compiled trait definitions. One reusable scalar-expression control is used for check bonuses and targets, total and die-result modifier values, both sides of operation validations, resource-consumption amounts, optional event payload values, and optional return data. The control offers fixed numbers, actor and target fields, operation inputs, previous results where meaningful, named trait instances, exact composed paths, and collection-base fields. It asks for an entry number when necessary and does not suggest speculative fields merely because another catalog trait defines a similarly named property. Existing guided drafts that stored a simple number, field key, or result key are interpreted as the equivalent expression and round-trip without losing the authored canonical form.

Checks, modifiers, and operations may declare `subjectTraitIds`: the traits that `self` is guaranteed to have when that rule runs. Guided authoring describes this as “What is this rule acting as?” and expands only the recursive effective shape guaranteed by the selected roots. Multiple roots compose in `all` mode, so completion includes their combined contract while `any` prerequisites contribute only paths common to every valid alternative. A selected context with an invalid or conflicting shape shows diagnostics and offers no unrelated fallback paths.

This context is semantic, not presentation metadata. The resolution compiler validates stable trait IDs. Release publication verifies that every referenced trait exists and that every authored `trait-path-field` expression belongs to the guaranteed effective shape. Runtime checks the expanded active trait instances before executing the affected operation, check, or active modifier. The declaration does not silently grant traits; callers must supply an actor whose active contract satisfies the rule. Definitions created before this field existed retain broad catalog completion for compatibility and clearly identify that they are unscoped until the GM selects a self contract.

Operation contracts compose through their check steps. The compiler derives each operation's effective contract as:

```text
direct operation subject traits
+ subject traits from every reachable referenced check
= effective operation subject traits
```

The compiled resolution artifact records direct traits, inherited traits, the deduplicated effective set, and the contributing check IDs. Only checks reachable from the operation's start step contribute; an abandoned draft branch does not expand the contract. Guided operation authoring displays inherited requirements separately, uses the effective set for path completion, and supplies that set to sample previews. Runtime enforces the effective set at operation entry, so a validation or resource step before the check can safely use an inherited path. Release path validation uses the same derived contract. The operation body stores only its direct traits; inherited requirements remain attributable to their checks and update automatically when the pipeline or check contract changes.

Modifiers do not propagate into an operation contract merely because they could target one of its checks. Modifier activation and applicability are conditional runtime facts. Each active applicable modifier therefore retains and enforces its own subject contract only when evaluated.

Completion options carry derived provenance. For every available path, the authoring resolver records:

- the selected root trait that guarantees the path;
- the ordered trait chain that owns its branches and terminal field;
- whether the root comes from the rule's direct self contract, a reachable check inherited by an operation, or the legacy catalog fallback; and
- the contributing check IDs for inherited roots.

The picker includes a compact provenance summary in each option and shows a complete “Why available” explanation after selection. For example:

```text
self.speed.walk.rate — number
direct self contract: Creature → Speed → Walk
```

or:

```text
self.speed.walk.rate — number
inherited from check:movement: Creature → Speed → Walk
```

Collection completions include the accepted base trait that owns the terminal field, so `self.dice[].sides` explains `Dice Roll → Die` even when concrete entries are D4 and D10. When multiple roots guarantee the same compatible path, their explanations are merged rather than choosing one arbitrarily.

This provenance is deliberately derived instead of persisted in the expression. Canonical rules continue to store the stable path and selector only. Renaming a trait, changing a check contract, or rewiring an operation therefore refreshes the explanation without leaving stale descriptive metadata in published mechanics.

An existing expression can become unavailable when its self contract changes. Guided authoring treats that as a repairable contract mismatch rather than replacing or clearing the saved path. For the selected unavailable path, it:

1. searches catalog trait shapes that actually guarantee the same complete path;
2. excludes roots already present in the effective contract;
3. tentatively composes each candidate with the current direct and inherited roots;
4. rejects candidates that introduce a shape diagnostic or still fail to expose the path; and
5. offers “Add _Trait_ to self contract” only for the remaining safe candidates.

Choosing a repair adds the root to the rule's direct `subjectTraitIds`; inherited check contracts are never mutated indirectly. The expression itself remains unchanged and becomes available again as soon as the recomputed contract guarantees it.

If catalog traits define the path but none can compose safely, the editor reports a composition conflict and offers no button. If no catalog trait guarantees the path, it says so explicitly. This distinction prevents a missing definition, an optional/conditional path, and an incompatible self contract from collapsing into the same vague “unavailable” state.

Multiple `any` prerequisites remain optional by default, so only fields common to every alternative are guaranteed. Checks, modifiers, and operations may now narrow that contract with `subjectTraitSelections`:

```json
{
  "subjectTraitIds": ["trait:adaptive-training"],
  "subjectTraitSelections": {
    "trait:adaptive-training": ["trait:brutal"]
  }
}
```

Guided authoring exposes the alternatives beneath “What is this rule acting as?” and diagnoses a saved branch-only path separately from a missing path. Its repair action says, for example, “Require Adaptive Training → Brutal.” Selecting it restores Brutal-only completions without adding Brutal as an unrelated root trait.

The selection is part of the executable contract. The resolution compiler validates its stable-ID shape; release compilation verifies that the owner is reachable from the effective subject, uses `any` prerequisites, and permits every selected alternative. The selected branch participates in release path validation. Runtime then requires the expanded entity choice to contain the declared alternative. Operation contracts inherit both trait roots and branch selections from reachable checks, and sample previews supply the effective selections.

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

For legacy `trait/1` definitions, the `key` on a trait grant is interpreted as a local placement name. Canonical `trait/2` makes that placement explicit with `at: "this.<key>"`.

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

## 10. Canonical model

`trait/2` is the canonical authored source. It retains the proven `grants` vocabulary while removing implicit trait placement:

```json
{
  "metamodelVersion": "trait/2",
  "prerequisites": {
    "mode": "all",
    "ids": ["trait:creature"]
  },
  "grants": [
    {
      "dataType": "trait",
      "ref": "trait:walk",
      "at": "this.walk"
    },
    {
      "dataType": "trait",
      "ref": "trait:fly",
      "at": "self.speed.fly"
    }
  ]
}
```

Every `trait/2` trait addition must use `at` or `into`. Prerequisites must use the explicit `{ mode, ids }` representation. Fields, collections, modifiers, slots, and slot affinities retain their established grant forms. New grants-editor definitions emit `trait/2`; existing `trait/1` definitions remain editable as `trait/1` until explicitly migrated.

Existing `trait/1` trait grants can be interpreted as:

```text
{ dataType: "trait", ref: X, key: K }
→ add X at this.K
```

The migration applies exactly that normalization. Relative legacy `at` and `into` destinations gain an explicit `this` root. Legacy prerequisite arrays become `{ "mode": "all", "ids": [...] }`, preserving their established interpretation. Blank placement keys are errors; the migration never derives a path from a display label.

Both source versions compile through the same resolver into the canonical `trait-composition-artifact/1` contract, whose `metamodelVersion` is `trait/2`. Mixed `trait/1` and `trait/2` catalogs remain publishable during migration.

The GM-facing migration flow first previews the canonical source and compares every effective path and node meaning before and after conversion. Applying it:

1. rechecks the source revision;
2. captures the full `trait/1` source in definition history;
3. updates the authored draft to `trait/2` while preserving its definition ID and stable external trait ID; and
4. leaves every immutable published release unchanged.

The preview and apply endpoints are:

```text
POST /api/rule-sets/:ruleSetId/definitions/:definitionId/migration/preview
POST /api/rule-sets/:ruleSetId/definitions/:definitionId/migration
```

The apply request requires `expectedUpdatedAt`, so a migration cannot overwrite a newer draft.

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

The grants authoring implementation is concentrated in:

- `apps/frontend/components/guided-trait-grants-editor.tsx`;
- `apps/frontend/components/rule-set-child-create-forms.tsx`; and
- the rule definition resource types under `apps/frontend/lib`.

Before this work, the relevant behavior was:

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

The frontend now includes a framework-independent recursive resolver and guided authoring support that:

- expands named traits and their prerequisites to arbitrary depth within explicit budgets;
- drives modifier completion from paths that actually exist in the effective shape;
- distinguishes trait branches, terminal fields, and typed repeatable trait collections;
- validates collection compatibility through recursive prerequisite closure;
- accepts positive whole-number contributions into inherited or locally declared collections;
- authors nested additions using `extends` language and an explicit destination path;
- reports cycles, missing references, path conflicts, invalid destinations, type mismatches, and invalid counts; and
- previews effective structure, collection contents, and source provenance.

The resolver now lives in the shared framework-free package used by both Next.js and NestJS. NestJS wraps it with the versioned `trait-composition-artifact/1` compiler, validates exact modifier targets and amounts, and rejects invalid `trait/1` create, update, import, and snapshot-restore operations before persistence.

Release publication persists the compiled trait artifact inside a canonical immutable `rule-release/1` manifest. The release also contains the exact source snapshot, dependency lock, engine-compatibility declaration, validation summary, compiler version, and SHA-256 content hash. Publication re-reads the catalog after compilation and aborts if a module or definition changed during the operation.

There is also a broader metamodel split:

- guided creature-capability definitions use closed semantic contracts such as `movement.walk.rate` and `perception.visual.maximumRange`;
- the general grants editor emits an open-ended `trait/2` graph while the compiler retains `trait/1` compatibility.

The implementation should reconcile these approaches around typed recursive paths rather than allowing browser-only grants semantics and backend capability semantics to drift independently.

## 13. Implementation plan

Current implementation snapshot:

- Phases 0–6 are implemented, including recursive paths, preview, nested additions, shared compilation, publication validation, runtime trait instances, counted reusable traits, resolution path authoring, and non-destructive `trait/1` → `trait/2` migration.
- Phase 7 is partially implemented: exact local/cross-mount modifiers, deterministic stacking, repeated ordinals, provenance, and ambiguity rejection are complete; units, suppression, replacement, and broader selectors remain.

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

Implementation status: complete. The shared resolver, deterministic compiler, source hash, diagnostics, authoring validation endpoint, catalog mutation gates, immutable release artifact, publication API, concurrency check, and GM-facing publish flow are implemented.

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

Implementation status: complete. The compiler reads mixed `trait/1` and `trait/2` catalogs, new guided grants emit explicit `trait/2` placements, migration previews canonical source and effective-path changes, apply preserves stable identity and snapshots the old source, and published releases remain immutable.

1. Read existing `trait/1` local trait grants as additions at `this.<key>`.
2. Provide an explicit `trait/1` to `trait/2` source migration.
3. Preserve stable trait references and placement keys.
4. Diagnose missing or blank keys rather than inventing unstable placement from display names.
5. Produce a semantic diff showing path changes before a rule-set release is upgraded.
6. Keep published releases immutable; migration creates a new draft or release.
7. Add round-trip tests for old source, migrated source, and compiled shape.

Deliverable: existing authored traits remain understandable and can be upgraded without silent path changes.

### Phase 7: Modifier composition follow-up

Implementation status: exact local and cross-mount value modifiers, `self`/`this` anchoring, deterministic stacking, before/after provenance, and ambiguity rejection are implemented. Remaining work:

1. Add unit-aware modifier validation.
2. Design suppression and replacement as deterministic, attributable operations.
3. Extend repeated selection beyond one direct collection-element field when a concrete use case requires it.
4. Consider broader trait or wildcard selectors only after exact-path behavior is proven.

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
- mutation of mounted instance collections during an operation;
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
