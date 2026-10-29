import { Prisma } from "@prisma/client";

// Over aliases a (applications) and d (drives): the drive was moved after
// this candidate booked, and the notice of the time it ended up at never
// reached them. Someone who wasn't told, and came at the old time or not at
// all, didn't fail to turn up to anything they knew about; their absence is
// not held against them. Only the notice for the drive's final schedule
// counts: knowing an earlier move isn't knowing where it landed.
export const absenceExcusedByReschedule = Prisma.sql`(
  EXISTS (
    SELECT 1 FROM drive_reschedules r
    WHERE r."driveId" = d.id
      AND r."createdAt" > COALESCE(
        (SELECT max(al."createdAt") FROM audit_logs al
          WHERE al."entityType" = 'application' AND al."entityId" = a.id AND al.action LIKE '%->CONFIRMED'),
        a."stateChangedAt")
  )
  AND NOT EXISTS (
    SELECT 1 FROM notifications n
    WHERE n."driveId" = d.id AND n."candidateId" = a."candidateId"
      AND n."templateKey" = 'drive_rescheduled' AND n."scheduleVersion" = d."scheduleVersion" AND n.status = 'SENT'
  )
)`;
