import { createAlertsQueue, createChargeQueue, createEmbedQueue, createMaintenanceQueue, createVoiceQueue } from "../queues";
import { connection } from "../redis";

async function main() {
  const queues = [
    createAlertsQueue(connection),
    createChargeQueue(connection),
    createVoiceQueue(connection),
    createEmbedQueue(connection),
    createMaintenanceQueue(connection),
  ];
  for (const queue of queues) {
    const failed = await queue.getFailed();
    console.log(`${queue.name}: ${failed.length} dead-lettered`);
    for (const job of failed) {
      const at = job.finishedOn ? new Date(job.finishedOn).toISOString() : "unknown time";
      console.log(`  ${job.id}  attempts ${job.attemptsMade}  ${at}\n    ${job.failedReason}`);
    }
  }
  await Promise.all(queues.map((queue) => queue.close()));
  connection.disconnect();
}

main();
