import { Injectable } from "@nestjs/common";
import { prisma } from "@walkins/db";
import { type CompanySettings, companySettingsSchema } from "@walkins/shared";

@Injectable()
export class CompaniesService {
  async settings(companyId: string): Promise<CompanySettings> {
    const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { readsLanguages: true } });
    return companySettingsSchema.parse(company);
  }

  async updateSettings(companyId: string, input: CompanySettings): Promise<CompanySettings> {
    const company = await prisma.company.update({
      where: { id: companyId },
      data: { readsLanguages: [...new Set(input.readsLanguages)] },
      select: { readsLanguages: true },
    });
    return companySettingsSchema.parse(company);
  }
}
