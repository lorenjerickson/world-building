import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "worlds" ADD COLUMN "summary" varchar;
  ALTER TABLE "_worlds_v" ADD COLUMN "version_summary" varchar;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "worlds" DROP COLUMN "summary";
  ALTER TABLE "_worlds_v" DROP COLUMN "version_summary";`)
}
