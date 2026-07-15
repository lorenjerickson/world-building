# Rule Data Authoring Strategy

## 1. Purpose

This document defines how a Game Master authors gameplay mechanics without writing JSON or code, while still producing rules that the server can validate, compile, evaluate, explain, migrate, and execute deterministically.

It complements [`rule-systems-design-doc.md`](./rule-systems-design-doc.md). That document defines the broader rule-set architecture; this document focuses on the authoring language and the path from GM intent to executable behavior.

The central design decision is:

> The GM edits a typed semantic model through guided prose, direct-manipulation builders, and focused forms. Natural language and UI layout are authoring views. A schema-versioned declarative rule document is canonical source. An immutable compiled artifact—not mutable CMS JSON—is what the runtime evaluates.

This distinction lets the UI feel approachable without making natural-language interpretation or arbitrary JSON part of authoritative gameplay.

## 2. Status and product decisions

This is a strategy proposal for review, not a locked implementation contract. The following decisions have been accepted for the initial direction:

- the first milestone uses a deliberately contained **creature capability domain**, then expands into more complex scenarios;
- incomplete or invalid rules may be saved as drafts with diagnostics, but cannot be published or executed;
- the primary UI is type-specific: simple traits and derived capabilities begin as semantic sentences with focused property forms, while complex multi-step behavior may graduate to a canvas;
- AI produces reviewable proposals and questions, never authoritative direct writes;
- rules are activated through immutable releases and compositions;
- active play does not parse mutable Payload documents or synchronously depend on Payload CMS; and
- JSON remains an internal serialization and advanced diagnostic view, not the primary GM interface.

### 2.1 Initial creature capability domain

The first domain should prove that a GM can define reusable creature properties in familiar language and that the runtime can evaluate their consequences. It includes:

- creature fields and trait parameters;
- Boolean, enum, integer, decimal, and distance values;
- explicit units;
- derived arithmetic values with explicit rounding;
- trait-held capabilities;
- movement rates derived from other movement rates;
- perception range, channel, lighting, and simple occlusion conditions;
- stable references between traits, fields, parameters, and capabilities;
- applicability predicates over the trait holder and environment; and
- examples, diagnostics, compilation, and deterministic capability evaluation.

Representative rules are Strength Score, Strength Modifier, Legged, Walking Speed, Running Speed, Vision, and Hearing.

The initial domain explicitly defers attack resolution, dice checks, action economies, resource reservation, timed effects, reactions, initiative, inventory mutation, spatial pathfinding, and general event pipelines. Those later features must extend the same metamodel rather than replace the first-domain concepts.

## 3. Goals

- A GM can express common mechanics in language familiar to tabletop games.
- The same rule can be authored through guided conversation, visual builders, or focused forms without semantic drift.
- Every persisted reference uses a stable definition ID even when labels are renamed.
- The authoring system prevents structurally invalid rules and explains semantic problems in GM-facing language.
- The compiler can prove types, references, determinism constraints, and execution budgets before publication.
- The evaluator receives a small, normalized, immutable representation rather than UI-specific data.
- A GM can preview examples and inspect why a rule produced a result.
- Templates reduce repetition without introducing implicit runtime inheritance.
- The model supports original gameplay concepts rather than hard-coding one RPG ontology.

## 4. Non-goals

- Executing prose directly with an LLM during gameplay.
- Allowing user-authored JavaScript, TypeScript, SQL, or network calls.
- Treating arbitrary JSON as valid merely because it parses.
- Rebuilding a general-purpose programming language in the first release.
- Encoding UI component state into the executable rule artifact.
- Recompiling an active campaign whenever a draft changes.
- Making AI availability a prerequisite for editing or playing.

## 5. Correct lifecycle: intent to execution

Authored rule sets may change at any time, but active gameplay must not change underneath a session. Changes therefore move through an explicit lifecycle:

```text
GM intent
  → guided authoring view
  → typed draft commands
  → canonical source definitions
  → validation and test fixtures
  → immutable rule-set release
  → composition and dependency lock
  → compiler
  → immutable executable artifact
  → authoritative runtime evaluator
  → trace, events, and state changes
```

Drafts are dynamic. Releases are immutable. A world or campaign binds to an exact compiled composition. Updating a draft has no runtime effect until the GM validates, publishes, previews migration impact, and activates the new release or composition.

## 6. One metamodel, several authoring modes

