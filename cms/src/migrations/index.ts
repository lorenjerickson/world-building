import * as migration_20260714_230614_initial_schema from './20260714_230614_initial_schema';
import * as migration_20260714_230652_add_world_summary from './20260714_230652_add_world_summary';
import * as migration_20260714_234515_add_media_storage_prefix from './20260714_234515_add_media_storage_prefix';
import * as migration_20260715_003831_add_rule_set_collections from './20260715_003831_add_rule_set_collections';

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
    name: '20260715_003831_add_rule_set_collections'
  },
];
