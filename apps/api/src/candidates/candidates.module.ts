import { Module } from "@nestjs/common";
import { CandidatesController } from "./candidates.controller";
import { CandidatesService } from "./candidates.service";
import { VoiceIntroService } from "./voice-intro.service";

@Module({
  controllers: [CandidatesController],
  providers: [CandidatesService, VoiceIntroService],
})
export class CandidatesModule {}