The platform should define one application-owned rule metamodel. It is the source for:

- canonical source schemas;
- form descriptors and visual-builder constraints;
- AI tool schemas and missing-information questions;
- compiler parsing and static validation;
- reference-picker filtering;
- documentation and examples;
- semantic diffs and migration analysis; and
- test-fixture input and expected-result schemas.

The browser must not independently invent schemas from Payload fields. Payload stores versioned authored content; NestJS and framework-independent compiler packages own rule semantics.

The three authoring modes are synchronized views of the same draft:

1. **Guided conversation** helps classify intent, identify missing semantics, and prepare a proposal.
2. **Semantic builders and forms** are the primary direct-editing experience.
3. **Canonical source view** is an advanced diagnostic and interoperability view, not a requirement for ordinary GM work.

A change made in one mode must immediately be understandable and editable in the others.

## 7. Recommended UI: rule sentences first, complexity on demand

No single editor is ideal for every rule shape. The recommended experience begins with the smallest readable representation that can express the rule, then reveals more structure only when needed.

### 7.1 Controlled semantic rule sentences

The GM may begin with natural language, but the editable result is a controlled semantic sentence. The sentence looks like prose while its important phrases are typed slots.

For Vision, the first editing surface should be close to the GM's own phrasing:

```text
[Vision] allows [the creature holding this trait] to [see]
up to [a configurable distance] in [normal daytime lighting].
```

The highlighted phrases are editable semantic slots:

- `[Vision]` is the definition identity;
- `[the creature holding this trait]` is the subject scope `self`;
- `[see]` selects the platform's typed visual-perception capability;
- `[a configurable distance]` creates or selects a distance parameter with a unit, allowed range, and default; and
- `[normal daytime lighting]` selects a stable environmental-lighting predicate.

For Running:

```text
[Running] allows [the creature holding this trait] to [move]
at [2] times [its Walking Speed].
```

This is stored as a derived movement capability, not as executable prose. The multiplier is numeric, and Walking Speed is a typed movement-rate reference whose exact unit is selected by the domain's unit policy. If a later rules domain introduces a `Run` action with action costs or state changes, that operation consumes the already-defined Running capability rather than forcing the simple trait to describe an action economy prematurely.

This distinction keeps simple rules simple:

- **capability definitions** answer questions such as “how far can this creature see?” or “what is its running speed?”;
- **operations**, introduced in a later domain, answer “may the creature perform Run now, what does it cost, and which state changes occur?”

### 7.2 Parse, highlight, and confirm

When the GM types a free sentence, the assistant or deterministic phrase recognizer proposes a semantic frame and highlights recognized concepts. It does not save immediately.

For Vision, the system might respond:

```text
I understand this as a parameterized visual-perception trait.

[Vision] lets [its holder] perceive [visible entities]
within [Distance] when [Lighting is Normal Daytime].

Suggested details
  Distance: configurable in meters; default not yet specified
  Line of sight: required (suggested)
  Opaque barriers: block vision (suggested)
```

The GM can accept safe structural suggestions, edit any highlighted phrase, or answer only the missing consequential values. Suggested defaults remain visibly marked until accepted.

The parser must distinguish:

- text that became a typed semantic slot;
- descriptive text retained as documentation;
- assumptions proposed by the system; and
- unrecognized or ambiguous text that still needs resolution.

The sentence is considered complete enough to save as a draft when every required semantic slot is either resolved or explicitly marked incomplete. It is publishable only after all required slots and validation gates pass.

### 7.3 Focused property inspector

Selecting a phrase opens a small inspector rather than a large universal form. For `[a configurable distance]`, the inspector asks:

- parameter name and label;
- unit;
- minimum, maximum, and default;
- whether the value is fixed by the trait definition or selected when the trait is applied; and
- whether modifiers may alter the effective value.

The surrounding sentence updates immediately. A complete structured form remains available for scanning and accessibility, but ordinary edits should not require navigating a deeply nested schema.

### 7.4 Focused forms for declarative definitions

Fields, traits, parameters, and simple capability contributions also work well as conventional forms with progressive disclosure. A trait form may contain identity, applicable entity types, parameters, contributed capabilities, conditions, generation influence, presentation, and examples.

The form uses typed controls: number inputs with units, enum selectors, definition pickers, toggle groups, bounded lists, and expression controls. It never exposes an unlabelled JSON textarea as the normal editing path.

