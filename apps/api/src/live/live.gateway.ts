import { JwtService } from "@nestjs/jwt";
import {
  ConnectedSocket,
  MessageBody,
  type OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import type { AccessTokenPayload, LiveBoard, LiveDisplay } from "@walkins/shared";
import type { Namespace, Socket } from "socket.io";
import { WEB_ORIGINS } from "../common/web-origins";
import { LiveBoardService } from "./live-board.service";

type LiveSocket = Pick<Socket, "join"> & { data: { user?: AccessTokenPayload } };

// "board" is the public arrivals screen and only ever receives the display
// projection; "desk" is the employer's own view with names and flags.
type View = "board" | "desk";

function room(driveId: string, view: View) {
  return `drive:${driveId}:${view}`;
}

// Two rooms per drive, one per view. Joining either is checked against the
// company every time, so an employer can only ever watch their own drives.
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
  async join(
    @ConnectedSocket() client: LiveSocket,
    @MessageBody() body: { driveId?: unknown; view?: unknown },
  ): Promise<LiveBoard | LiveDisplay | { error: string }> {
    const companyId = client.data.user?.companyId;
    const { driveId, view } = body ?? {};
    if (view !== "board" && view !== "desk") return { error: "Unknown view" };
    if (!companyId || typeof driveId !== "string" || !(await this.board.ownsDrive(companyId, driveId))) {
      return { error: "Drive not found" };
    }
    await client.join(room(driveId, view));
    return view === "board" ? this.board.display(driveId) : this.board.snapshot(driveId);
  }

  // Called after anything that changes a drive's arrivals. Whole snapshots
  // rather than diffs, so a client that missed an event is corrected by the
  // next one instead of drifting; each is only built if someone is watching.
  async publish(driveId: string) {
    const watching = (view: View) => (this.server.adapter.rooms.get(room(driveId, view))?.size ?? 0) > 0;
    if (watching("board")) this.server.to(room(driveId, "board")).emit("display", await this.board.display(driveId));
    if (watching("desk")) this.server.to(room(driveId, "desk")).emit("desk", await this.board.snapshot(driveId));
  }
}
