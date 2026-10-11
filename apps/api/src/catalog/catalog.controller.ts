import { Controller, Get } from "@nestjs/common";
import { LIMITS, RateLimit } from "../common/rate-limit";
import { CatalogService } from "./catalog.service";

@Controller()
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get("roles")
  @RateLimit(LIMITS.publicRead)
  listRoles() {
    return this.catalogService.listRoles();
  }

  @Get("cities")
  @RateLimit(LIMITS.publicRead)
  listCities() {
    return this.catalogService.listCities();
  }
}