### 7.5 Canvas builders only for genuinely multi-step behavior

The system should not turn a one-sentence trait into a flowchart. A canvas becomes useful only when behavior contains multiple ordered calculations, branches, costs, state mutations, outcomes, or events.

A later Melee Attack operation could expand to:

```text
Available when [attacker] has [equipped weapon: Melee]
Roll [1d20] + [Strength Modifier] + [Weapon Accuracy]
Succeed when [roll total] is at least [target Defense]
On success [apply Weapon Damage] and [emit Attack Hit]
On failure [emit Attack Miss]
```

Only after branches or dependencies become difficult to read linearly should the editor offer a graph view. The sentence remains the summary and primary review surface.

### 7.6 Plain-language preview

Every editor should generate a non-authoritative explanation from canonical source:

> A creature may make a Melee Attack when it has an equipped melee weapon. Roll a twenty-sided die, add the attacker's Strength Modifier and the weapon's Accuracy Modifier, and compare the total with the target's Defense. On success, deal the weapon's Damage Roll.

The preview is generated from typed data, not stored as executable prose. It helps the GM spot errors and lets the AI discuss the same semantics.

### 7.7 Progressive disclosure

The default view shows the rule's common path. Advanced sections reveal:

- alternate outcomes;
- effect stacking and duration;
- hidden-information behavior;
- rounding and numeric precision;
- optimistic-rendering eligibility;
- generation contributions;
- migration behavior; and
- canonical source and compiler diagnostics.

The interface should not require a new GM to understand the complete evaluator to define a simple field or trait.

### 7.8 Worked authoring flow: Vision

The GM enters:

> Vision allows the creature holding this trait to see to some specified distance in normal daytime lighting.

The system should recognize:

| Phrase | Proposed semantic meaning |
|---|---|
| Vision | New trait definition |
| creature holding this trait | Trait holder (`self`) |
| see | Visual-perception capability |
| specified distance | Trait-application distance parameter |
| normal daytime lighting | Environmental applicability predicate |

It should not ask the GM to choose a JSON shape or expression operator. It should render:

```text
[Vision] allows [its holder] to [see visible entities]
up to [Vision Distance] in [Normal Daytime] lighting.
```

The unresolved `[Vision Distance]` phrase opens an inline choice:

```text
Who chooses this distance?
  ● The trait application supplies it
  ○ This definition uses one fixed distance

Unit: [meters]
Allowed range: [0] to [unbounded]
Suggested default: [60]
```

The system may visibly suggest conventional structural behavior—require line of sight and block on opaque barriers—but must not silently add it. Those choices materially affect gameplay and require confirmation unless a selected template already declares them.

Saving produces one trait with a distance parameter and one visual-perception capability contribution. The compiler resolves the environmental predicate and emits a typed capability query that the runtime can evaluate for a holder, target, and authorized environment.

### 7.9 Worked authoring flow: Running

The GM enters:

> Running allows the creature holding this trait to move at twice their walking speed.

The system should render:

```text
[Running] allows [its holder] to [move by running]
at [2] times [its Walking Speed].
```

The system recognizes `2 × Walking Speed` as a typed derived movement rate. If exactly one compatible Walking Speed is in scope, it may select it and show the selection. If several are available, the GM chooses the reference. If none exists, the editor offers to create one or leaves the draft incomplete.

The initial creature-capability domain saves this as a `Running` trait contribution that answers “what is this creature's running movement rate?” It does not force the GM to define action cost, turn timing, path selection, collision, or position mutation.

When the operation domain is added later, a `Run` operation can require the running capability and use its effective rate. The authoring UI may then offer:

```text
Turn this capability into an action?
  Run allows [its holder] to move up to [effective Running Speed].
```

This layered approach preserves the ease of the original sentence while giving later execution mechanics an explicit place to live.

## 8. Public authoring vocabulary

The complete platform will need the vocabulary below, but the first creature-capability milestone exposes only fields, derived values, traits, capability contributions, parameters, and simple conditions. New definition types and capability contracts are added by platform code and metamodel migrations; a rule set composes these primitives into original gameplay.

### 8.1 Field

A typed value that may exist on an entity or rule instance.

Important properties include value type, unit, allowed range, default, visibility, mutability, persistence, and applicable entity types.

Examples: Strength Score, Defense, Current Health, Carry Capacity, Vision Range.

