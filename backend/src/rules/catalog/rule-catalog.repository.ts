import type { RuleApiActor } from '../api/rule-api-actor';
import {
  CreateRuleDefinitionInput,
  CreateRuleModuleInput,
  CreateRuleSetInput,
  Page,
  RuleCatalogActor,
  RuleDefinitionListOptions,
  RuleDefinitionResource,
  RuleModuleResource,
  RuleReleaseResource,
  RuleSetListOptions,
  RuleSetResource,
  UpdateRuleDefinitionInput,
  UpdateRuleModuleInput,
  UpdateRuleSetInput,
} from './rule-catalog.types';

export abstract class RuleCatalogRepository {
  abstract resolveActor(actor: RuleApiActor): Promise<RuleCatalogActor>;
  abstract listRuleSets(actor: RuleApiActor, options: RuleSetListOptions): Promise<Page<RuleSetResource>>;
  abstract createRuleSet(actor: RuleApiActor, input: CreateRuleSetInput): Promise<RuleSetResource>;
  abstract getRuleSet(actor: RuleApiActor, ruleSetId: number): Promise<RuleSetResource>;
  abstract updateRuleSet(actor: RuleApiActor, ruleSetId: number, input: UpdateRuleSetInput): Promise<RuleSetResource>;
  abstract deleteRuleSet(actor: RuleApiActor, ruleSetId: number): Promise<void>;
  abstract listModules(actor: RuleApiActor, ruleSetId: number): Promise<RuleModuleResource[]>;
  abstract createModule(actor: RuleApiActor, ruleSetId: number, input: CreateRuleModuleInput): Promise<RuleModuleResource>;
  abstract getModule(actor: RuleApiActor, moduleId: number): Promise<RuleModuleResource>;
  abstract updateModule(actor: RuleApiActor, moduleId: number, input: UpdateRuleModuleInput): Promise<RuleModuleResource>;
  abstract deleteModule(actor: RuleApiActor, moduleId: number): Promise<void>;
  abstract listDefinitions(actor: RuleApiActor, ruleSetId: number, options: RuleDefinitionListOptions): Promise<RuleDefinitionResource[]>;
  abstract createDefinition(actor: RuleApiActor, ruleSetId: number, input: CreateRuleDefinitionInput): Promise<RuleDefinitionResource>;
  abstract getDefinition(actor: RuleApiActor, definitionId: number): Promise<RuleDefinitionResource>;
  abstract updateDefinition(actor: RuleApiActor, definitionId: number, input: UpdateRuleDefinitionInput): Promise<RuleDefinitionResource>;
  abstract deleteDefinition(actor: RuleApiActor, definitionId: number): Promise<void>;
  abstract listReleases(actor: RuleApiActor, ruleSetId: number): Promise<RuleReleaseResource[]>;
  abstract getRelease(actor: RuleApiActor, releaseId: number): Promise<RuleReleaseResource>;
}
