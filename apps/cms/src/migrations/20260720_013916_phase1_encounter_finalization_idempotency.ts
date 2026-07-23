import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "encounter_map_revisions" ADD COLUMN "finalization_command_id" varchar NOT NULL;
  CREATE UNIQUE INDEX "encounter_map_revisions_finalization_command_id_idx" ON "encounter_map_revisions" USING btree ("finalization_command_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP INDEX "encounter_map_revisions_finalization_command_id_idx";
  ALTER TABLE "encounter_map_revisions" DROP COLUMN "finalization_command_id";`)
}