### 8.2 Derived value

A read-only field calculated from other authorized values and active modifiers.

Examples: Strength Modifier, Running Speed, Total Defense.

### 8.3 Trait

A reusable capability or classification that contributes fields, operations, effects, constraints, generation capabilities, or presentation.

Examples: Legged, Vision, Hearing, Undead, Magical.

Traits may be parameterized. Applying `Vision` can select darkvision with a range of 30 meters without cloning the definition.

### 8.4 Capability contribution

A typed fact contributed by a trait and evaluated for its holder. A capability has a platform-defined contract, typed values, and optional conditions.

Initial capability families include:

- visual perception with range, lighting predicate, and occlusion behavior;
- audio perception with range, threshold, and attenuation behavior;
- walking movement rate; and
- running movement rate derived from walking movement rate.

The contract is generic enough to be composed differently by rule sets but closed enough for the evaluator to understand. Rule content may create original traits and values; it may not invent an executable verb whose meaning exists only in prose.

### 8.5 Modifier

A conditional contribution to a selected value or check. It declares a target selector, value expression, stacking identity, priority, and duration or scope.

Examples: +2 to melee attack checks; halve walking speed while one leg is impaired.

### 8.6 Check

A reusable resolution pattern that produces a typed result such as success, degree of success, or opposed winner.

Examples: roll-over target, roll-under attribute, contested Strength check.

### 8.7 Operation

An authorized unit of behavior with inputs, targets, availability, costs, a bounded resolution pipeline, results, events, and presentation cues.

Examples: Walk, Run, Melee Attack, Cast Spell, Pick Lock.

### 8.8 Effect

A bounded state contribution applied by an operation or event. It defines duration, stacking, modifiers, lifecycle hooks, visibility, and removal conditions.

Examples: Poisoned, Prone, Inspired, Leg Injured.

### 8.9 Resource

A typed quantity with bounds and reservation/consumption rules.

Examples: Action Points, Spell Slots, Stamina, Ammunition.

### 8.10 Event and reaction

An event is a typed fact emitted by resolution. A reaction subscribes to an allowed event selector and condition, then schedules a bounded response.

Examples: Attack Hit, Damage Applied, Turn Started; retaliate after taking melee damage.

## 9. Canonical source is typed declarative data

Canonical source is stored as schema-versioned JSON because JSON is portable and easy to validate, diff, migrate, hash, and compile. JSON syntax alone does not define the language.

Each definition must include:

- stable external ID and definition type;
- schema and metamodel version;
- typed body conforming exactly to that definition type;
- explicit stable-ID references;
- authoring metadata and provenance;
- visibility and extension policy; and
- optional presentation layout kept separate from semantics.

Unknown semantic fields are rejected. Extensions use explicit namespaced extension points rather than arbitrary extra keys.

An illustrative field definition is:

```json
{
  "formatVersion": "1",
  "definitionId": "field:strength-score",
  "definitionType": "field",
  "valueType": "integer",
  "appliesTo": ["entity-type:creature"],
  "constraints": {
    "minimum": 1,
    "maximum": 20
  },
  "default": 10,
  "visibility": "public"
}
```

The GM does not type this document. The field editor produces it through named controls.

## 10. Expressions are visual, typed ASTs

Expressions must use a closed, versioned abstract syntax tree rather than text formulas. The author sees readable chips and an expression tree; the compiler sees typed nodes.

For a familiar Strength modifier, the visual editor could show:

```text
Round down (([self → Strength Score] - [10]) / [2])
```

The canonical expression could be:

```json
{
  "op": "floor",
  "value": {
    "op": "divide",
    "left": {
      "op": "subtract",
      "left": { "op": "get", "path": ["self", "field:strength-score"] },
      "right": { "op": "literal", "value": 10 }
    },
    "right": { "op": "literal", "value": 2 }
  }
}
```

The editor should preview representative values:

| Strength | Modifier |
|---:|---:|
| 8 | -1 |
| 9 | -1 |
| 10 | 0 |
| 11 | 0 |
| 12 | +1 |

This preview exposes a semantic ambiguity that prose often hides: the author must choose rounding behavior and confirm boundary examples.

The expression vocabulary is defined in the broader rule-set design. The UI must prevent type-invalid connections, display units, detect cycles, and show the source and inferred type of every value.

## 11. Resolution pipelines are bounded graphs

