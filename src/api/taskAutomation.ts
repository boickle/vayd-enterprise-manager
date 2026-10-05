import { http } from './http';

/** Situations the rules engine can watch. Matches TaskAutomationTrigger on the API. */
export type TaskAutomationTrigger =
  | 'soap_unfinished'
  | 'invoice_open'
  | 'order_list_item'
  | 'call_unfiled'
  | 'lab_result_missing';

export type TaskAutomationTiming = 'age' | 'end_of_day';

export type TaskAutomationAssignee = 'owner' | 'role' | 'employee' | 'queue';

export type TaskAutomationRule = {
  id: number;
  practiceId: number;
  trigger: TaskAutomationTrigger;
  name: string;
  isEnabled: boolean;
  timingMode: TaskAutomationTiming;
  thresholdMinutes: number;
  endOfDayHour: number;
  assigneeMode: TaskAutomationAssignee;
  assigneeRoleId: number | null;
  assigneeEmployeeId: number | null;
  watcherRoleIds: number[];
  watcherEmployeeIds: number[];
  queueRoleId: number | null;
  branchId: number | null;
  titleTemplate: string;
  bodyTemplate: string | null;
  priority: number | null;
  dueInHours: number | null;
  recreateIfIncomplete: boolean;
  lastRunAt: string | null;
};

export type TaskAutomationRulesResponse = {
  rules: TaskAutomationRule[];
  /** Placeholders each trigger can use in its templates, keyed by trigger. */
  placeholders: Record<TaskAutomationTrigger, string[]>;
};

export type PatchTaskAutomationRuleBody = Partial<
  Omit<TaskAutomationRule, 'id' | 'practiceId' | 'trigger' | 'lastRunAt'>
>;

export async function listTaskAutomationRules(
  practiceId: number
): Promise<TaskAutomationRulesResponse> {
  const { data } = await http.get<TaskAutomationRulesResponse>(
    `/practice/${practiceId}/task-automation-rules`
  );
  return data;
}

export async function patchTaskAutomationRule(
  practiceId: number,
  id: number,
  body: PatchTaskAutomationRuleBody
): Promise<TaskAutomationRule> {
  const { data } = await http.patch<TaskAutomationRule>(
    `/practice/${practiceId}/task-automation-rules/${id}`,
    body
  );
  return data;
}

/** Runs the rules immediately instead of waiting for the next sweep. */
export async function runTaskAutomationRules(
  practiceId: number
): Promise<{ created: number }> {
  const { data } = await http.post<{ created: number }>(
    `/practice/${practiceId}/task-automation-rules/run`,
    {}
  );
  return data;
}
