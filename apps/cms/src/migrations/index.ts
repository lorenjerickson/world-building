import * as migration_20260714_230614_initial_schema from './20260714_230614_initial_schema';
import * as migration_20260714_230652_add_world_summary from './20260714_230652_add_world_summary';
import * as migration_20260714_234515_add_media_storage_prefix from './20260714_234515_add_media_storage_prefix';
import * as migration_20260715_003831_add_rule_set_collections from './20260715_003831_add_rule_set_collections';
import * as migration_20260715_142221_phase2_definition_types from './20260715_142221_phase2_definition_types';
import * as migration_20260720_013818_phase1_encounter_maps from './20260720_013818_phase1_encounter_maps';
import * as migration_20260720_013916_phase1_encounter_finalization_idempotency from './20260720_013916_phase1_encounter_finalization_idempotency';

export const migrations = [
  {
    up: migration_20260714_230614_initial_schema.up,
    down: migration_20260714_230614_initial_schema.down,
    name: '20260714_230614_initial_schema',
  },
  {
    up: migration_20260714_230652_add_world_summary.up,
    down: migration_20260714_230652_add_world_summary.down,
    name: '20260714_230652_add_world_summary',
  },
  {
    up: migration_20260714_234515_add_media_storage_prefix.up,
    down: migration_20260714_234515_add_media_storage_prefix.down,
    name: '20260714_234515_add_media_storage_prefix',
  },
  {
    up: migration_20260715_003831_add_rule_set_collections.up,
    down: migration_20260715_003831_add_rule_set_collections.down,
    name: '20260715_003831_add_rule_set_collections',
  },
  {
    up: migration_20260715_142221_phase2_definition_types.up,
    down: migration_20260715_142221_phase2_definition_types.down,
    name: '20260715_142221_phase2_definition_types',
  },
  {
    up: migration_20260720_013818_phase1_encounter_maps.up,
    down: migration_20260720_013818_phase1_encounter_maps.down,
    name: '20260720_013818_phase1_encounter_maps',
  },
  {
    up: migration_20260720_013916_phase1_encounter_finalization_idempotency.up,
    down: migration_20260720_013916_phase1_encounter_finalization_idempotency.down,
    name: '20260720_013916_phase1_encounter_finalization_idempotency'
  },
];
