import { Injectable } from "@nestjs/common";
import { prisma } from "@walkins/db";

@Injectable()
export class CatalogService {
  listRoles() {
    return prisma.role.findMany({ orderBy: { title: "asc" } });
  }

  listCities() {
    return prisma.city.findMany({ orderBy: { name: "asc" } });
  }
}
