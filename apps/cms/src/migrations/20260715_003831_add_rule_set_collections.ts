import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_rule_sets_lifecycle" AS ENUM('active', 'deprecated', 'retired');
  CREATE TYPE "public"."enum_rule_sets_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum__rule_sets_v_version_lifecycle" AS ENUM('active', 'deprecated', 'retired');
  CREATE TYPE "public"."enum__rule_sets_v_version_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum_rule_modules_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum__rule_modules_v_version_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum_rule_definitions_definition_type" AS ENUM('entity-type', 'trait', 'field', 'catalog', 'template', 'operation', 'effect', 'event', 'constraint', 'presentation', 'fixture');
  CREATE TYPE "public"."enum_rule_definitions_visibility" AS ENUM('exported', 'private');
  CREATE TYPE "public"."enum_rule_definitions_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum__rule_definitions_v_version_definition_type" AS ENUM('entity-type', 'trait', 'field', 'catalog', 'template', 'operation', 'effect', 'event', 'constraint', 'presentation', 'fixture');
  CREATE TYPE "public"."enum__rule_definitions_v_version_visibility" AS ENUM('exported', 'private');
  CREATE TYPE "public"."enum__rule_definitions_v_version_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum_rule_generation_policies_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum__rule_generation_policies_v_version_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum_rule_releases_lifecycle" AS ENUM('published', 'deprecated', 'retired');
  CREATE TYPE "public"."enum_rule_migrations_reversibility" AS ENUM('reversible', 'checkpoint-only', 'irreversible');
  CREATE TYPE "public"."enum_rule_migrations_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum__rule_migrations_v_version_reversibility" AS ENUM('reversible', 'checkpoint-only', 'irreversible');
  CREATE TYPE "public"."enum__rule_migrations_v_version_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum_rule_documents_kind" AS ENUM('guide', 'example', 'reference', 'changelog');
  CREATE TYPE "public"."enum_rule_documents_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum__rule_documents_v_version_kind" AS ENUM('guide', 'example', 'reference', 'changelog');
  CREATE TYPE "public"."enum__rule_documents_v_version_status" AS ENUM('draft', 'published');
  CREATE TABLE "rule_sets_tags" (
    "_order" integer NOT NULL,
    "_parent_id" integer NOT NULL,
    "id" varchar PRIMARY KEY NOT NULL,
    "value" varchar
  );

  CREATE TABLE "rule_sets" (
    "id" serial PRIMARY KEY NOT NULL,
    "workspace_id" integer,
    "external_id" varchar,
    "name" varchar,
    "slug" varchar,
    "summary" varchar,
    "description" jsonb,
    "lifecycle" "enum_rule_sets_lifecycle" DEFAULT 'active',
    "engine_feature_level" varchar,
    "dashboard_icon_id" integer,
    "dashboard_accent_color" varchar,
    "dashboard_featured" boolean DEFAULT false,
    "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "_status" "enum_rule_sets_status" DEFAULT 'draft'
  );

  CREATE TABLE "_rule_sets_v_version_tags" (
    "_order" integer NOT NULL,
    "_parent_id" integer NOT NULL,
    "id" serial PRIMARY KEY NOT NULL,
    "value" varchar,
    "_uuid" varchar
  );

  CREATE TABLE "_rule_sets_v" (
    "id" serial PRIMARY KEY NOT NULL,
    "parent_id" integer,
    "version_workspace_id" integer,
    "version_external_id" varchar,
    "version_name" varchar,
    "version_slug" varchar,
    "version_summary" varchar,
    "version_description" jsonb,
    "version_lifecycle" "enum__rule_sets_v_version_lifecycle" DEFAULT 'active',
    "version_engine_feature_level" varchar,
    "version_dashboard_icon_id" integer,
    "version_dashboard_accent_color" varchar,
    "version_dashboard_featured" boolean DEFAULT false,
    "version_updated_at" timestamp(3) with time zone,
    "version_created_at" timestamp(3) with time zone,
    "version__status" "enum__rule_sets_v_version_status" DEFAULT 'draft',
    "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "latest" boolean
  );

  CREATE TABLE "rule_modules" (
    "id" serial PRIMARY KEY NOT NULL,
    "workspace_id" integer,
    "rule_set_id" integer,
    "external_id" varchar,
    "namespace" varchar,
    "name" varchar,
    "description" jsonb,
    "sort_order" numeric DEFAULT 0,
    "required_engine_feature_level" varchar,
    "dependencies" jsonb DEFAULT '[]'::jsonb,
    "exports" jsonb DEFAULT '[]'::jsonb,
    "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "_status" "enum_rule_modules_status" DEFAULT 'draft'
  );

  CREATE TABLE "_rule_modules_v" (
    "id" serial PRIMARY KEY NOT NULL,
    "parent_id" integer,
    "version_workspace_id" integer,
    "version_rule_set_id" integer,
    "version_external_id" varchar,
    "version_namespace" varchar,
    "version_name" varchar,
    "version_description" jsonb,
    "version_sort_order" numeric DEFAULT 0,
    "version_required_engine_feature_level" varchar,
    "version_dependencies" jsonb DEFAULT '[]'::jsonb,
    "version_exports" jsonb DEFAULT '[]'::jsonb,
    "version_updated_at" timestamp(3) with time zone,
    "version_created_at" timestamp(3) with time zone,
    "version__status" "enum__rule_modules_v_version_status" DEFAULT 'draft',
    "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "latest" boolean
  );

  CREATE TABLE "rule_definitions_tags" (
    "_order" integer NOT NULL,
    "_parent_id" integer NOT NULL,
    "id" varchar PRIMARY KEY NOT NULL,
    "value" varchar
  );

  CREATE TABLE "rule_definitions" (
    "id" serial PRIMARY KEY NOT NULL,
    "workspace_id" integer,
    "rule_set_id" integer,
    "module_id" integer,
    "external_id" varchar,
    "definition_type" "enum_rule_definitions_definition_type",
    "name" varchar,
    "description" jsonb,
    "schema_version" numeric DEFAULT 1,
    "visibility" "enum_rule_definitions_visibility" DEFAULT 'exported',
    "body" jsonb,
    "presentation" jsonb,
    "cloned_from_id" integer,
    "provenance" jsonb,
    "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "_status" "enum_rule_definitions_status" DEFAULT 'draft'
  );

  CREATE TABLE "_rule_definitions_v_version_tags" (
    "_order" integer NOT NULL,
    "_parent_id" integer NOT NULL,
    "id" serial PRIMARY KEY NOT NULL,
    "value" varchar,
    "_uuid" varchar
  );

  CREATE TABLE "_rule_definitions_v" (
    "id" serial PRIMARY KEY NOT NULL,
    "parent_id" integer,
    "version_workspace_id" integer,
    "version_rule_set_id" integer,
    "version_module_id" integer,
    "version_external_id" varchar,
    "version_definition_type" "enum__rule_definitions_v_version_definition_type",
    "version_name" varchar,
    "version_description" jsonb,
    "version_schema_version" numeric DEFAULT 1,
    "version_visibility" "enum__rule_definitions_v_version_visibility" DEFAULT 'exported',
    "version_body" jsonb,
    "version_presentation" jsonb,
    "version_cloned_from_id" integer,
    "version_provenance" jsonb,
    "version_updated_at" timestamp(3) with time zone,
    "version_created_at" timestamp(3) with time zone,
    "version__status" "enum__rule_definitions_v_version_status" DEFAULT 'draft',
    "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "latest" boolean
  );

  CREATE TABLE "rule_generation_policies" (
    "id" serial PRIMARY KEY NOT NULL,
    "workspace_id" integer,
    "rule_set_id" integer,
    "module_id" integer,
    "external_id" varchar,
    "name" varchar,
    "description" jsonb,
    "capabilities" jsonb DEFAULT '[]'::jsonb,
    "artifact_kinds" jsonb DEFAULT '[]'::jsonb,
    "prohibitions" jsonb DEFAULT '[]'::jsonb,
    "policy" jsonb,
    "schema_version" numeric DEFAULT 1,
    "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "_status" "enum_rule_generation_policies_status" DEFAULT 'draft'
  );

  CREATE TABLE "_rule_generation_policies_v" (
    "id" serial PRIMARY KEY NOT NULL,
    "parent_id" integer,
    "version_workspace_id" integer,
    "version_rule_set_id" integer,
    "version_module_id" integer,
    "version_external_id" varchar,
    "version_name" varchar,
    "version_description" jsonb,
    "version_capabilities" jsonb DEFAULT '[]'::jsonb,
    "version_artifact_kinds" jsonb DEFAULT '[]'::jsonb,
    "version_prohibitions" jsonb DEFAULT '[]'::jsonb,
    "version_policy" jsonb,
    "version_schema_version" numeric DEFAULT 1,
    "version_updated_at" timestamp(3) with time zone,
    "version_created_at" timestamp(3) with time zone,
    "version__status" "enum__rule_generation_policies_v_version_status" DEFAULT 'draft',
    "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "latest" boolean
  );

  CREATE TABLE "rule_releases" (
    "id" serial PRIMARY KEY NOT NULL,
    "workspace_id" integer NOT NULL,
    "rule_set_id" integer NOT NULL,
    "external_id" varchar NOT NULL,
    "version" varchar NOT NULL,
    "content_hash" varchar NOT NULL,
    "engine_compatibility" jsonb NOT NULL,
    "dependency_lock" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "manifest" jsonb NOT NULL,
    "source_snapshot" jsonb NOT NULL,
    "published_by_id" integer NOT NULL,
    "published_at" timestamp(3) with time zone NOT NULL,
    "release_notes" jsonb,
    "lifecycle" "enum_rule_releases_lifecycle" DEFAULT 'published' NOT NULL,
    "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );

  CREATE TABLE "rule_migrations" (
    "id" serial PRIMARY KEY NOT NULL,
    "workspace_id" integer,
    "rule_set_id" integer,
    "external_id" varchar,
    "name" varchar,
    "source_release_id" integer,
    "target_release_id" integer,
    "transformations" jsonb,
    "rehearsal" jsonb,
    "reversibility" "enum_rule_migrations_reversibility" DEFAULT 'reversible',
    "schema_version" numeric DEFAULT 1,
    "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "_status" "enum_rule_migrations_status" DEFAULT 'draft'
  );

  CREATE TABLE "_rule_migrations_v" (
    "id" serial PRIMARY KEY NOT NULL,
    "parent_id" integer,
    "version_workspace_id" integer,
    "version_rule_set_id" integer,
    "version_external_id" varchar,
    "version_name" varchar,
    "version_source_release_id" integer,
    "version_target_release_id" integer,
    "version_transformations" jsonb,
    "version_rehearsal" jsonb,
    "version_reversibility" "enum__rule_migrations_v_version_reversibility" DEFAULT 'reversible',
    "version_schema_version" numeric DEFAULT 1,
    "version_updated_at" timestamp(3) with time zone,
    "version_created_at" timestamp(3) with time zone,
    "version__status" "enum__rule_migrations_v_version_status" DEFAULT 'draft',
    "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "latest" boolean
  );

  CREATE TABLE "rule_documents" (
    "id" serial PRIMARY KEY NOT NULL,
    "workspace_id" integer,
    "rule_set_id" integer,
    "module_id" integer,
    "external_id" varchar,
    "title" varchar,
    "kind" "enum_rule_documents_kind" DEFAULT 'guide',
    "body" jsonb,
    "sort_order" numeric DEFAULT 0,
    "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "_status" "enum_rule_documents_status" DEFAULT 'draft'
  );

  CREATE TABLE "_rule_documents_v" (
    "id" serial PRIMARY KEY NOT NULL,
    "parent_id" integer,
    "version_workspace_id" integer,
    "version_rule_set_id" integer,
    "version_module_id" integer,
    "version_external_id" varchar,
    "version_title" varchar,
    "version_kind" "enum__rule_documents_v_version_kind" DEFAULT 'guide',
    "version_body" jsonb,
    "version_sort_order" numeric DEFAULT 0,
    "version_updated_at" timestamp(3) with time zone,
    "version_created_at" timestamp(3) with time zone,
    "version__status" "enum__rule_documents_v_version_status" DEFAULT 'draft',
    "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
    "latest" boolean
  );

  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "rule_sets_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "rule_modules_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "rule_definitions_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "rule_generation_policies_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "rule_releases_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "rule_migrations_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "rule_documents_id" integer;
  ALTER TABLE "rule_sets_tags" ADD CONSTRAINT "rule_sets_tags_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."rule_sets"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "rule_sets" ADD CONSTRAINT "rule_sets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "rule_sets" ADD CONSTRAINT "rule_sets_dashboard_icon_id_media_id_fk" FOREIGN KEY ("dashboard_icon_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_rule_sets_v_version_tags" ADD CONSTRAINT "_rule_sets_v_version_tags_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_rule_sets_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_rule_sets_v" ADD CONSTRAINT "_rule_sets_v_parent_id_rule_sets_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."rule_sets"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_rule_sets_v" ADD CONSTRAINT "_rule_sets_v_version_workspace_id_workspaces_id_fk" FOREIGN KEY ("version_workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_rule_sets_v" ADD CONSTRAINT "_rule_sets_v_version_dashboard_icon_id_media_id_fk" FOREIGN KEY ("version_dashboard_icon_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "rule_modules" ADD CONSTRAINT "rule_modules_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "rule_modules" ADD CONSTRAINT "rule_modules_rule_set_id_rule_sets_id_fk" FOREIGN KEY ("rule_set_id") REFERENCES "public"."rule_sets"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_rule_modules_v" ADD CONSTRAINT "_rule_modules_v_parent_id_rule_modules_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."rule_modules"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_rule_modules_v" ADD CONSTRAINT "_rule_modules_v_version_workspace_id_workspaces_id_fk" FOREIGN KEY ("version_workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_rule_modules_v" ADD CONSTRAINT "_rule_modules_v_version_rule_set_id_rule_sets_id_fk" FOREIGN KEY ("version_rule_set_id") REFERENCES "public"."rule_sets"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "rule_definitions_tags" ADD CONSTRAINT "rule_definitions_tags_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."rule_definitions"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "rule_definitions" ADD CONSTRAINT "rule_definitions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "rule_definitions" ADD CONSTRAINT "rule_definitions_rule_set_id_rule_sets_id_fk" FOREIGN KEY ("rule_set_id") REFERENCES "public"."rule_sets"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "rule_definitions" ADD CONSTRAINT "rule_definitions_module_id_rule_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."rule_modules"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "rule_definitions" ADD CONSTRAINT "rule_definitions_cloned_from_id_rule_definitions_id_fk" FOREIGN KEY ("cloned_from_id") REFERENCES "public"."rule_definitions"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_rule_definitions_v_version_tags" ADD CONSTRAINT "_rule_definitions_v_version_tags_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_rule_definitions_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_rule_definitions_v" ADD CONSTRAINT "_rule_definitions_v_parent_id_rule_definitions_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."rule_definitions"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_rule_definitions_v" ADD CONSTRAINT "_rule_definitions_v_version_workspace_id_workspaces_id_fk" FOREIGN KEY ("version_workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_rule_definitions_v" ADD CONSTRAINT "_rule_definitions_v_version_rule_set_id_rule_sets_id_fk" FOREIGN KEY ("version_rule_set_id") REFERENCES "public"."rule_sets"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_rule_definitions_v" ADD CONSTRAINT "_rule_definitions_v_version_module_id_rule_modules_id_fk" FOREIGN KEY ("version_module_id") REFERENCES "public"."rule_modules"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_rule_definitions_v" ADD CONSTRAINT "_rule_definitions_v_version_cloned_from_id_rule_definitions_id_fk" FOREIGN KEY ("version_cloned_from_id") REFERENCES "public"."rule_definitions"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "rule_generation_policies" ADD CONSTRAINT "rule_generation_policies_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "rule_generation_policies" ADD CONSTRAINT "rule_generation_policies_rule_set_id_rule_sets_id_fk" FOREIGN KEY ("rule_set_id") REFERENCES "public"."rule_sets"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "rule_generation_policies" ADD CONSTRAINT "rule_generation_policies_module_id_rule_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."rule_modules"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_rule_generation_policies_v" ADD CONSTRAINT "_rule_generation_policies_v_parent_id_rule_generation_policies_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."rule_generation_policies"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_rule_generation_policies_v" ADD CONSTRAINT "_rule_generation_policies_v_version_workspace_id_workspaces_id_fk" FOREIGN KEY ("version_workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_rule_generation_policies_v" ADD CONSTRAINT "_rule_generation_policies_v_version_rule_set_id_rule_sets_id_fk" FOREIGN KEY ("version_rule_set_id") REFERENCES "public"."rule_sets"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_rule_generation_policies_v" ADD CONSTRAINT "_rule_generation_policies_v_version_module_id_rule_modules_id_fk" FOREIGN KEY ("version_module_id") REFERENCES "public"."rule_modules"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "rule_releases" ADD CONSTRAINT "rule_releases_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "rule_releases" ADD CONSTRAINT "rule_releases_rule_set_id_rule_sets_id_fk" FOREIGN KEY ("rule_set_id") REFERENCES "public"."rule_sets"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "rule_releases" ADD CONSTRAINT "rule_releases_published_by_id_users_id_fk" FOREIGN KEY ("published_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "rule_migrations" ADD CONSTRAINT "rule_migrations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "rule_migrations" ADD CONSTRAINT "rule_migrations_rule_set_id_rule_sets_id_fk" FOREIGN KEY ("rule_set_id") REFERENCES "public"."rule_sets"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "rule_migrations" ADD CONSTRAINT "rule_migrations_source_release_id_rule_releases_id_fk" FOREIGN KEY ("source_release_id") REFERENCES "public"."rule_releases"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "rule_migrations" ADD CONSTRAINT "rule_migrations_target_release_id_rule_releases_id_fk" FOREIGN KEY ("target_release_id") REFERENCES "public"."rule_releases"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_rule_migrations_v" ADD CONSTRAINT "_rule_migrations_v_parent_id_rule_migrations_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."rule_migrations"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_rule_migrations_v" ADD CONSTRAINT "_rule_migrations_v_version_workspace_id_workspaces_id_fk" FOREIGN KEY ("version_workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_rule_migrations_v" ADD CONSTRAINT "_rule_migrations_v_version_rule_set_id_rule_sets_id_fk" FOREIGN KEY ("version_rule_set_id") REFERENCES "public"."rule_sets"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_rule_migrations_v" ADD CONSTRAINT "_rule_migrations_v_version_source_release_id_rule_releases_id_fk" FOREIGN KEY ("version_source_release_id") REFERENCES "public"."rule_releases"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_rule_migrations_v" ADD CONSTRAINT "_rule_migrations_v_version_target_release_id_rule_releases_id_fk" FOREIGN KEY ("version_target_release_id") REFERENCES "public"."rule_releases"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "rule_documents" ADD CONSTRAINT "rule_documents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "rule_documents" ADD CONSTRAINT "rule_documents_rule_set_id_rule_sets_id_fk" FOREIGN KEY ("rule_set_id") REFERENCES "public"."rule_sets"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "rule_documents" ADD CONSTRAINT "rule_documents_module_id_rule_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."rule_modules"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_rule_documents_v" ADD CONSTRAINT "_rule_documents_v_parent_id_rule_documents_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."rule_documents"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_rule_documents_v" ADD CONSTRAINT "_rule_documents_v_version_workspace_id_workspaces_id_fk" FOREIGN KEY ("version_workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_rule_documents_v" ADD CONSTRAINT "_rule_documents_v_version_rule_set_id_rule_sets_id_fk" FOREIGN KEY ("version_rule_set_id") REFERENCES "public"."rule_sets"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_rule_documents_v" ADD CONSTRAINT "_rule_documents_v_version_module_id_rule_modules_id_fk" FOREIGN KEY ("version_module_id") REFERENCES "public"."rule_modules"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "rule_sets_tags_order_idx" ON "rule_sets_tags" USING btree ("_order");
  CREATE INDEX "rule_sets_tags_parent_id_idx" ON "rule_sets_tags" USING btree ("_parent_id");
  CREATE INDEX "rule_sets_workspace_idx" ON "rule_sets" USING btree ("workspace_id");
  CREATE UNIQUE INDEX "rule_sets_external_id_idx" ON "rule_sets" USING btree ("external_id");
  CREATE INDEX "rule_sets_name_idx" ON "rule_sets" USING btree ("name");
  CREATE INDEX "rule_sets_slug_idx" ON "rule_sets" USING btree ("slug");
  CREATE INDEX "rule_sets_lifecycle_idx" ON "rule_sets" USING btree ("lifecycle");
  CREATE INDEX "rule_sets_dashboard_dashboard_icon_idx" ON "rule_sets" USING btree ("dashboard_icon_id");
  CREATE INDEX "rule_sets_updated_at_idx" ON "rule_sets" USING btree ("updated_at");
  CREATE INDEX "rule_sets_created_at_idx" ON "rule_sets" USING btree ("created_at");
  CREATE INDEX "rule_sets__status_idx" ON "rule_sets" USING btree ("_status");
  CREATE INDEX "_rule_sets_v_version_tags_order_idx" ON "_rule_sets_v_version_tags" USING btree ("_order");
  CREATE INDEX "_rule_sets_v_version_tags_parent_id_idx" ON "_rule_sets_v_version_tags" USING btree ("_parent_id");
  CREATE INDEX "_rule_sets_v_parent_idx" ON "_rule_sets_v" USING btree ("parent_id");
  CREATE INDEX "_rule_sets_v_version_version_workspace_idx" ON "_rule_sets_v" USING btree ("version_workspace_id");
  CREATE INDEX "_rule_sets_v_version_version_external_id_idx" ON "_rule_sets_v" USING btree ("version_external_id");
  CREATE INDEX "_rule_sets_v_version_version_name_idx" ON "_rule_sets_v" USING btree ("version_name");
  CREATE INDEX "_rule_sets_v_version_version_slug_idx" ON "_rule_sets_v" USING btree ("version_slug");
  CREATE INDEX "_rule_sets_v_version_version_lifecycle_idx" ON "_rule_sets_v" USING btree ("version_lifecycle");
  CREATE INDEX "_rule_sets_v_version_dashboard_version_dashboard_icon_idx" ON "_rule_sets_v" USING btree ("version_dashboard_icon_id");
  CREATE INDEX "_rule_sets_v_version_version_updated_at_idx" ON "_rule_sets_v" USING btree ("version_updated_at");
  CREATE INDEX "_rule_sets_v_version_version_created_at_idx" ON "_rule_sets_v" USING btree ("version_created_at");
  CREATE INDEX "_rule_sets_v_version_version__status_idx" ON "_rule_sets_v" USING btree ("version__status");
  CREATE INDEX "_rule_sets_v_created_at_idx" ON "_rule_sets_v" USING btree ("created_at");
  CREATE INDEX "_rule_sets_v_updated_at_idx" ON "_rule_sets_v" USING btree ("updated_at");
  CREATE INDEX "_rule_sets_v_latest_idx" ON "_rule_sets_v" USING btree ("latest");
  CREATE INDEX "rule_modules_workspace_idx" ON "rule_modules" USING btree ("workspace_id");
  CREATE INDEX "rule_modules_rule_set_idx" ON "rule_modules" USING btree ("rule_set_id");
  CREATE UNIQUE INDEX "rule_modules_external_id_idx" ON "rule_modules" USING btree ("external_id");
  CREATE INDEX "rule_modules_namespace_idx" ON "rule_modules" USING btree ("namespace");
  CREATE INDEX "rule_modules_name_idx" ON "rule_modules" USING btree ("name");
  CREATE INDEX "rule_modules_updated_at_idx" ON "rule_modules" USING btree ("updated_at");
  CREATE INDEX "rule_modules_created_at_idx" ON "rule_modules" USING btree ("created_at");
  CREATE INDEX "rule_modules__status_idx" ON "rule_modules" USING btree ("_status");
  CREATE INDEX "_rule_modules_v_parent_idx" ON "_rule_modules_v" USING btree ("parent_id");
  CREATE INDEX "_rule_modules_v_version_version_workspace_idx" ON "_rule_modules_v" USING btree ("version_workspace_id");
  CREATE INDEX "_rule_modules_v_version_version_rule_set_idx" ON "_rule_modules_v" USING btree ("version_rule_set_id");
  CREATE INDEX "_rule_modules_v_version_version_external_id_idx" ON "_rule_modules_v" USING btree ("version_external_id");
  CREATE INDEX "_rule_modules_v_version_version_namespace_idx" ON "_rule_modules_v" USING btree ("version_namespace");
  CREATE INDEX "_rule_modules_v_version_version_name_idx" ON "_rule_modules_v" USING btree ("version_name");
  CREATE INDEX "_rule_modules_v_version_version_updated_at_idx" ON "_rule_modules_v" USING btree ("version_updated_at");
  CREATE INDEX "_rule_modules_v_version_version_created_at_idx" ON "_rule_modules_v" USING btree ("version_created_at");
  CREATE INDEX "_rule_modules_v_version_version__status_idx" ON "_rule_modules_v" USING btree ("version__status");
  CREATE INDEX "_rule_modules_v_created_at_idx" ON "_rule_modules_v" USING btree ("created_at");
  CREATE INDEX "_rule_modules_v_updated_at_idx" ON "_rule_modules_v" USING btree ("updated_at");
  CREATE INDEX "_rule_modules_v_latest_idx" ON "_rule_modules_v" USING btree ("latest");
  CREATE INDEX "rule_definitions_tags_order_idx" ON "rule_definitions_tags" USING btree ("_order");
  CREATE INDEX "rule_definitions_tags_parent_id_idx" ON "rule_definitions_tags" USING btree ("_parent_id");
  CREATE INDEX "rule_definitions_workspace_idx" ON "rule_definitions" USING btree ("workspace_id");
  CREATE INDEX "rule_definitions_rule_set_idx" ON "rule_definitions" USING btree ("rule_set_id");
  CREATE INDEX "rule_definitions_module_idx" ON "rule_definitions" USING btree ("module_id");
  CREATE UNIQUE INDEX "rule_definitions_external_id_idx" ON "rule_definitions" USING btree ("external_id");
  CREATE INDEX "rule_definitions_definition_type_idx" ON "rule_definitions" USING btree ("definition_type");
  CREATE INDEX "rule_definitions_name_idx" ON "rule_definitions" USING btree ("name");
  CREATE INDEX "rule_definitions_cloned_from_idx" ON "rule_definitions" USING btree ("cloned_from_id");
  CREATE INDEX "rule_definitions_updated_at_idx" ON "rule_definitions" USING btree ("updated_at");
  CREATE INDEX "rule_definitions_created_at_idx" ON "rule_definitions" USING btree ("created_at");
  CREATE INDEX "rule_definitions__status_idx" ON "rule_definitions" USING btree ("_status");
  CREATE INDEX "_rule_definitions_v_version_tags_order_idx" ON "_rule_definitions_v_version_tags" USING btree ("_order");
  CREATE INDEX "_rule_definitions_v_version_tags_parent_id_idx" ON "_rule_definitions_v_version_tags" USING btree ("_parent_id");
  CREATE INDEX "_rule_definitions_v_parent_idx" ON "_rule_definitions_v" USING btree ("parent_id");
  CREATE INDEX "_rule_definitions_v_version_version_workspace_idx" ON "_rule_definitions_v" USING btree ("version_workspace_id");
  CREATE INDEX "_rule_definitions_v_version_version_rule_set_idx" ON "_rule_definitions_v" USING btree ("version_rule_set_id");
  CREATE INDEX "_rule_definitions_v_version_version_module_idx" ON "_rule_definitions_v" USING btree ("version_module_id");
  CREATE INDEX "_rule_definitions_v_version_version_external_id_idx" ON "_rule_definitions_v" USING btree ("version_external_id");
  CREATE INDEX "_rule_definitions_v_version_version_definition_type_idx" ON "_rule_definitions_v" USING btree ("version_definition_type");
  CREATE INDEX "_rule_definitions_v_version_version_name_idx" ON "_rule_definitions_v" USING btree ("version_name");
  CREATE INDEX "_rule_definitions_v_version_version_cloned_from_idx" ON "_rule_definitions_v" USING btree ("version_cloned_from_id");
  CREATE INDEX "_rule_definitions_v_version_version_updated_at_idx" ON "_rule_definitions_v" USING btree ("version_updated_at");
  CREATE INDEX "_rule_definitions_v_version_version_created_at_idx" ON "_rule_definitions_v" USING btree ("version_created_at");
  CREATE INDEX "_rule_definitions_v_version_version__status_idx" ON "_rule_definitions_v" USING btree ("version__status");
  CREATE INDEX "_rule_definitions_v_created_at_idx" ON "_rule_definitions_v" USING btree ("created_at");
  CREATE INDEX "_rule_definitions_v_updated_at_idx" ON "_rule_definitions_v" USING btree ("updated_at");
  CREATE INDEX "_rule_definitions_v_latest_idx" ON "_rule_definitions_v" USING btree ("latest");
  CREATE INDEX "rule_generation_policies_workspace_idx" ON "rule_generation_policies" USING btree ("workspace_id");
  CREATE INDEX "rule_generation_policies_rule_set_idx" ON "rule_generation_policies" USING btree ("rule_set_id");
  CREATE INDEX "rule_generation_policies_module_idx" ON "rule_generation_policies" USING btree ("module_id");
  CREATE UNIQUE INDEX "rule_generation_policies_external_id_idx" ON "rule_generation_policies" USING btree ("external_id");
  CREATE INDEX "rule_generation_policies_name_idx" ON "rule_generation_policies" USING btree ("name");
  CREATE INDEX "rule_generation_policies_updated_at_idx" ON "rule_generation_policies" USING btree ("updated_at");
  CREATE INDEX "rule_generation_policies_created_at_idx" ON "rule_generation_policies" USING btree ("created_at");
  CREATE INDEX "rule_generation_policies__status_idx" ON "rule_generation_policies" USING btree ("_status");
  CREATE INDEX "_rule_generation_policies_v_parent_idx" ON "_rule_generation_policies_v" USING btree ("parent_id");
  CREATE INDEX "_rule_generation_policies_v_version_version_workspace_idx" ON "_rule_generation_policies_v" USING btree ("version_workspace_id");
  CREATE INDEX "_rule_generation_policies_v_version_version_rule_set_idx" ON "_rule_generation_policies_v" USING btree ("version_rule_set_id");
  CREATE INDEX "_rule_generation_policies_v_version_version_module_idx" ON "_rule_generation_policies_v" USING btree ("version_module_id");
  CREATE INDEX "_rule_generation_policies_v_version_version_external_id_idx" ON "_rule_generation_policies_v" USING btree ("version_external_id");
  CREATE INDEX "_rule_generation_policies_v_version_version_name_idx" ON "_rule_generation_policies_v" USING btree ("version_name");
  CREATE INDEX "_rule_generation_policies_v_version_version_updated_at_idx" ON "_rule_generation_policies_v" USING btree ("version_updated_at");
  CREATE INDEX "_rule_generation_policies_v_version_version_created_at_idx" ON "_rule_generation_policies_v" USING btree ("version_created_at");
  CREATE INDEX "_rule_generation_policies_v_version_version__status_idx" ON "_rule_generation_policies_v" USING btree ("version__status");
  CREATE INDEX "_rule_generation_policies_v_created_at_idx" ON "_rule_generation_policies_v" USING btree ("created_at");
  CREATE INDEX "_rule_generation_policies_v_updated_at_idx" ON "_rule_generation_policies_v" USING btree ("updated_at");
  CREATE INDEX "_rule_generation_policies_v_latest_idx" ON "_rule_generation_policies_v" USING btree ("latest");
  CREATE INDEX "rule_releases_workspace_idx" ON "rule_releases" USING btree ("workspace_id");
  CREATE INDEX "rule_releases_rule_set_idx" ON "rule_releases" USING btree ("rule_set_id");
  CREATE UNIQUE INDEX "rule_releases_external_id_idx" ON "rule_releases" USING btree ("external_id");
  CREATE INDEX "rule_releases_version_idx" ON "rule_releases" USING btree ("version");
  CREATE INDEX "rule_releases_content_hash_idx" ON "rule_releases" USING btree ("content_hash");
  CREATE INDEX "rule_releases_published_by_idx" ON "rule_releases" USING btree ("published_by_id");
  CREATE INDEX "rule_releases_published_at_idx" ON "rule_releases" USING btree ("published_at");
  CREATE INDEX "rule_releases_lifecycle_idx" ON "rule_releases" USING btree ("lifecycle");
  CREATE INDEX "rule_releases_updated_at_idx" ON "rule_releases" USING btree ("updated_at");
  CREATE INDEX "rule_releases_created_at_idx" ON "rule_releases" USING btree ("created_at");
  CREATE INDEX "rule_migrations_workspace_idx" ON "rule_migrations" USING btree ("workspace_id");
  CREATE INDEX "rule_migrations_rule_set_idx" ON "rule_migrations" USING btree ("rule_set_id");
  CREATE UNIQUE INDEX "rule_migrations_external_id_idx" ON "rule_migrations" USING btree ("external_id");
  CREATE INDEX "rule_migrations_source_release_idx" ON "rule_migrations" USING btree ("source_release_id");
  CREATE INDEX "rule_migrations_target_release_idx" ON "rule_migrations" USING btree ("target_release_id");
  CREATE INDEX "rule_migrations_updated_at_idx" ON "rule_migrations" USING btree ("updated_at");
  CREATE INDEX "rule_migrations_created_at_idx" ON "rule_migrations" USING btree ("created_at");
  CREATE INDEX "rule_migrations__status_idx" ON "rule_migrations" USING btree ("_status");
  CREATE INDEX "_rule_migrations_v_parent_idx" ON "_rule_migrations_v" USING btree ("parent_id");
  CREATE INDEX "_rule_migrations_v_version_version_workspace_idx" ON "_rule_migrations_v" USING btree ("version_workspace_id");
  CREATE INDEX "_rule_migrations_v_version_version_rule_set_idx" ON "_rule_migrations_v" USING btree ("version_rule_set_id");
  CREATE INDEX "_rule_migrations_v_version_version_external_id_idx" ON "_rule_migrations_v" USING btree ("version_external_id");
  CREATE INDEX "_rule_migrations_v_version_version_source_release_idx" ON "_rule_migrations_v" USING btree ("version_source_release_id");
  CREATE INDEX "_rule_migrations_v_version_version_target_release_idx" ON "_rule_migrations_v" USING btree ("version_target_release_id");
  CREATE INDEX "_rule_migrations_v_version_version_updated_at_idx" ON "_rule_migrations_v" USING btree ("version_updated_at");
  CREATE INDEX "_rule_migrations_v_version_version_created_at_idx" ON "_rule_migrations_v" USING btree ("version_created_at");
  CREATE INDEX "_rule_migrations_v_version_version__status_idx" ON "_rule_migrations_v" USING btree ("version__status");
  CREATE INDEX "_rule_migrations_v_created_at_idx" ON "_rule_migrations_v" USING btree ("created_at");
  CREATE INDEX "_rule_migrations_v_updated_at_idx" ON "_rule_migrations_v" USING btree ("updated_at");
  CREATE INDEX "_rule_migrations_v_latest_idx" ON "_rule_migrations_v" USING btree ("latest");
  CREATE INDEX "rule_documents_workspace_idx" ON "rule_documents" USING btree ("workspace_id");
  CREATE INDEX "rule_documents_rule_set_idx" ON "rule_documents" USING btree ("rule_set_id");
  CREATE INDEX "rule_documents_module_idx" ON "rule_documents" USING btree ("module_id");
  CREATE UNIQUE INDEX "rule_documents_external_id_idx" ON "rule_documents" USING btree ("external_id");
  CREATE INDEX "rule_documents_title_idx" ON "rule_documents" USING btree ("title");
  CREATE INDEX "rule_documents_updated_at_idx" ON "rule_documents" USING btree ("updated_at");
  CREATE INDEX "rule_documents_created_at_idx" ON "rule_documents" USING btree ("created_at");
  CREATE INDEX "rule_documents__status_idx" ON "rule_documents" USING btree ("_status");
  CREATE INDEX "_rule_documents_v_parent_idx" ON "_rule_documents_v" USING btree ("parent_id");
  CREATE INDEX "_rule_documents_v_version_version_workspace_idx" ON "_rule_documents_v" USING btree ("version_workspace_id");
  CREATE INDEX "_rule_documents_v_version_version_rule_set_idx" ON "_rule_documents_v" USING btree ("version_rule_set_id");
  CREATE INDEX "_rule_documents_v_version_version_module_idx" ON "_rule_documents_v" USING btree ("version_module_id");
  CREATE INDEX "_rule_documents_v_version_version_external_id_idx" ON "_rule_documents_v" USING btree ("version_external_id");
  CREATE INDEX "_rule_documents_v_version_version_title_idx" ON "_rule_documents_v" USING btree ("version_title");
  CREATE INDEX "_rule_documents_v_version_version_updated_at_idx" ON "_rule_documents_v" USING btree ("version_updated_at");
  CREATE INDEX "_rule_documents_v_version_version_created_at_idx" ON "_rule_documents_v" USING btree ("version_created_at");
  CREATE INDEX "_rule_documents_v_version_version__status_idx" ON "_rule_documents_v" USING btree ("version__status");
  CREATE INDEX "_rule_documents_v_created_at_idx" ON "_rule_documents_v" USING btree ("created_at");
  CREATE INDEX "_rule_documents_v_updated_at_idx" ON "_rule_documents_v" USING btree ("updated_at");
  CREATE INDEX "_rule_documents_v_latest_idx" ON "_rule_documents_v" USING btree ("latest");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_rule_sets_fk" FOREIGN KEY ("rule_sets_id") REFERENCES "public"."rule_sets"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_rule_modules_fk" FOREIGN KEY ("rule_modules_id") REFERENCES "public"."rule_modules"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_rule_definitions_fk" FOREIGN KEY ("rule_definitions_id") REFERENCES "public"."rule_definitions"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_rule_generation_policies_fk" FOREIGN KEY ("rule_generation_policies_id") REFERENCES "public"."rule_generation_policies"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_rule_releases_fk" FOREIGN KEY ("rule_releases_id") REFERENCES "public"."rule_releases"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_rule_migrations_fk" FOREIGN KEY ("rule_migrations_id") REFERENCES "public"."rule_migrations"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_rule_documents_fk" FOREIGN KEY ("rule_documents_id") REFERENCES "public"."rule_documents"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_rule_sets_id_idx" ON "payload_locked_documents_rels" USING btree ("rule_sets_id");
  CREATE INDEX "payload_locked_documents_rels_rule_modules_id_idx" ON "payload_locked_documents_rels" USING btree ("rule_modules_id");
  CREATE INDEX "payload_locked_documents_rels_rule_definitions_id_idx" ON "payload_locked_documents_rels" USING btree ("rule_definitions_id");
  CREATE INDEX "payload_locked_documents_rels_rule_generation_policies_i_idx" ON "payload_locked_documents_rels" USING btree ("rule_generation_policies_id");
  CREATE INDEX "payload_locked_documents_rels_rule_releases_id_idx" ON "payload_locked_documents_rels" USING btree ("rule_releases_id");
  CREATE INDEX "payload_locked_documents_rels_rule_migrations_id_idx" ON "payload_locked_documents_rels" USING btree ("rule_migrations_id");
  CREATE INDEX "payload_locked_documents_rels_rule_documents_id_idx" ON "payload_locked_documents_rels" USING btree ("rule_documents_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "rule_sets_tags" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "rule_sets" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_rule_sets_v_version_tags" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_rule_sets_v" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "rule_modules" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_rule_modules_v" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "rule_definitions_tags" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "rule_definitions" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_rule_definitions_v_version_tags" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_rule_definitions_v" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "rule_generation_policies" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_rule_generation_policies_v" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "rule_releases" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "rule_migrations" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_rule_migrations_v" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "rule_documents" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_rule_documents_v" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "rule_sets_tags" CASCADE;
  DROP TABLE "rule_sets" CASCADE;
  DROP TABLE "_rule_sets_v_version_tags" CASCADE;
  DROP TABLE "_rule_sets_v" CASCADE;
  DROP TABLE "rule_modules" CASCADE;
  DROP TABLE "_rule_modules_v" CASCADE;
  DROP TABLE "rule_definitions_tags" CASCADE;
  DROP TABLE "rule_definitions" CASCADE;
  DROP TABLE "_rule_definitions_v_version_tags" CASCADE;
  DROP TABLE "_rule_definitions_v" CASCADE;
  DROP TABLE "rule_generation_policies" CASCADE;
  DROP TABLE "_rule_generation_policies_v" CASCADE;
  DROP TABLE "rule_releases" CASCADE;
  DROP TABLE "rule_migrations" CASCADE;
  DROP TABLE "_rule_migrations_v" CASCADE;
  DROP TABLE "rule_documents" CASCADE;
  DROP TABLE "_rule_documents_v" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_rule_sets_fk";

  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_rule_modules_fk";

  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_rule_definitions_fk";

  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_rule_generation_policies_fk";

  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_rule_releases_fk";

  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_rule_migrations_fk";

  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_rule_documents_fk";

  DROP INDEX "payload_locked_documents_rels_rule_sets_id_idx";
  DROP INDEX "payload_locked_documents_rels_rule_modules_id_idx";
  DROP INDEX "payload_locked_documents_rels_rule_definitions_id_idx";
  DROP INDEX "payload_locked_documents_rels_rule_generation_policies_i_idx";
  DROP INDEX "payload_locked_documents_rels_rule_releases_id_idx";
  DROP INDEX "payload_locked_documents_rels_rule_migrations_id_idx";
  DROP INDEX "payload_locked_documents_rels_rule_documents_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "rule_sets_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "rule_modules_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "rule_definitions_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "rule_generation_policies_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "rule_releases_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "rule_migrations_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "rule_documents_id";
  DROP TYPE "public"."enum_rule_sets_lifecycle";
  DROP TYPE "public"."enum_rule_sets_status";
  DROP TYPE "public"."enum__rule_sets_v_version_lifecycle";
  DROP TYPE "public"."enum__rule_sets_v_version_status";
  DROP TYPE "public"."enum_rule_modules_status";
  DROP TYPE "public"."enum__rule_modules_v_version_status";
  DROP TYPE "public"."enum_rule_definitions_definition_type";
  DROP TYPE "public"."enum_rule_definitions_visibility";
  DROP TYPE "public"."enum_rule_definitions_status";
  DROP TYPE "public"."enum__rule_definitions_v_version_definition_type";
  DROP TYPE "public"."enum__rule_definitions_v_version_visibility";
  DROP TYPE "public"."enum__rule_definitions_v_version_status";
  DROP TYPE "public"."enum_rule_generation_policies_status";
  DROP TYPE "public"."enum__rule_generation_policies_v_version_status";
  DROP TYPE "public"."enum_rule_releases_lifecycle";
  DROP TYPE "public"."enum_rule_migrations_reversibility";
  DROP TYPE "public"."enum_rule_migrations_status";
  DROP TYPE "public"."enum__rule_migrations_v_version_reversibility";
  DROP TYPE "public"."enum__rule_migrations_v_version_status";
  DROP TYPE "public"."enum_rule_documents_kind";
  DROP TYPE "public"."enum_rule_documents_status";
  DROP TYPE "public"."enum__rule_documents_v_version_kind";
  DROP TYPE "public"."enum__rule_documents_v_version_status";`)
}
