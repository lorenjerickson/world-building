import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-postgres'

export async function up(_args: MigrateUpArgs): Promise<void> {
  // The media MIME allowlist is application configuration and creates no
  // PostgreSQL schema delta. Keep this named migration so the model change is
  // explicit, ordered, and reproducible across environments.
}

export async function down(_args: MigrateDownArgs): Promise<void> {
  // Reverting the paired Media collection change restores the former allowlist.
}
