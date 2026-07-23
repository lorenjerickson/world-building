import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_encounter_map_drafts_scale_in_feet" AS ENUM('0.5', '1', '5');
  CREATE TYPE "public"."enum_encounter_map_drafts_validation_status" AS ENUM('pending', 'valid', 'invalid');
  CREATE TYPE "public"."enum_encounter_map_revisions_scale_in_feet" AS ENUM('0.5', '1', '5');
  CREATE TYPE "public"."enum_encounter_map_artifacts_kind" AS ENUM('canonical', 'debug-export', 'chunk-manifest', 'chunk');
  CREATE TABLE "encounter_maps" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"workspace_id" integer NOT NULL,
  	"external_id" varchar NOT NULL,
  	"campaign_external_id" varchar NOT NULL,
  	"encounter_external_id" varchar NOT NULL,
  	"location_id" integer,
  	"name" varchar NOT NULL,
  	"current_draft_id" integer,
  	"current_revision_id" integer,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "encounter_map_drafts_validation_errors" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"message" varchar NOT NULL
  );
  
  CREATE TABLE "encounter_map_drafts" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"workspace_id" integer NOT NULL,
  	"external_id" varchar NOT NULL,
  	"map_id" integer NOT NULL,
  	"draft_version" numeric NOT NULL,
  	"last_command_id" varchar,
  	"scale_in_feet" "enum_encounter_map_drafts_scale_in_feet" NOT NULL,
  	"bounds_x" numeric NOT NULL,
  	"bounds_y" numeric NOT NULL,
  	"bounds_z" numeric NOT NULL,
  	"palette_version" varchar NOT NULL,
  	"canonical_checksum" varchar NOT NULL,
  	"canonical_artifact_id" integer NOT NULL,
  	"validation_status" "enum_encounter_map_drafts_validation_status" DEFAULT 'pending' NOT NULL,
  	"validated_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "encounter_map_revisions" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"workspace_id" integer NOT NULL,
  	"external_id" varchar NOT NULL,
  	"map_id" integer NOT NULL,
  	"source_draft_id" integer NOT NULL,
  	"revision_number" numeric NOT NULL,
  	"scale_in_feet" "enum_encounter_map_revisions_scale_in_feet" NOT NULL,
  	"bounds_x" numeric NOT NULL,
  	"bounds_y" numeric NOT NULL,
  	"bounds_z" numeric NOT NULL,
  	"palette_version" varchar NOT NULL,
  	"canonical_checksum" varchar NOT NULL,
  	"compiler_version" varchar NOT NULL,
  	"canonical_artifact_id" integer NOT NULL,
  	"finalized_by_id" integer NOT NULL,
  	"finalized_at" timestamp(3) with time zone NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "encounter_map_revisions_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"encounter_map_artifacts_id" integer
  );
  
  CREATE TABLE "encounter_map_artifacts" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"workspace_id" integer NOT NULL,
  	"map_id" integer NOT NULL,
  	"kind" "enum_encounter_map_artifacts_kind" NOT NULL,
  	"checksum" varchar NOT NULL,
  	"format_version" varchar NOT NULL,
  	"compiler_version" varchar,
  	"palette_version" varchar NOT NULL,
  	"prefix" varchar DEFAULT 'encounter-maps',
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"url" varchar,
  	"thumbnail_u_r_l" varchar,
  	"filename" varchar,
  	"mime_type" varchar,
  	"filesize" numeric,
  	"width" numeric,
  	"height" numeric,
  	"focal_x" numeric,
  	"focal_y" numeric
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "encounter_maps_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "encounter_map_drafts_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "encounter_map_revisions_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "encounter_map_artifacts_id" integer;
  ALTER TABLE "encounter_maps" ADD CONSTRAINT "encounter_maps_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "encounter_maps" ADD CONSTRAINT "encounter_maps_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "encounter_maps" ADD CONSTRAINT "encounter_maps_current_draft_id_encounter_map_drafts_id_fk" FOREIGN KEY ("current_draft_id") REFERENCES "public"."encounter_map_drafts"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "encounter_maps" ADD CONSTRAINT "encounter_maps_current_revision_id_encounter_map_revisions_id_fk" FOREIGN KEY ("current_revision_id") REFERENCES "public"."encounter_map_revisions"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "encounter_map_drafts_validation_errors" ADD CONSTRAINT "encounter_map_drafts_validation_errors_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."encounter_map_drafts"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "encounter_map_drafts" ADD CONSTRAINT "encounter_map_drafts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "encounter_map_drafts" ADD CONSTRAINT "encounter_map_drafts_map_id_encounter_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."encounter_maps"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "encounter_map_drafts" ADD CONSTRAINT "encounter_map_drafts_canonical_artifact_id_encounter_map_artifacts_id_fk" FOREIGN KEY ("canonical_artifact_id") REFERENCES "public"."encounter_map_artifacts"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "encounter_map_revisions" ADD CONSTRAINT "encounter_map_revisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "encounter_map_revisions" ADD CONSTRAINT "encounter_map_revisions_map_id_encounter_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."encounter_maps"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "encounter_map_revisions" ADD CONSTRAINT "encounter_map_revisions_source_draft_id_encounter_map_drafts_id_fk" FOREIGN KEY ("source_draft_id") REFERENCES "public"."encounter_map_drafts"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "encounter_map_revisions" ADD CONSTRAINT "encounter_map_revisions_canonical_artifact_id_encounter_map_artifacts_id_fk" FOREIGN KEY ("canonical_artifact_id") REFERENCES "public"."encounter_map_artifacts"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "encounter_map_revisions" ADD CONSTRAINT "encounter_map_revisions_finalized_by_id_users_id_fk" FOREIGN KEY ("finalized_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "encounter_map_revisions_rels" ADD CONSTRAINT "encounter_map_revisions_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."encounter_map_revisions"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "encounter_map_revisions_rels" ADD CONSTRAINT "encounter_map_revisions_rels_encounter_map_artifacts_fk" FOREIGN KEY ("encounter_map_artifacts_id") REFERENCES "public"."encounter_map_artifacts"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "encounter_map_artifacts" ADD CONSTRAINT "encounter_map_artifacts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "encounter_map_artifacts" ADD CONSTRAINT "encounter_map_artifacts_map_id_encounter_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."encounter_maps"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "encounter_maps_workspace_idx" ON "encounter_maps" USING btree ("workspace_id");
  CREATE UNIQUE INDEX "encounter_maps_external_id_idx" ON "encounter_maps" USING btree ("external_id");
  CREATE INDEX "encounter_maps_campaign_external_id_idx" ON "encounter_maps" USING btree ("campaign_external_id");
  CREATE INDEX "encounter_maps_encounter_external_id_idx" ON "encounter_maps" USING btree ("encounter_external_id");
  CREATE INDEX "encounter_maps_location_idx" ON "encounter_maps" USING btree ("location_id");
  CREATE INDEX "encounter_maps_current_draft_idx" ON "encounter_maps" USING btree ("current_draft_id");
  CREATE INDEX "encounter_maps_current_revision_idx" ON "encounter_maps" USING btree ("current_revision_id");
  CREATE INDEX "encounter_maps_updated_at_idx" ON "encounter_maps" USING btree ("updated_at");
  CREATE INDEX "encounter_maps_created_at_idx" ON "encounter_maps" USING btree ("created_at");
  CREATE INDEX "encounter_map_drafts_validation_errors_order_idx" ON "encounter_map_drafts_validation_errors" USING btree ("_order");
  CREATE INDEX "encounter_map_drafts_validation_errors_parent_id_idx" ON "encounter_map_drafts_validation_errors" USING btree ("_parent_id");
  CREATE INDEX "encounter_map_drafts_workspace_idx" ON "encounter_map_drafts" USING btree ("workspace_id");
  CREATE UNIQUE INDEX "encounter_map_drafts_external_id_idx" ON "encounter_map_drafts" USING btree ("external_id");
  CREATE INDEX "encounter_map_drafts_map_idx" ON "encounter_map_drafts" USING btree ("map_id");
  CREATE INDEX "encounter_map_drafts_last_command_id_idx" ON "encounter_map_drafts" USING btree ("last_command_id");
  CREATE INDEX "encounter_map_drafts_canonical_checksum_idx" ON "encounter_map_drafts" USING btree ("canonical_checksum");
  CREATE INDEX "encounter_map_drafts_canonical_artifact_idx" ON "encounter_map_drafts" USING btree ("canonical_artifact_id");
  CREATE INDEX "encounter_map_drafts_validation_status_idx" ON "encounter_map_drafts" USING btree ("validation_status");
  CREATE INDEX "encounter_map_drafts_updated_at_idx" ON "encounter_map_drafts" USING btree ("updated_at");
  CREATE INDEX "encounter_map_drafts_created_at_idx" ON "encounter_map_drafts" USING btree ("created_at");
  CREATE INDEX "encounter_map_revisions_workspace_idx" ON "encounter_map_revisions" USING btree ("workspace_id");
  CREATE UNIQUE INDEX "encounter_map_revisions_external_id_idx" ON "encounter_map_revisions" USING btree ("external_id");
  CREATE INDEX "encounter_map_revisions_map_idx" ON "encounter_map_revisions" USING btree ("map_id");
  CREATE UNIQUE INDEX "encounter_map_revisions_map_revision_unique" ON "encounter_map_revisions" USING btree ("map_id", "revision_number");
  CREATE INDEX "encounter_map_revisions_source_draft_idx" ON "encounter_map_revisions" USING btree ("source_draft_id");
  CREATE INDEX "encounter_map_revisions_canonical_checksum_idx" ON "encounter_map_revisions" USING btree ("canonical_checksum");
  CREATE INDEX "encounter_map_revisions_canonical_artifact_idx" ON "encounter_map_revisions" USING btree ("canonical_artifact_id");
  CREATE INDEX "encounter_map_revisions_finalized_by_idx" ON "encounter_map_revisions" USING btree ("finalized_by_id");
  CREATE INDEX "encounter_map_revisions_updated_at_idx" ON "encounter_map_revisions" USING btree ("updated_at");
  CREATE INDEX "encounter_map_revisions_created_at_idx" ON "encounter_map_revisions" USING btree ("created_at");
  CREATE INDEX "encounter_map_revisions_rels_order_idx" ON "encounter_map_revisions_rels" USING btree ("order");
  CREATE INDEX "encounter_map_revisions_rels_parent_idx" ON "encounter_map_revisions_rels" USING btree ("parent_id");
  CREATE INDEX "encounter_map_revisions_rels_path_idx" ON "encounter_map_revisions_rels" USING btree ("path");
  CREATE INDEX "encounter_map_revisions_rels_encounter_map_artifacts_id_idx" ON "encounter_map_revisions_rels" USING btree ("encounter_map_artifacts_id");
  CREATE INDEX "encounter_map_artifacts_workspace_idx" ON "encounter_map_artifacts" USING btree ("workspace_id");
  CREATE INDEX "encounter_map_artifacts_map_idx" ON "encounter_map_artifacts" USING btree ("map_id");
  CREATE INDEX "encounter_map_artifacts_kind_idx" ON "encounter_map_artifacts" USING btree ("kind");
  CREATE INDEX "encounter_map_artifacts_checksum_idx" ON "encounter_map_artifacts" USING btree ("checksum");
  CREATE INDEX "encounter_map_artifacts_updated_at_idx" ON "encounter_map_artifacts" USING btree ("updated_at");
  CREATE INDEX "encounter_map_artifacts_created_at_idx" ON "encounter_map_artifacts" USING btree ("created_at");
  CREATE UNIQUE INDEX "encounter_map_artifacts_filename_idx" ON "encounter_map_artifacts" USING btree ("filename");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_encounter_maps_fk" FOREIGN KEY ("encounter_maps_id") REFERENCES "public"."encounter_maps"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_encounter_map_drafts_fk" FOREIGN KEY ("encounter_map_drafts_id") REFERENCES "public"."encounter_map_drafts"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_encounter_map_revisions_fk" FOREIGN KEY ("encounter_map_revisions_id") REFERENCES "public"."encounter_map_revisions"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_encounter_map_artifacts_fk" FOREIGN KEY ("encounter_map_artifacts_id") REFERENCES "public"."encounter_map_artifacts"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_encounter_maps_id_idx" ON "payload_locked_documents_rels" USING btree ("encounter_maps_id");
  CREATE INDEX "payload_locked_documents_rels_encounter_map_drafts_id_idx" ON "payload_locked_documents_rels" USING btree ("encounter_map_drafts_id");
  CREATE INDEX "payload_locked_documents_rels_encounter_map_revisions_id_idx" ON "payload_locked_documents_rels" USING btree ("encounter_map_revisions_id");
  CREATE INDEX "payload_locked_documents_rels_encounter_map_artifacts_id_idx" ON "payload_locked_documents_rels" USING btree ("encounter_map_artifacts_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "encounter_maps" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "encounter_map_drafts_validation_errors" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "encounter_map_drafts" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "encounter_map_revisions" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "encounter_map_revisions_rels" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "encounter_map_artifacts" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "encounter_maps" CASCADE;
  DROP TABLE "encounter_map_drafts_validation_errors" CASCADE;
  DROP TABLE "encounter_map_drafts" CASCADE;
  DROP TABLE "encounter_map_revisions" CASCADE;
  DROP TABLE "encounter_map_revisions_rels" CASCADE;
  DROP TABLE "encounter_map_artifacts" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_encounter_maps_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_encounter_map_drafts_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_encounter_map_revisions_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_encounter_map_artifacts_fk";
  
  DROP INDEX "payload_locked_documents_rels_encounter_maps_id_idx";
  DROP INDEX "payload_locked_documents_rels_encounter_map_drafts_id_idx";
  DROP INDEX "payload_locked_documents_rels_encounter_map_revisions_id_idx";
  DROP INDEX "payload_locked_documents_rels_encounter_map_artifacts_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "encounter_maps_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "encounter_map_drafts_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "encounter_map_revisions_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "encounter_map_artifacts_id";
  DROP TYPE "public"."enum_encounter_map_drafts_scale_in_feet";
  DROP TYPE "public"."enum_encounter_map_drafts_validation_status";
  DROP TYPE "public"."enum_encounter_map_revisions_scale_in_feet";
  DROP TYPE "public"."enum_encounter_map_artifacts_kind";`)
}
