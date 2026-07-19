import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_users_role" AS ENUM('admin', 'author');
  CREATE TYPE "public"."enum_media_purpose" AS ENUM('world-map', 'location-map', 'portrait', 'token', 'handout', 'reference');
  CREATE TYPE "public"."enum_worlds_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum__worlds_v_version_status" AS ENUM('draft', 'published');
  CREATE TABLE "users_sessions" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"id" varchar PRIMARY KEY NOT NULL,
	"created_at" timestamp(3) with time zone,
	"expires_at" timestamp(3) with time zone NOT NULL
  );

  CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"auth0_subject" varchar NOT NULL,
	"role" "enum_users_role" DEFAULT 'author' NOT NULL,
	"workspace_id" integer,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"email" varchar NOT NULL,
	"reset_password_token" varchar,
	"reset_password_expiration" timestamp(3) with time zone,
	"salt" varchar,
	"hash" varchar,
	"login_attempts" numeric DEFAULT 0,
	"lock_until" timestamp(3) with time zone
  );

  CREATE TABLE "workspaces" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar NOT NULL,
	"external_id" varchar NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "media_tags" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"id" varchar PRIMARY KEY NOT NULL,
	"value" varchar NOT NULL
  );

  CREATE TABLE "media" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"alt_text" varchar NOT NULL,
	"purpose" "enum_media_purpose" NOT NULL,
	"generation_provider" varchar,
	"generation_model" varchar,
	"generation_prompt_hash" varchar,
	"generation_correlation_id" varchar,
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

  CREATE TABLE "worlds" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer,
	"external_id" varchar,
	"title" varchar,
	"body" jsonb,
	"featured_media_id" integer,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"_status" "enum_worlds_status" DEFAULT 'draft'
  );

  CREATE TABLE "worlds_rels" (
	"id" serial PRIMARY KEY NOT NULL,
	"order" integer,
	"parent_id" integer NOT NULL,
	"path" varchar NOT NULL,
	"locations_id" integer,
	"characters_id" integer
  );

  CREATE TABLE "_worlds_v" (
	"id" serial PRIMARY KEY NOT NULL,
	"parent_id" integer,
	"version_workspace_id" integer,
	"version_external_id" varchar,
	"version_title" varchar,
	"version_body" jsonb,
	"version_featured_media_id" integer,
	"version_updated_at" timestamp(3) with time zone,
	"version_created_at" timestamp(3) with time zone,
	"version__status" "enum__worlds_v_version_status" DEFAULT 'draft',
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"latest" boolean
  );

  CREATE TABLE "_worlds_v_rels" (
	"id" serial PRIMARY KEY NOT NULL,
	"order" integer,
	"parent_id" integer NOT NULL,
	"path" varchar NOT NULL,
	"locations_id" integer,
	"characters_id" integer
  );

  CREATE TABLE "locations" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"world_id" integer NOT NULL,
	"title" varchar NOT NULL,
	"description" jsonb NOT NULL,
	"map_id" integer,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "characters" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"world_id" integer NOT NULL,
	"location_id" integer NOT NULL,
	"name" varchar NOT NULL,
	"biography" jsonb NOT NULL,
	"portrait_id" integer,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "payload_kv" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" varchar NOT NULL,
	"data" jsonb NOT NULL
  );

  CREATE TABLE "payload_locked_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"global_slug" varchar,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "payload_locked_documents_rels" (
	"id" serial PRIMARY KEY NOT NULL,
	"order" integer,
	"parent_id" integer NOT NULL,
	"path" varchar NOT NULL,
	"users_id" integer,
	"workspaces_id" integer,
	"media_id" integer,
	"worlds_id" integer,
	"locations_id" integer,
	"characters_id" integer
  );

  CREATE TABLE "payload_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" varchar,
	"value" jsonb,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "payload_preferences_rels" (
	"id" serial PRIMARY KEY NOT NULL,
	"order" integer,
	"parent_id" integer NOT NULL,
	"path" varchar NOT NULL,
	"users_id" integer
  );

  CREATE TABLE "payload_migrations" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar,
	"batch" numeric,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  ALTER TABLE "users_sessions" ADD CONSTRAINT "users_sessions_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "users" ADD CONSTRAINT "users_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "media_tags" ADD CONSTRAINT "media_tags_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "media" ADD CONSTRAINT "media_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "worlds" ADD CONSTRAINT "worlds_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "worlds" ADD CONSTRAINT "worlds_featured_media_id_media_id_fk" FOREIGN KEY ("featured_media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "worlds_rels" ADD CONSTRAINT "worlds_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "worlds_rels" ADD CONSTRAINT "worlds_rels_locations_fk" FOREIGN KEY ("locations_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "worlds_rels" ADD CONSTRAINT "worlds_rels_characters_fk" FOREIGN KEY ("characters_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_worlds_v" ADD CONSTRAINT "_worlds_v_parent_id_worlds_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."worlds"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_worlds_v" ADD CONSTRAINT "_worlds_v_version_workspace_id_workspaces_id_fk" FOREIGN KEY ("version_workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_worlds_v" ADD CONSTRAINT "_worlds_v_version_featured_media_id_media_id_fk" FOREIGN KEY ("version_featured_media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_worlds_v_rels" ADD CONSTRAINT "_worlds_v_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."_worlds_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_worlds_v_rels" ADD CONSTRAINT "_worlds_v_rels_locations_fk" FOREIGN KEY ("locations_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_worlds_v_rels" ADD CONSTRAINT "_worlds_v_rels_characters_fk" FOREIGN KEY ("characters_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "locations" ADD CONSTRAINT "locations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "locations" ADD CONSTRAINT "locations_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "locations" ADD CONSTRAINT "locations_map_id_media_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "characters" ADD CONSTRAINT "characters_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "characters" ADD CONSTRAINT "characters_world_id_worlds_id_fk" FOREIGN KEY ("world_id") REFERENCES "public"."worlds"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "characters" ADD CONSTRAINT "characters_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "characters" ADD CONSTRAINT "characters_portrait_id_media_id_fk" FOREIGN KEY ("portrait_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."payload_locked_documents"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_workspaces_fk" FOREIGN KEY ("workspaces_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_media_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_worlds_fk" FOREIGN KEY ("worlds_id") REFERENCES "public"."worlds"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_locations_fk" FOREIGN KEY ("locations_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_characters_fk" FOREIGN KEY ("characters_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_preferences_rels" ADD CONSTRAINT "payload_preferences_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."payload_preferences"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_preferences_rels" ADD CONSTRAINT "payload_preferences_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "users_sessions_order_idx" ON "users_sessions" USING btree ("_order");
  CREATE INDEX "users_sessions_parent_id_idx" ON "users_sessions" USING btree ("_parent_id");
  CREATE UNIQUE INDEX "users_auth0_subject_idx" ON "users" USING btree ("auth0_subject");
  CREATE INDEX "users_workspace_idx" ON "users" USING btree ("workspace_id");
  CREATE INDEX "users_updated_at_idx" ON "users" USING btree ("updated_at");
  CREATE INDEX "users_created_at_idx" ON "users" USING btree ("created_at");
  CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");
  CREATE UNIQUE INDEX "workspaces_external_id_idx" ON "workspaces" USING btree ("external_id");
  CREATE INDEX "workspaces_updated_at_idx" ON "workspaces" USING btree ("updated_at");
  CREATE INDEX "workspaces_created_at_idx" ON "workspaces" USING btree ("created_at");
  CREATE INDEX "media_tags_order_idx" ON "media_tags" USING btree ("_order");
  CREATE INDEX "media_tags_parent_id_idx" ON "media_tags" USING btree ("_parent_id");
  CREATE INDEX "media_workspace_idx" ON "media" USING btree ("workspace_id");
  CREATE INDEX "media_generation_generation_prompt_hash_idx" ON "media" USING btree ("generation_prompt_hash");
  CREATE INDEX "media_generation_generation_correlation_id_idx" ON "media" USING btree ("generation_correlation_id");
  CREATE INDEX "media_updated_at_idx" ON "media" USING btree ("updated_at");
  CREATE INDEX "media_created_at_idx" ON "media" USING btree ("created_at");
  CREATE UNIQUE INDEX "media_filename_idx" ON "media" USING btree ("filename");
  CREATE INDEX "worlds_workspace_idx" ON "worlds" USING btree ("workspace_id");
  CREATE UNIQUE INDEX "worlds_external_id_idx" ON "worlds" USING btree ("external_id");
  CREATE INDEX "worlds_featured_media_idx" ON "worlds" USING btree ("featured_media_id");
  CREATE INDEX "worlds_updated_at_idx" ON "worlds" USING btree ("updated_at");
  CREATE INDEX "worlds_created_at_idx" ON "worlds" USING btree ("created_at");
  CREATE INDEX "worlds__status_idx" ON "worlds" USING btree ("_status");
  CREATE INDEX "worlds_rels_order_idx" ON "worlds_rels" USING btree ("order");
  CREATE INDEX "worlds_rels_parent_idx" ON "worlds_rels" USING btree ("parent_id");
  CREATE INDEX "worlds_rels_path_idx" ON "worlds_rels" USING btree ("path");
  CREATE INDEX "worlds_rels_locations_id_idx" ON "worlds_rels" USING btree ("locations_id");
  CREATE INDEX "worlds_rels_characters_id_idx" ON "worlds_rels" USING btree ("characters_id");
  CREATE INDEX "_worlds_v_parent_idx" ON "_worlds_v" USING btree ("parent_id");
  CREATE INDEX "_worlds_v_version_version_workspace_idx" ON "_worlds_v" USING btree ("version_workspace_id");
  CREATE INDEX "_worlds_v_version_version_external_id_idx" ON "_worlds_v" USING btree ("version_external_id");
  CREATE INDEX "_worlds_v_version_version_featured_media_idx" ON "_worlds_v" USING btree ("version_featured_media_id");
  CREATE INDEX "_worlds_v_version_version_updated_at_idx" ON "_worlds_v" USING btree ("version_updated_at");
  CREATE INDEX "_worlds_v_version_version_created_at_idx" ON "_worlds_v" USING btree ("version_created_at");
  CREATE INDEX "_worlds_v_version_version__status_idx" ON "_worlds_v" USING btree ("version__status");
  CREATE INDEX "_worlds_v_created_at_idx" ON "_worlds_v" USING btree ("created_at");
  CREATE INDEX "_worlds_v_updated_at_idx" ON "_worlds_v" USING btree ("updated_at");
  CREATE INDEX "_worlds_v_latest_idx" ON "_worlds_v" USING btree ("latest");
  CREATE INDEX "_worlds_v_rels_order_idx" ON "_worlds_v_rels" USING btree ("order");
  CREATE INDEX "_worlds_v_rels_parent_idx" ON "_worlds_v_rels" USING btree ("parent_id");
  CREATE INDEX "_worlds_v_rels_path_idx" ON "_worlds_v_rels" USING btree ("path");
  CREATE INDEX "_worlds_v_rels_locations_id_idx" ON "_worlds_v_rels" USING btree ("locations_id");
  CREATE INDEX "_worlds_v_rels_characters_id_idx" ON "_worlds_v_rels" USING btree ("characters_id");
  CREATE INDEX "locations_workspace_idx" ON "locations" USING btree ("workspace_id");
  CREATE INDEX "locations_world_idx" ON "locations" USING btree ("world_id");
  CREATE INDEX "locations_map_idx" ON "locations" USING btree ("map_id");
  CREATE INDEX "locations_updated_at_idx" ON "locations" USING btree ("updated_at");
  CREATE INDEX "locations_created_at_idx" ON "locations" USING btree ("created_at");
  CREATE INDEX "characters_workspace_idx" ON "characters" USING btree ("workspace_id");
  CREATE INDEX "characters_world_idx" ON "characters" USING btree ("world_id");
  CREATE INDEX "characters_location_idx" ON "characters" USING btree ("location_id");
  CREATE INDEX "characters_portrait_idx" ON "characters" USING btree ("portrait_id");
  CREATE INDEX "characters_updated_at_idx" ON "characters" USING btree ("updated_at");
  CREATE INDEX "characters_created_at_idx" ON "characters" USING btree ("created_at");
  CREATE UNIQUE INDEX "payload_kv_key_idx" ON "payload_kv" USING btree ("key");
  CREATE INDEX "payload_locked_documents_global_slug_idx" ON "payload_locked_documents" USING btree ("global_slug");
  CREATE INDEX "payload_locked_documents_updated_at_idx" ON "payload_locked_documents" USING btree ("updated_at");
  CREATE INDEX "payload_locked_documents_created_at_idx" ON "payload_locked_documents" USING btree ("created_at");
  CREATE INDEX "payload_locked_documents_rels_order_idx" ON "payload_locked_documents_rels" USING btree ("order");
  CREATE INDEX "payload_locked_documents_rels_parent_idx" ON "payload_locked_documents_rels" USING btree ("parent_id");
  CREATE INDEX "payload_locked_documents_rels_path_idx" ON "payload_locked_documents_rels" USING btree ("path");
  CREATE INDEX "payload_locked_documents_rels_users_id_idx" ON "payload_locked_documents_rels" USING btree ("users_id");
  CREATE INDEX "payload_locked_documents_rels_workspaces_id_idx" ON "payload_locked_documents_rels" USING btree ("workspaces_id");
  CREATE INDEX "payload_locked_documents_rels_media_id_idx" ON "payload_locked_documents_rels" USING btree ("media_id");
  CREATE INDEX "payload_locked_documents_rels_worlds_id_idx" ON "payload_locked_documents_rels" USING btree ("worlds_id");
  CREATE INDEX "payload_locked_documents_rels_locations_id_idx" ON "payload_locked_documents_rels" USING btree ("locations_id");
  CREATE INDEX "payload_locked_documents_rels_characters_id_idx" ON "payload_locked_documents_rels" USING btree ("characters_id");
  CREATE INDEX "payload_preferences_key_idx" ON "payload_preferences" USING btree ("key");
  CREATE INDEX "payload_preferences_updated_at_idx" ON "payload_preferences" USING btree ("updated_at");
  CREATE INDEX "payload_preferences_created_at_idx" ON "payload_preferences" USING btree ("created_at");
  CREATE INDEX "payload_preferences_rels_order_idx" ON "payload_preferences_rels" USING btree ("order");
  CREATE INDEX "payload_preferences_rels_parent_idx" ON "payload_preferences_rels" USING btree ("parent_id");
  CREATE INDEX "payload_preferences_rels_path_idx" ON "payload_preferences_rels" USING btree ("path");
  CREATE INDEX "payload_preferences_rels_users_id_idx" ON "payload_preferences_rels" USING btree ("users_id");
  CREATE INDEX "payload_migrations_updated_at_idx" ON "payload_migrations" USING btree ("updated_at");
  CREATE INDEX "payload_migrations_created_at_idx" ON "payload_migrations" USING btree ("created_at");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "users_sessions" CASCADE;
  DROP TABLE "users" CASCADE;
  DROP TABLE "workspaces" CASCADE;
  DROP TABLE "media_tags" CASCADE;
  DROP TABLE "media" CASCADE;
  DROP TABLE "worlds" CASCADE;
  DROP TABLE "worlds_rels" CASCADE;
  DROP TABLE "_worlds_v" CASCADE;
  DROP TABLE "_worlds_v_rels" CASCADE;
  DROP TABLE "locations" CASCADE;
  DROP TABLE "characters" CASCADE;
  DROP TABLE "payload_kv" CASCADE;
  DROP TABLE "payload_locked_documents" CASCADE;
  DROP TABLE "payload_locked_documents_rels" CASCADE;
  DROP TABLE "payload_preferences" CASCADE;
  DROP TABLE "payload_preferences_rels" CASCADE;
  DROP TABLE "payload_migrations" CASCADE;
  DROP TYPE "public"."enum_users_role";
  DROP TYPE "public"."enum_media_purpose";
  DROP TYPE "public"."enum_worlds_status";
  DROP TYPE "public"."enum__worlds_v_version_status";`)
}
