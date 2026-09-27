import type { NotificationChannel, Recipient } from "@walkins/shared";

export class ChannelResolver {
  // Priority order: the first channel that can reach a recipient wins.
  constructor(private readonly channels: NotificationChannel[]) {}

  resolve(recipient: Recipient): NotificationChannel | null {
    return this.channels.find((channel) => channel.isAvailable(recipient)) ?? null;
  }
}
