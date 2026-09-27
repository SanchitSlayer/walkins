import type { TemplateKey } from "@walkins/shared";
import { AlertService } from "../alerts/alert-service";
import { createAlertsQueue } from "../queues";
import { connection } from "../redis";

// Queues one drive's alerts by hand, for testing a template without waiting
// for the schedule. The running worker does the sending.
async function main() {
  const [driveId, templateKey = "drive_48h"] = process.argv.slice(2);
  if (!driveId || (templateKey !== "drive_48h" && templateKey !== "drive_morning_of")) {
    console.error("usage: fanout <driveId> [drive_48h | drive_morning_of]");
    process.exit(1);
  }
  const queue = createAlertsQueue(connection);
  const alerts = new AlertService(queue);
  const key = templateKey as TemplateKey;
  const targeted = key === "drive_morning_of" ? await alerts.remindConfirmed(driveId) : await alerts.fanOut(driveId, key);
  console.log(`${targeted} candidates targeted for ${key} on drive ${driveId}; any already queued or sent are skipped`);
  await queue.close();
  connection.disconnect();
}

main();
