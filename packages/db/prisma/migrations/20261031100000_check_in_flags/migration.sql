-- Why a check-in was held for the employer was stored as an English sentence
-- in flagReason, so a Hindi reader was told in English. It is now a list of
-- codes, worded from the catalog in the reader's language, with the values
-- the wording needs kept in columns.
--
-- Only the check-in service ever wrote flagReason, in two shapes joined by
-- "; ", so the sentences convert exactly. The check comes first and stops
-- the migration, before anything changes, on any text it doesn't recognise
-- rather than drop a reason.
DO $$
DECLARE
  unknown INTEGER;
BEGIN
  SELECT count(*) INTO unknown
  FROM (
    SELECT part, c."accuracyMeters" IS NOT NULL AND c."distanceMeters" IS NOT NULL AS measured
    FROM "check_ins" c, unnest(string_to_array(c."flagReason", '; ')) AS part
    UNION ALL
    SELECT part, true
    FROM "audit_logs" a, unnest(string_to_array(a."before"->>'flagReason', '; ')) AS part
    WHERE a."entityType" = 'check_in'
  ) reasons
  WHERE NOT (part ~ '^Location only accurate to ±[0-9.]+ k?m, [0-9.]+ k?m from the venue$' AND measured)
    AND part !~ '^Scanned offline, sent (less than a minute|[0-9]+ min) after the code expired$';
  IF unknown > 0 THEN
    RAISE EXCEPTION '% check-in flag reasons are not in a shape this migration converts', unknown;
  END IF;
END $$;

CREATE TYPE "CheckInFlag" AS ENUM ('LOW_GPS_ACCURACY', 'SYNCED_AFTER_EXPIRY');

ALTER TABLE "check_ins" ADD COLUMN     "flags" "CheckInFlag"[] DEFAULT ARRAY[]::"CheckInFlag"[],
ADD COLUMN     "lateBySeconds" INTEGER;

CREATE FUNCTION pg_temp.check_in_flags(reason TEXT) RETURNS "CheckInFlag"[] AS $$
  SELECT array_remove(ARRAY[
    CASE WHEN reason LIKE '%Location only accurate to %' THEN 'LOW_GPS_ACCURACY'::"CheckInFlag" END,
    CASE WHEN reason LIKE '%Scanned offline, sent %' THEN 'SYNCED_AFTER_EXPIRY'::"CheckInFlag" END
  ], NULL)
$$ LANGUAGE sql IMMUTABLE;

-- The accuracy and distance in the sentence were the accuracyMeters and
-- distanceMeters columns rounded, so those columns already hold them. The
-- lateness was kept only as whole minutes; minutes * 60 renders the same
-- minutes again, and "less than a minute" becomes 0.
UPDATE "check_ins" SET
  "flags" = pg_temp.check_in_flags("flagReason"),
  "lateBySeconds" = CASE
    WHEN "flagReason" LIKE '%sent less than a minute after%' THEN 0
    ELSE substring("flagReason" FROM 'sent ([0-9]+) min after')::INTEGER * 60
  END
WHERE "flagReason" IS NOT NULL;

-- An employer's confirmation records the check-in as it was, sentence
-- included. Read from its own copy rather than the check-in's, so an entry
-- converts even if the two ever differed.
UPDATE "audit_logs" SET
  "before" = ("before" - 'flagReason') || jsonb_build_object('flags', to_jsonb(pg_temp.check_in_flags("before"->>'flagReason')))
WHERE "entityType" = 'check_in' AND "before" ? 'flagReason';

ALTER TABLE "check_ins" DROP COLUMN "flagReason";
