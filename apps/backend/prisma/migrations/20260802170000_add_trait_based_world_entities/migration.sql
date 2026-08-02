-- Organizational worlds are release-pinned containers. Legacy generated worlds
-- remain readable, but new trait-based worlds populate the explicit columns.
ALTER TABLE "worlds"
  ALTER COLUMN "prompt" DROP NOT NULL,
  ALTER COLUMN "generatedContent" DROP NOT NULL,
  ADD COLUMN "workspaceExternalId" VARCHAR,
  ADD COLUMN "ownerSubject" VARCHAR,
  ADD COLUMN "name" VARCHAR,
  ADD COLUMN "description" TEXT,
  ADD COLUMN "ruleSetId" INTEGER,
  ADD COLUMN "releaseId" INTEGER,
  ADD COLUMN "releaseHash" VARCHAR,
  ADD COLUMN "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "IDX_world_workspace_owner" ON "worlds"("workspaceExternalId", "ownerSubject");

ALTER TABLE "rule_instances"
  ADD COLUMN "rootTraitIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "satisfiedTraitIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "prerequisiteSelections" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "migrationStatus" VARCHAR NOT NULL DEFAULT 'current',
  ADD COLUMN "migrationDiagnostics" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "retainedValues" JSONB NOT NULL DEFAULT '{}';

CREATE INDEX "IDX_rule_instance_binding_migration_status"
  ON "rule_instances"("bindingId", "migrationStatus");

CREATE TABLE "world_entity_references" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "bindingId" UUID NOT NULL,
  "parentEntityId" UUID NOT NULL,
  "childEntityId" UUID NOT NULL,
  "collectionPath" VARCHAR NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "implementationMap" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "world_entity_references_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "world_entity_references_parentEntityId_fkey"
    FOREIGN KEY ("parentEntityId") REFERENCES "rule_instances"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "world_entity_references_childEntityId_fkey"
    FOREIGN KEY ("childEntityId") REFERENCES "rule_instances"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX "UQ_world_entity_reference_parent_path_child"
  ON "world_entity_references"("parentEntityId", "collectionPath", "childEntityId");
CREATE INDEX "IDX_world_entity_reference_collection"
  ON "world_entity_references"("bindingId", "parentEntityId", "collectionPath", "sortOrder");
CREATE INDEX "IDX_world_entity_reference_child"
  ON "world_entity_references"("childEntityId");

-- Keep the denormalized binding id trustworthy even for writes outside the API.
CREATE OR REPLACE FUNCTION enforce_world_entity_reference_binding()
RETURNS trigger AS $$
DECLARE
  parent_binding UUID;
  child_binding UUID;
BEGIN
  SELECT "bindingId" INTO parent_binding FROM "rule_instances" WHERE "id" = NEW."parentEntityId";
  SELECT "bindingId" INTO child_binding FROM "rule_instances" WHERE "id" = NEW."childEntityId";
  IF parent_binding IS NULL OR child_binding IS NULL
     OR parent_binding <> child_binding OR NEW."bindingId" <> parent_binding THEN
    RAISE EXCEPTION 'World entity references must remain within one world binding';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "TRG_world_entity_reference_binding"
BEFORE INSERT OR UPDATE ON "world_entity_references"
FOR EACH ROW EXECUTE FUNCTION enforce_world_entity_reference_binding();
