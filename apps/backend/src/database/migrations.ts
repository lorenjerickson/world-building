import { AdoptWorldsSchema1784077200000 } from './migrations/1784077200000-adopt-worlds-schema';
import { CreateRuleSetPersistence1784077260000 } from './migrations/1784077260000-create-rule-set-persistence';
import { AddRuleDefinitionSnapshots1784077320000 } from './migrations/1784077320000-add-rule-definition-snapshots';

export const applicationMigrations = [
  AdoptWorldsSchema1784077200000,
  CreateRuleSetPersistence1784077260000,
  AddRuleDefinitionSnapshots1784077320000,
];