An operation's behavior is a directed acyclic pipeline of approved steps. The GM builds it from a palette instead of writing procedures.

Initial steps should include:

- validate availability;
- select authorized target;
- reserve or consume resource;
- calculate value;
- request and record entropy;
- perform check or comparison;
- branch on typed result;
- create, update, or delete an authorized instance;
- apply or remove effect;
- emit semantic event; and
- return typed result.

The builder enforces compatible connectors. For example, a `Roll Result` output can connect to a numeric comparison but not directly to an entity target input. General loops, recursion, arbitrary mutation, and dynamic code are unavailable.

The compiler normalizes the graph into an execution plan with declared reads, writes, costs, visibility, entropy requests, and maximum step count. The runtime executes that plan transactionally.

## 12. References and renaming

The GM selects references by human-readable label, namespace, type, and description. Canonical source stores stable IDs.

Renaming `Strength` to `Might` changes presentation and authoring labels but does not break `field:strength-score` references. Deletion must show incoming references and either block, replace, or explicitly remove them. A search index or LevelGraph projection may accelerate usage queries, but the compiler's canonical dependency graph determines publication validity.

Reference controls must filter by expected type and authorization. A slot requiring a numeric field cannot select an operation or private field from an inaccessible module.

## 13. Templates without runtime ambiguity

A template is an authoring-time recipe with typed parameters, defaults, required references, and generated-definition boundaries. It is not an unbounded runtime macro.

A `Melee Attack` template might request:

- attack name;
- eligible weapon or trait selector;
- responsible actor and target types;
- die expression;
- zero or more typed modifiers;
- comparison target;
- damage expression;
- resource cost; and
- success and failure events.

Instantiating the template creates ordinary definitions with new stable IDs and records template provenance and version. The GM can edit the result without the template being present at runtime.

If future products need live inheritance, it must be an explicit extension relationship with compatibility and migration rules. Template provenance alone never creates hidden synchronization.

## 14. Guided AI authoring

The assistant is a question planner and proposal author over the same metamodel.

For the GM statement:

> Strength is an attribute of a creature from 1 to 20, averages 10, affects carrying capacity, and grants bonuses or penalties to Strength-related rolls every two points from average.

the assistant should classify likely definitions and ask only consequential missing questions, such as:

- Is Strength always an integer?
- How should odd values below and above 10 round?
- Is carry capacity a derived value, a modifier, or an operation constraint?
- What is the carry-capacity formula and unit?
- Which checks are considered Strength-related: an explicit selector, a tag, or named references?
- May effects temporarily exceed the 1–20 authored range?

The assistant then produces a proposal containing:

- proposed definitions and stable IDs;
- stated facts, proposed defaults, and unresolved assumptions;
- typed canonical patch;
- generated plain-language explanation;
- validation diagnostics;
- dependency and affected-definition summary;
- example input/output table; and
- suggested fixtures.

The GM may revise, partially accept, accept, or discard the proposal. NestJS independently validates an accepted proposal against permissions, current draft revision, and the metamodel before applying it atomically.

The model never supplies evaluator code and never interprets authoritative runtime state.

## 15. Descriptor-driven forms

The authoring UI should receive application-owned form descriptors from NestJS. A descriptor identifies:

- semantic field path and stable field ID;
- label, help, examples, and documentation;
- value type, unit, cardinality, and constraints;
- control recommendation;
- reference type and filtering rules;
- conditional visibility;
- grouping and progressive-disclosure level;
- whether the field affects runtime, generation, presentation, or migration;
- default provenance; and
- validation and diagnostic mappings.

Descriptors are derived from the same metamodel as canonical validation and AI tools. They are not stored per definition in Payload and do not grant the browser authority to invent new semantics.

Specialized controls may implement a descriptor interface:

- definition reference picker;
- dice/check builder;
- numeric expression builder;
- selector builder;
- resolution pipeline canvas;
- effect duration and stacking editor;
- event/reaction editor;
- fixture table; and
- generation-capability editor.

A generic form renderer handles scalar and structural fields. Specialized builders handle domains where a generic nested form would be technically correct but unusable.

## 16. Draft commands and concurrency

The browser should submit semantic commands rather than replacing an entire opaque body whenever possible. Examples include:

```text
definition.field.set
definition.parameter.add
expression.node.replace
operation.step.add
operation.connection.add
reference.replace
fixture.case.add
```

