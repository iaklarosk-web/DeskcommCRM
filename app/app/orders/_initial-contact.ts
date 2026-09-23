import { z } from "zod";

/** Query de navegação é apenas uma sugestão; a API valida contato/tenant novamente. */
export function initialOrderContact(
  params: Record<string, string | string[] | undefined>,
) {
  if (params.new !== "1") return "";
  const parsed = z.uuid().safeParse(params.contact_id);
  return parsed.success ? parsed.data : "";
}
