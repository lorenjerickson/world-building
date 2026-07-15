import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type JsonObject = Record<string, unknown>;
export type JsonValue = JsonObject | unknown[];

@Entity({ name: 'rule_set_compositions', synchronize: false })
@Index(['workspaceExternalId', 'compositionHash'], { unique: true })
export class RuleSetComposition {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  @Index()
  workspaceExternalId: string;

  @Column({ type: 'jsonb' })
  manifest: JsonObject;

  @Column()
  @Index()
  compositionHash: string;

  @Column()
  engineVersion: string;

  @Column()
  compilerVersion: string;

  @Column({ type: 'jsonb', nullable: true })
  validationSummary?: JsonObject;

  @Column()
  createdBy: string;

  @CreateDateColumn()
  createdAt: Date;
}

@Entity({ name: 'rule_set_composition_members', synchronize: false })
@Index(['compositionId', 'namespaceAlias'], { unique: true })
@Index(['compositionId', 'sortOrder'], { unique: true })
export class RuleSetCompositionMember {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  compositionId: string;

  @Column({ type: 'integer' })
  ruleSetId: number;

  @Column({ type: 'integer' })
  releaseId: number;

  @Column()
  releaseHash: string;

  @Column()
  namespaceAlias: string;

  @Column({ type: 'integer' })
  sortOrder: number;

  @Column({ type: 'jsonb', default: {} })
  policy: JsonObject;
}

@Entity({ name: 'rule_set_bindings', synchronize: false })
@Index(['scopeType', 'scopeId', 'gameplayProfileName'], { unique: true })
export class RuleSetBinding {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  @Index()
  workspaceExternalId: string;

  @Column()
  scopeType: 'world' | 'campaign' | 'session';

  @Column()
  scopeId: string;

  @Column()
  gameplayProfileName: string;

  @Column('uuid')
  compositionId: string;

  @Column()
  compositionHash: string;

  @Column({ default: false })
  active: boolean;

  @Column({ type: 'bigint', default: 1 })
  stateVersion: string;

  @Column({ default: 'active' })
  status: 'active' | 'migrating' | 'disabled';

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

@Entity({ name: 'rule_instances', synchronize: false })
@Index(['bindingId', 'typeId'])
export class RuleInstance {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  bindingId: string;

  @Column()
  typeId: string;

  @Column({ type: 'jsonb' })
  state: JsonObject;

  @Column({ type: 'bigint', default: 1 })
  stateVersion: string;

  @Column()
  createdBy: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

@Entity({ name: 'rule_effects', synchronize: false })
@Index(['bindingId', 'targetId'])
@Index(['bindingId', 'expiresAt'])
export class RuleEffect {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  bindingId: string;

  @Column()
  targetId: string;

  @Column()
  definitionId: string;

  @Column({ type: 'jsonb' })
  sourceRef: JsonObject;

  @Column({ type: 'jsonb' })
  state: JsonObject;

  @Column({ type: 'timestamptz', nullable: true })
  expiresAt?: Date;

  @Column({ type: 'bigint', default: 1 })
  stateVersion: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

@Entity({ name: 'rule_executions', synchronize: false })
@Index(['bindingId', 'actorId', 'idempotencyKey'], { unique: true })
export class RuleExecution {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  bindingId: string;

  @Column()
  operationId: string;

  @Column()
  actorId: string;

  @Column()
  idempotencyKey: string;

  @Column({ type: 'jsonb' })
  input: JsonObject;

  @Column({ type: 'jsonb', nullable: true })
  result?: JsonObject;

  @Column({ nullable: true })
  traceRef?: string;

  @Column({ default: 'pending' })
  status: 'pending' | 'committed' | 'rejected' | 'failed';

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

@Entity({ name: 'rule_events', synchronize: false })
@Index(['bindingId', 'sequence'], { unique: true })
export class RuleEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  bindingId: string;