Each command carries the definition ID, expected draft revision, idempotency key, origin (`form`, `builder`, `assistant-proposal`, `clone`, or `import`), and typed payload.

NestJS validates and applies the command, increments the draft revision, returns normalized source and diagnostics, and records an audit entry. This command boundary supports undo, semantic diffs, collaboration, and stale-write recovery more safely than whole-document last-write-wins updates.

Bulk changes such as an accepted AI proposal are applied atomically as a command batch.

## 17. Validation model

Validation occurs at several levels.

### 17.1 Interactive validation

The browser uses descriptors for immediate required-field, type, range, and connector feedback. This feedback is advisory and duplicated authoritatively on the server.

### 17.2 Draft validation

NestJS validates canonical shape, references, types, units, cycles, selectors, pipeline structure, permissions, and known compatibility constraints. Invalid drafts may remain recoverable and editable.

### 17.3 Publication validation

The compiler resolves the complete dependency graph and requires:

- no unresolved or unauthorized references;
- no type, unit, or expression errors;
- no forbidden cycles;
- bounded execution cost;
- deterministic behavior except for explicit recorded inputs;
- compatible extension points and engine feature level;
- valid migrations where persisted state changes; and
- passing required fixtures and publication approvals.

### 17.4 Runtime validation

The runtime validates operation authorization, current availability, target visibility, resource reservations, expected state versions, idempotency, and execution budgets. It does not compensate for invalid source that should have been rejected at publication.

## 18. Preview, fixtures, and explanation

An elegant editor must help the GM test meaning, not merely fill fields.

Each definition editor should provide:

- example tables for derived values;
- a fixture builder with named arrangements, inputs, and expected results;
- an operation preview using synthetic authorized state;
- a human-readable dependency list;
- generated positive and negative examples;
- warnings for unreachable branches and unused inputs; and
- an evaluation trace explaining each result.

A trace for a melee attack could show:

```text
Roll d20                                      14
Attacker Strength Modifier                   +3
Weapon Accuracy Modifier                     +1
Attack total                                 18
Target Defense                               16
Comparison: 18 >= 16                    success
Weapon Damage Roll                          1d12
Recorded entropy result                       9
Damage applied                                9
```

Trace visibility is capability-filtered so hidden GM information is not leaked to players.

## 19. Compilation and execution boundary

Payload CMS stores draft and released source definitions. Publication passes normalized source to a framework-independent compiler that:

1. resolves modules, stable references, templates, and extensions;
2. validates schemas, types, units, selectors, and capabilities;
3. constructs and checks the dependency graph;
4. normalizes expressions and pipelines;
5. calculates declared reads, writes, entropy, events, and budgets;
6. produces immutable executable and generation-policy artifacts;
7. hashes the complete artifact and dependency lock; and
8. stores it for runtime use outside the synchronous Payload path.

The evaluator interprets only this closed compiled representation. It receives an authorized evaluation context, executes within a database transaction, records entropy and time inputs, emits semantic events through an outbox, and produces a capability-filtered trace.

This design avoids both unsafe user code and repeated natural-language or arbitrary-JSON interpretation during play.

## 20. Generation influence

Rule definitions may declare generation capabilities separately from runtime operations. For example, a `Magical` trait or magic-item entity type can contribute:

- enabled artifact kinds;
- required and forbidden traits;
- catalog references;
- prompt constraints and terminology;
- validation rules; and
- applicability behavior when a gameplay profile changes.

The composition compiler aggregates these contributions into a generation-policy artifact. Generators receive only the effective policy and authorized source context. Generated artifacts record the rule-set releases, composition hash, applicable definitions, generator versions, and validation result.

## 21. Security and operational constraints

- Natural-language input, imported definitions, and AI output are untrusted.
- Only typed NestJS commands may mutate drafts.
- Only compiled artifacts may execute.
- Expression and pipeline vocabularies are closed and versioned.
- Runtime evaluation has step, collection, recursion, memory, and time budgets; recursion remains prohibited initially.
- References and traces are capability-filtered.
- Hidden fields are omitted from evaluation contexts provided to unauthorized actors.
- Randomness and time are explicit recorded inputs.
- The client never receives CMS service credentials or directly interprets Payload documents as executable rules.
- Authoring, compilation, execution, and AI proposal events are auditable.

## 22. Proposed application APIs

