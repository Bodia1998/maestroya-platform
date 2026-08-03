import { PrismaUserRepository } from "@/infrastructure/database/prisma/repositories/prisma-user-repository";
import { GetUserLanguagePreferenceUseCase } from "@/application/use-cases/i18n/get-user-language-preference.use-case";
import { UpdateUserLanguagePreferenceUseCase } from "@/application/use-cases/i18n/update-user-language-preference.use-case";

/**
 * Composition root for the Internationalization module — identical shape
 * to profile/compose.ts, workflow-expiration/compose.ts and every other
 * `compose.ts` in this codebase: module-level singleton repositories,
 * `makeXUseCase()` factories, and the only file in the module that names
 * a concrete infrastructure class.
 */
const users = new PrismaUserRepository();

export function makeGetUserLanguagePreferenceUseCase() {
  return new GetUserLanguagePreferenceUseCase(users);
}

export function makeUpdateUserLanguagePreferenceUseCase() {
  return new UpdateUserLanguagePreferenceUseCase(users);
}
