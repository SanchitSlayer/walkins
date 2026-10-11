import { JwtService } from "@nestjs/jwt";
import {
  ConnectedSocket,
  MessageBody,
  type OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import { type AccessTokenPayload, DEFAULT_LOCALE, type LiveBoard, type LiveDisplay, translate } from "@walkins/shared";
import type { Namespace, Socket } from "socket.io";
import { RateLimiterService } from "../common/rate-limiter.service";
import { WEB_ORIGINS } from "../common/web-origins";
import { LiveBoardService } from "./live-board.service";

type LiveSocket = Pick<Socket, "join" | "id"> & { data: { user?: AccessTokenPayload } };

// "board" is the public arrivals screen and only ever receives the display
// projection; "desk" is the employer's own view with names and flags.
type View = "board" | "desk";

function room(driveId: string, view: View) {
  return `drive:${driveId}:${view}`;
}

function userRoom(userId: string) {
  return `user:${userId}`;
}

// Two rooms per drive, one per view. Joining either is checked against the
// person's company as it stands in the database, every time, so an employer
// can only ever watch their own company's drives.
//
// The access token, though, is checked once, on connect. A board left open
// keeps receiving updates after that token's 15-minute expiry. That is
// accepted for a screen at the company's own drive. Leaving the company is
// not: every socket also sits in a room for its user, and removing someone
// from a company disconnects them there (evict), because the desk view
// carries candidates' names.
@WebSocketGateway({ namespace: "/live", cors: { origin: WEB_ORIGINS, credentials: true } })
export class LiveGateway implements OnGatewayConnection {
  @WebSocketServer() private server!: Namespace;

  constructor(
    private readonly jwt: JwtService,
    private readonly board: LiveBoardService,
    private readonly limiter: RateLimiterService,
  ) {}

  handleConnection(client: Socket) {
    try {
      const user = this.jwt.verify<AccessTokenPayload>(client.handshake.auth?.token ?? "");
      if (user.role !== "EMPLOYER") throw new Error("not an employer");
      client.data.user = user;
      void client.join(userRoom(user.userId));
    } catch {
      client.disconnect(true);
    }
  }

  @SubscribeMessage("join")
  async join(
    @ConnectedSocket() client: LiveSocket,
    @MessageBody() body: { driveId?: unknown; view?: unknown },
  ): Promise<LiveBoard | LiveDisplay | { error: string }> {
    // HTTP limits don't reach socket messages. A screen joins once per
    // connection, and again after each reconnect; a loop here would rebuild
    // a snapshot every time.
    if (!(await this.limiter.consume(`socket-join:${client.id}`, 30, 60)).allowed) {
      return { error: translate(DEFAULT_LOCALE, "errors.rateLimited.socket-join") };
    }
    const { driveId, view } = body ?? {};
    if (view !== "board" && view !== "desk") return { error: translate(DEFAULT_LOCALE, "errors.live.unknownView") };
    const userId = client.data.user?.userId;
    if (!userId || typeof driveId !== "string" || !(await this.board.canWatch(userId, driveId))) {
      return { error: translate(DEFAULT_LOCALE, "errors.drive.notFound") };
    }
    await client.join(room(driveId, view));
    return view === "board" ? this.board.display(driveId) : this.board.snapshot(driveId);
  }

  evict(userId: string) {
    this.server.in(userRoom(userId)).disconnectSockets(true);
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