The exact draft resource model remains to be finalized, but the authoring surface should trend toward:

```text
GET  /api/rule-authoring/metamodel
GET  /api/rule-authoring/definition-types/:type/descriptor
POST /api/rule-authoring/validate
GET  /api/rule-sets/:ruleSetId/drafts/:draftId/definitions/:definitionId
POST /api/rule-sets/:ruleSetId/drafts/:draftId/commands
POST /api/rule-sets/:ruleSetId/drafts/:draftId/command-batches
POST /api/rule-sets/:ruleSetId/drafts/:draftId/validate
POST /api/rule-sets/:ruleSetId/drafts/:draftId/preview
POST /api/rule-sets/:ruleSetId/drafts/:draftId/fixtures/run
GET  /api/rule-sets/:ruleSetId/drafts/:draftId/references/:definitionId/incoming
POST /api/rule-sets/:ruleSetId/drafts/:draftId/assistant-sessions
POST /api/rule-sets/:ruleSetId/drafts/:draftId/assistant-sessions/:sessionId/messages
POST /api/rule-sets/:ruleSetId/drafts/:draftId/assistant-proposals/:proposalId/apply
```

Descriptor and metamodel responses are cacheable by version. Mutation commands require authorization, expected revision, and idempotency.

## 23. Phased delivery

### Phase 0: metamodel spike

- Formalize the contained creature-capability domain: field, parameter, derived value, trait, capability contribution, and condition schemas.
- Define typed contracts for visual perception, audio perception, walking rate, and running rate.
- Implement stable typed references and diagnostic paths.
- Compile and evaluate the existing Legged, Vision, Hearing, Walking Speed, and Running Speed examples.
- Prove deterministic replay and trace output without Payload access during execution.
- Author one structurally different non-fantasy or non-d20 example to detect hidden ontology assumptions.

Implementation status (July 15, 2026): the first Phase 0 vertical slice is implemented under `backend/src/rules/metamodel`. It includes versioned field, derived-value, parameter, trait, capability-contribution, expression, and condition types; closed contracts for visual perception, audio perception, walking rate, and running rate; deterministic compilation and artifact hashing; diagnostic paths; unknown-field rejection; derived-cycle detection; a Payload-independent evaluator with deterministic traces; and executable Legged, Vision, Hearing, Walking Speed, Running Speed, and non-fantasy Sonar Array examples. Authenticated NestJS endpoints now expose the metamodel, type descriptors, and draft validation. This is an intentionally narrow executable foundation, not yet the GM-facing authoring UI or a publication pipeline.

### Phase 1: approachable creature-capability authoring

- Free-sentence classification into reviewable semantic frames.
- Controlled semantic-sentence editor with typed inline slots.
- Descriptor API and focused property inspector.
- Accessible full-form view for field, trait, parameter, derived-value, and capability definitions.
- Reference picker and incoming-reference view.
- Visual expression builder with example table.
- Draft validation and revision-aware semantic commands.
- Canonical source available only as an advanced view.
- End-to-end Vision and Running authoring without JSON.

Implementation status (July 15, 2026): the first Phase 1 vertical slice is implemented. Authenticated Next.js gateway routes expose the NestJS metamodel, trait descriptor, and validation endpoint without disclosing trusted headers. The definition create and edit flows now provide specialized Vision and Running templates, a controlled semantic-sentence view with typed inline slots, an accessible full-form view, stable-ID editing, server diagnostics, and read-only canonical source under progressive disclosure. Canonical guided traits round-trip back into the specialized editor, and older or arbitrary trait bodies can be explicitly converted without overwriting their source until save. The remaining Phase 1 scope includes free-sentence classification, general field and derived-value forms, definition reference browsing, the general expression builder and example table, incoming-reference views, and revision-aware semantic command APIs.

### Phase 2: checks and executable operations

- Add modifier, check, operation, effect, resource, and event schemas only after the creature-capability domain is proven.
- Check builder and resolution pipeline canvas for genuinely multi-step behavior.
- Operation, effect, resource, event, and reaction editors.
- Fixture builder, preview evaluator, and trace viewer.
- Compiler publication gates and immutable artifacts.

