import { BadRequestException } from "@nestjs/common";
import { createDriveSchema, otpVerifySchema } from "@walkins/shared";
import { describe, expect, it } from "vitest";
import { apiError } from "../src/common/api-error";
import { ZodValidationPipe } from "../src/common/zod-validation.pipe";

const DRIVE = {
  roleId: "r",
  cityId: "c",
  venueAddress: "12 MG Road",
  salaryMin: 15000,
  salaryMax: 20000,
  experienceMin: 0,
  experienceMax: 1,
  startsAt: "2026-10-12T04:00:00.000Z",
  endsAt: "2026-10-12T06:00:00.000Z",
  capacity: 4,
  slotDurationMinutes: 60,
  capacityPerSlot: 2,
};

function refusal(schema: Parameters<typeof ZodValidationPipe>[0], value: unknown) {
  try {
    new ZodValidationPipe(schema).transform(value);
  } catch (err) {
    expect(err).toBeInstanceOf(BadRequestException);
    return (err as BadRequestException).getResponse();
  }
  throw new Error("expected a refusal");
}

describe("validation errors", () => {
  it("words a schema's own rule for a person, and names the field", () => {
    expect(refusal(createDriveSchema, { ...DRIVE, salaryMin: 20000, salaryMax: 15000 })).toEqual({
      code: "errors.validation.payRange",
      message: "“Pay up to” is lower than “Pay from”. Set it to the same amount or more.",
      params: { field: "fields.salaryMax" },
      field: "salaryMax",
    });
  });

  it("words zod's built-in checks too, never zod's own text", () => {
    expect(refusal(createDriveSchema, { ...DRIVE, capacityPerSlot: 0 })).toMatchObject({
      code: "errors.validation.tooLowExclusive",
      message: "Seats per slot needs to be more than 0.",
      field: "capacityPerSlot",
    });
    expect(refusal(createDriveSchema, { ...DRIVE, roleId: undefined })).toMatchObject({ message: "Role is missing. Fill it in, then try again." });
    expect(refusal(otpVerifySchema, { phone: "9999999999", otp: "12" })).toMatchObject({ message: "Enter the 6-digit code from the message." });
  });

  // The web app words the keys in the page's language; message is for
  // every other client.
  it("sends field names as keys, and words them in English only in message", () => {
    expect(apiError("errors.profile.incomplete", { fields: ["fields.homeLat", "fields.roleIds"] })).toEqual({
      code: "errors.profile.incomplete",
      message: "Fill in Home location and Roles before saving your profile for the first time.",
      params: { fields: ["fields.homeLat", "fields.roleIds"] },
    });
  });
});