  @Column({ type: 'bigint' })
  sequence: string;

  @Column()
  eventTypeId: string;

  @Column({ default: 'public' })
  visibility: string;

  @Column({ type: 'jsonb' })
  payload: JsonObject;

  @Column('uuid', { nullable: true })
  causationId?: string;

  @Column('uuid', { nullable: true })
  correlationId?: string;

  @CreateDateColumn()
  createdAt: Date;
}

@Entity({ name: 'rule_continuations', synchronize: false })
@Index(['status', 'expiresAt'])
export class RuleContinuation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  @Index()
  executionId: string;

  @Column()
  stepId: string;

  @Column({ type: 'jsonb' })
  state: JsonObject;

  @Column({ type: 'jsonb' })
  authorizedResponders: string[];

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ default: 'pending' })
  status: 'pending' | 'resolved' | 'expired' | 'cancelled';

  @Column({ type: 'bigint', default: 1 })
  stateVersion: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

@Entity({ name: 'rule_artifacts', synchronize: false })
@Index(['releaseOrCompositionHash', 'engineVersion'], { unique: true })
export class RuleArtifact {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  artifactHash: string;

  @Column()
  releaseOrCompositionHash: string;

  @Column()
  engineVersion: string;

  @Column()
  artifactLocation: string;

  @Column({ type: 'jsonb' })
  validationSummary: JsonObject;

  @CreateDateColumn()
  compiledAt: Date;
}

@Entity({ name: 'artifact_rule_contexts', synchronize: false })
@Index(['artifactId', 'compositionHash'])
export class ArtifactRuleContext {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  artifactId: string;

  @Column()
  @Index()
  generationJobId: string;

  @Column('uuid', { nullable: true })
  bindingId?: string;

  @Column()
  compositionHash: string;

  @Column()
  policyHash: string;

  @Column({ type: 'jsonb' })
  applicableReleases: JsonValue;

  @Column({ type: 'jsonb' })
  context: JsonObject;

  @Column({ default: 'applicable' })
  applicabilityStatus: 'applicable' | 'adaptable' | 'legacy-visible' | 'profile-hidden' | 'invalid';

  @Column({ type: 'jsonb' })
  validationSummary: JsonObject;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

@Entity({ name: 'rule_authoring_sessions', synchronize: false })
@Index(['ruleSetId', 'draftId', 'actorId'])
export class RuleAuthoringSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'integer' })
  ruleSetId: number;

  @Column()
  draftId: string;

  @Column()
  actorId: string;

  @Column()
  baseRevision: string;

  @Column({ default: 'active' })
  status: 'active' | 'completed' | 'cancelled' | 'expired';

  @Column({ type: 'jsonb' })
  modelMetadata: JsonObject;

  @Column({ type: 'jsonb' })
  retentionPolicy: JsonObject;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

@Entity({ name: 'rule_authoring_proposals', synchronize: false })
@Index(['sessionId', 'proposalHash'], { unique: true })
export class RuleAuthoringProposal {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  sessionId: string;

  @Column()
  baseRevision: string;

  @Column()
  proposalHash: string;

  @Column({ type: 'jsonb' })
  patch: JsonObject;

  @Column({ type: 'jsonb' })
  assumptions: JsonValue;

  @Column({ type: 'jsonb' })
  validationSummary: JsonObject;

  @Column({ default: 'proposed' })
  status: 'proposed' | 'accepted' | 'partially-accepted' | 'discarded' | 'stale';

  @Column({ nullable: true })
  decisionBy?: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

export const ruleSetEntities = [
  RuleSetComposition,
  RuleSetCompositionMember,
  RuleSetBinding,
  RuleInstance,
  RuleEffect,
  RuleExecution,
  RuleEvent,
  RuleContinuation,
  RuleArtifact,
  ArtifactRuleContext,
  RuleAuthoringSession,
  RuleAuthoringProposal,
];
