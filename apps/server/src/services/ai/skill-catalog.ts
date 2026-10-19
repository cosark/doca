import type { DB } from "@db/index.js";
import { aiConfig } from "@core/modules/ai/config.js";
import { defaultOfficialSkills } from "@core/modules/ai/skills.js";
import { pluginServices } from "@core/shared/plugin-services.js";
import type { AssistantSkill } from "./external-tools.js";

export async function currentAssistantSkills(
  db: DB,
  userId: string,
): Promise<AssistantSkill[]> {
  const config = await aiConfig(db);
  const personal = await db
    .selectFrom("ai_skills")
    .selectAll()
    .where("user_id", "=", userId)
    .where("enabled", "=", 1)
    .execute();
  return [
    ...(config.officialSkills ?? defaultOfficialSkills).filter(
      (skill) => skill.enabled !== false,
    ),
    ...[...pluginServices(db).skills.values()].map((skill) => ({
      ...skill,
      formats: [...skill.formats],
    })),
    ...personal.map((skill) => ({
      ...skill,
      formats: JSON.parse(skill.formats) as string[],
    })),
  ].map(({ id, name, description, content, formats }) => ({
    id,
    name,
    description,
    content,
    formats,
  }));
}
