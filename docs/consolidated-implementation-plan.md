Proposed Changes & Phased Implementation Plan
The remaining implementation work is organized into 5 sequential phases:

Phase 1: Backend Database Migration to Prisma & First-Class extends AST
Migrates apps/backend runtime database layer from TypeORM to Prisma, and implements first-class extends AST evaluation with dynamic runtime closure resolution.

[NEW] 
apps/backend/prisma/schema.prisma
Define Prisma schema for runtime database tables (world runtime states, campaign sessions, encounter instances, entity execution traces).
[NEW] 
apps/backend/src/database/prisma.service.ts
Implement injectable NestJS PrismaService extending PrismaClient to replace @nestjs/typeorm.
[MODIFY] 
packages/common/src/trait-shape.ts
Support extends as a first-class AST node.
Implement dynamic closure evaluation of traits granted to a holder at resolution time.
[MODIFY] 
apps/backend/src/rules/resolution/resolution.evaluator.ts
Add unit-aware modifier validation and unit conversion for numeric terminal fields.
Implement suppress and replace modifier operations for terminal fields and die results with complete provenance tracking.
Phase 2: CMS Model Expansion & Content API Cutover
Expands Payload CMS collections for game entities and routes all content queries through the NestJS backend adapter.

[NEW] 
apps/cms/src/migrations/20260725_000000_add_content_entities.ts
Add Payload collection schemas for Campaigns, Sessions, Items, Organizations, and Encounter Map references with versioning and push: false.
[MODIFY] 
apps/backend/src/cms/content.repository.ts
Complete CRUD methods for new content entities and switch backend controllers to use ContentRepository backed by PrismaService.
Phase 3: Realtime Multiplayer Gateway & Session Transport
Delivers the NestJS WebSocket transport for active game sessions with concurrent action and movement visibility.

[NEW] 
apps/backend/src/realtime/session.gateway.ts
Implement @nestjs/websockets gateway using WsAdapter on NestJS port 8000.
Authenticate connections via Auth0 token guard, manage room joins per session ID, and fan out concurrent player actions.
[NEW] 
apps/frontend/lib/realtime-client.ts
Create WebSocket client store handling message serialization, optimistic state updates, sequence numbering, and auto-reconnect.
Phase 4: Encounter Session Mode: Tokens, Player Camera Lock, Line-of-Sight & Persistent Memory FoW
Extends the existing 3D encounter authoring editor (EncounterAuthoringEditor and WebGLScene) with tokens, player camera locking, server line-of-sight, per-player memory Fog of War, and Plan/Execute/Reconcile action turn integration.

[MODIFY] 
apps/frontend/app/encounters/spike/webgl-scene.tsx
Add 3D token model & camera-facing billboard rendering.
Implement player third-person camera mode locked to controlled token position.
[NEW] 
apps/backend/src/encounters/visibility.service.ts
Implement 3D voxel raycasting for line-of-sight evaluation and per-player persistent Fog of War memory mask (rendering previously revealed static terrain in memory mode while hiding dynamic tokens).
[NEW] 
apps/backend/src/encounters/action-engine.service.ts
Implement Plan / Execute / Reconcile turn phase manager for encounter action resolution.
Phase 5: AI Authoring Orchestrator & Rule Sentence Parser
Integrates LLM-assisted rule creation with human verification.

[NEW] 
apps/backend/src/rules/assistant/rule-sentence-parser.service.ts
Extract semantic slots (subject, capability, parameters, predicates) from natural-language rule sentences into typed draft definition patches.
[MODIFY] 
apps/frontend/components/rule-assistant-panel.tsx
Connect UI assistant panel to NestJS assistant endpoints, rendering draft diff previews and interactive parameter clarification questions.
Verification Plan
Automated Tests
Package Tests: Run pnpm test across all workspace packages (@world-building/common, @world-building/backend, @world-building/cms, @world-building/frontend).
Prisma & DB Verification: Run npx prisma validate and npx prisma migrate dev in apps/backend to verify Prisma schema integrity.
CMS Verification: Run pnpm --filter @world-building/cms run verify:policy and npm run verify:migrations to ensure push: false policy and migration status pass cleanly.
Rule Engine & Trait Tests: Run NestJS unit and fixture tests for recursive trait resolution, first-class extends AST evaluation, die results, and unit-aware modifiers: pnpm --filter @world-building/backend test.
Manual Verification
Existing Encounter Map Authoring: Open /encounters/author or /encounters/[encId]/maps/[mapId]/drafts/[draftId], verify cell placement, vertex deformation (toggleVertex), face painting, 3D perspective, 2D overhead, and 2D SVG compatibility rendering.
Tokens & Player Camera Locking: Test token placement on map, switch to player view mode, and confirm camera is locked to the player's controlled token.
Persistent Memory FoW: Move a player token to reveal terrain, move out of line-of-sight, and verify that static terrain remains rendered in "memory mode" while dynamic tokens are hidden.
Realtime Session & Movement: Connect two browser instances over WebSockets, test exploration drag updates and encounter Plan/Execute/Reconcile cycles.