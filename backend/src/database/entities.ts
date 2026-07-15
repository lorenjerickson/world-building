import { World } from '../generate/entities/world.entity';
import { ruleSetEntities } from '../rules/persistence/rule-set.entities';

export const applicationEntities = [World, ...ruleSetEntities];
