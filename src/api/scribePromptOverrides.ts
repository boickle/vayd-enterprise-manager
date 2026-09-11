import { http } from './http';

export type ScribePromptOverridesResponse = {
  scribePromptOverrides: string | null;
};

export async function getScribePromptOverrides(
  employeeId: number
): Promise<ScribePromptOverridesResponse> {
  const { data } = await http.get<ScribePromptOverridesResponse>(
    `/employees/${employeeId}/scribe-prompt-overrides`
  );
  return data;
}

export async function updateScribePromptOverrides(
  employeeId: number,
  scribePromptOverrides: string | null
): Promise<ScribePromptOverridesResponse> {
  const { data } = await http.put<ScribePromptOverridesResponse>(
    `/employees/${employeeId}/scribe-prompt-overrides`,
    { scribePromptOverrides }
  );
  return data;
}
