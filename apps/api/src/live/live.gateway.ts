import { JwtService } from "@nestjs/jwt";
import {
  ConnectedSocket,
  MessageBody,
  type OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import type { AccessTokenPayload, LiveBoard } from "@walkins/shared";
import type { Namespace, Socket } from "socket.io";
import { WEB_ORIGINS } from "../common/web-origins";
import { LiveBoardService } from "./live-board.service";

type LiveSocket = Pick<Socket, "join"> & { data: { user?: AccessTokenPayload } };

function room(driveId: string) {
  return `drive:${driveId}`;
}

// One room per drive. Joining a room is checked against the company every
// time, so an employer can only ever watch their own company's drives.
//
// The access token, though, is checked once, on connect, and never again. A
// board left open keeps receiving updates after that token's 15-minute
// expiry, and a user whose sessions were revoked keeps watching until the
// socket drops. That is accepted for a screen on the employer's own laptop
// at their own drive; don't read this as a continuous check.
@WebSocketGateway({ namespace: "/live", cors: { origin: WEB_ORIGINS, credentials: true } })
export class LiveGateway implements OnGatewayConnection {
  @WebSocketServer() private server!: Namespace;

  constructor(
    private readonly jwt: JwtService,
    private readonly board: LiveBoardService,
  ) {}

  handleConnection(client: Socket) {
    try {
      const user = this.jwt.verify<AccessTokenPayload>(client.handshake.auth?.token ?? "");
      if (user.role !== "EMPLOYER" || !user.companyId) throw new Error("not an employer");
      client.data.user = user;
    } catch {
      client.disconnect(true);
    }
  }

  @SubscribeMessage("join")
  async join(@ConnectedSocket() client: LiveSocket, @MessageBody() driveId: string): Promise<LiveBoard | { error: string }> {
    const companyId = client.data.user?.companyId;
    if (!companyId || typeof driveId !== "string" || !(await this.board.ownsDrive(companyId, driveId))) {
      return { error: "Drive not found" };
    }
    await client.join(room(driveId));
    return this.board.snapshot(driveId);
  }

  // Called after anything that changes a drive's board. The whole snapshot is
  // sent rather than a diff, so a client that missed an event is corrected by
  // the next one instead of drifting.
  async publish(driveId: string) {
    if (!this.server.adapter.rooms.get(room(driveId))?.size) return;
    this.server.to(room(driveId)).emit("board", await this.board.snapshot(driveId));
  }
}
