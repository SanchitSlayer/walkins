-- Enable PostGIS
CREATE EXTENSION IF NOT EXISTS postgis;

-- Geography columns, derived from the Float lat/lng columns Prisma manages.
-- Not present in schema.prisma: Prisma has no native PostGIS type, so these
-- are written and read via raw SQL only.
ALTER TABLE "drives" ADD COLUMN "geom" geography(Point, 4326);
ALTER TABLE "candidates" ADD COLUMN "geom" geography(Point, 4326);

-- Backfill (no-op on a fresh database)
UPDATE "drives" SET "geom" = ST_SetSRID(ST_MakePoint("venueLng", "venueLat"), 4326)::geography;
UPDATE "candidates" SET "geom" = ST_SetSRID(ST_MakePoint("homeLng", "homeLat"), 4326)::geography;

-- GiST indexes for spatial queries (radius search, nearest drive, etc.)
CREATE INDEX "drives_geom_gist" ON "drives" USING GIST ("geom");
CREATE INDEX "candidates_geom_gist" ON "candidates" USING GIST ("geom");

-- Triggers: every insert/update through Prisma sets venueLat/venueLng or
-- homeLat/homeLng as plain Floats; these keep geom in sync automatically so
-- no application code path can forget to update it.
CREATE OR REPLACE FUNCTION sync_drives_geom() RETURNS trigger AS $$
BEGIN
  NEW."geom" := ST_SetSRID(ST_MakePoint(NEW."venueLng", NEW."venueLat"), 4326)::geography;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER drives_geom_sync
BEFORE INSERT OR UPDATE OF "venueLat", "venueLng" ON "drives"
FOR EACH ROW EXECUTE FUNCTION sync_drives_geom();

CREATE OR REPLACE FUNCTION sync_candidates_geom() RETURNS trigger AS $$
BEGIN
  NEW."geom" := ST_SetSRID(ST_MakePoint(NEW."homeLng", NEW."homeLat"), 4326)::geography;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER candidates_geom_sync
BEFORE INSERT OR UPDATE OF "homeLat", "homeLng" ON "candidates"
FOR EACH ROW EXECUTE FUNCTION sync_candidates_geom();

-- Partial index for the "live drives in a city, soonest first" hot path
CREATE INDEX "drives_cityId_startsAt_live_idx" ON "drives" ("cityId", "startsAt") WHERE "status" = 'LIVE';