Implementation status (July 15, 2026): the first Phase 2 vertical slice is implemented around a bounded melee-attack loop. The `resolution/1` metamodel adds code-owned modifier, target-number check, resource, effect, event, and operation definitions; closed expressions and conditions; acyclic approved pipeline steps; explicit entropy inputs; execution budgets; deterministic artifact hashing; preview-only resource/effect/event intents; trace output; and success/failure fixtures. NestJS exposes resolution descriptors, mixed-metamodel draft validation, operation preview, and fixture execution. The rule-definition UI now includes a target-number check builder with an example table and a bounded operation builder with dependency references, a readable pipeline, sample execution, and trace display. Payload accepts `derived-value`, `modifier`, `check`, and `resource` definition types through the reviewed, rollback-guarded migration `20260715_142221_phase2_definition_types`; schema push remains disabled. This slice does not yet publish artifacts or commit preview intents to runtime tables. The remaining Phase 2 scope includes general modifier/resource/effect/event builders, arbitrary pipeline editing and connectors, richer fixtures, authorization and selector controls, publication approval gates, immutable artifact storage, and transactional execution/outbox integration.

### Phase 3: templates and guided assistance

- Typed authoring templates with provenance.
- AI classification, question planning, proposals, diffs, and partial acceptance.
- Shared metamodel generation for form descriptors and AI tools.

### Phase 4: collaboration and ecosystem

- Semantic undo and command history.
- Collaborative draft conflict presentation.
- Import/export, migrations, localization, and richer generation-policy editors.

## 24. Acceptance criteria

The authoring strategy is successful when:

1. A GM enters the Vision sentence above, resolves its highlighted distance and lighting slots, and saves a valid parameterized trait without viewing or typing JSON.
2. A GM enters the Running sentence above and creates a derived `2 × Walking Speed` capability through inline typed references.
3. A GM authors Strength Score and Strength Modifier without viewing or typing JSON.
4. The Strength editor requires an explicit rounding decision and previews boundary values.
5. The semantic sentence, focused inspector, accessible form, and generated explanation round-trip without losing meaning.
6. The compiler evaluates Legged, Vision, Hearing, Walking Speed, and Running Speed without Payload access during evaluation.
7. Renaming a referenced definition changes labels without breaking stable references.
8. Deleting a referenced definition shows incoming usages and requires an explicit resolution.
9. Form, sentence, and accepted AI-proposal edits produce the same canonical source and validation results.
10. Invalid drafts remain recoverable but cannot be published or executed.
11. A published composition compiles to a content-addressed artifact and evaluates without Payload access.
12. The same normalized inputs reproduce the same capability result and trace.
13. A later GM can author a reusable Melee Attack template and apply it to two weapons without changing the creature-capability metamodel's existing meaning.
14. At least two structurally different capability rule sets can be authored without deploying game-specific rule semantics code.

## 25. Decisions needed before implementation

1. Is the proposed creature-capability domain narrow enough for the first milestone, or should Strength be deferred so the spike focuses only on movement and perception?
2. Should a trait application always hold parameter values, or may a creature override them through ordinary instance fields and effects?
3. Which environmental facts are platform primitives in v1: lighting, opaque barriers, terrain, medium, and/or weather?
4. Does visual perception return a Boolean, a degree of perception, or a typed observation whose detail depends on range and acuity?
5. Are Walking Speed and Running Speed expressed as distance per turn, distance per second, or an abstract movement unit independent of turn structure?
6. Which concepts require specialized builders in the contained domain rather than the semantic sentence and property inspector?
7. Are tags ever allowed to drive semantics, or are they search/presentation metadata only? Stable selectors are safer for semantics.
8. Which unit system and conversion rules are built into the metamodel?
9. Which rounding modes and numeric precision are supported initially?
10. Which semantic choices must the AI always ask rather than visibly suggest?
11. What fixture coverage is required before publication?
12. Which capability traces may players see versus GMs only?

## 26. Recommended decisions

The current recommendation, incorporating the accepted product direction, is:

- use the type-specific hybrid editor;
- make controlled semantic sentences the default for simple traits and capabilities;
- begin with the contained creature-capability domain and expand through versioned platform metamodel releases;
- allow invalid drafts but block publication;
- keep tags non-semantic;
- model traits as parameterized capability contributors;
- model Running Speed as a derived capability first and let later operations consume it;
- use stable definition IDs in every reference;
- instantiate templates into ordinary definitions with provenance but no hidden live inheritance;
- require explicit numeric units and rounding;
- require fixtures for every operation and every non-trivial derived value; and
- keep AI proposals review-only and independently validated.
