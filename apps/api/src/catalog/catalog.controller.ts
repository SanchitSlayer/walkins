import { Controller, Get } from "@nestjs/common";
import { CatalogService } from "./catalog.service";

@Controller()
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get("roles")
  listRoles() {
    return this.catalogService.listRoles();
  }

  @Get("cities")
  listCities() {
    return this.catalogService.listCities();
  }
}
