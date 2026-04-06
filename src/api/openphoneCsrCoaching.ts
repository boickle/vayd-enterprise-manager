import { http } from './http';

export type EmployeeCsrCoachingPerCall = {
  callId: string;
  callerType: string;
  pet: string;
  reason: string;
  outcome: string;
  strengths: string[];
  missedBookingOpportunities: string[];
  coachingTip: string;
};

export type EmployeeCsrCoachingBatchReport = {
  employeeSummary: {
    themes: string[];
    wins: string[];
    growthAreas: string[];
  };
  perCall: EmployeeCsrCoachingPerCall[];
  openingNote: string;
  callSummaryTable: Array<{ dimension: string; notes: string }>;
  csrStrengths: string[];
  performanceScorecard: {
    dimensions: Array<{
      name: string;
      score: number;
      maxScore: number;
      comment: string;
    }>;
  };
  fiveStepCallFramework: Array<{ step: string; guidance: string }>;
  closingScripts: string[];
  pricingScripts: string[];
  referralHandling: string;
  callReviews: Array<{ observation: string; suggestion: string }>;
  insights: string[];
  actionPlan: Array<{ step: string; detail: string }>;
};

export type EmployeeCsrCoachingBatchResponse = {
  employeeId: number;
  rangeFrom: string;
  rangeTo: string;
  openPhoneUserId: string | null;
  includedCallIds: string[] | null;
  status: 'pending' | 'completed' | 'failed';
  openaiModel: string | null;
  report: EmployeeCsrCoachingBatchReport | null;
  errorMessage: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  retryCount: number;
  created: string;
  updated: string;
};

export type EmployeeCsrCoachingBatchRequestBody = {
  from: string;
  to: string;
  refresh?: boolean;
};

/**
 * POST /openphone/calls/csr-coaching/employees/:employeeId — generate or return cached batch (invokes OpenAI when needed).
 */
export async function postEmployeeCsrCoachingBatch(
  employeeId: number,
  body: EmployeeCsrCoachingBatchRequestBody
): Promise<EmployeeCsrCoachingBatchResponse> {
  const { data } = await http.post<EmployeeCsrCoachingBatchResponse>(
    `/openphone/calls/csr-coaching/employees/${employeeId}`,
    body
  );
  return data;
}

/**
 * GET /openphone/calls/csr-coaching/employees/:employeeId — cached batch only; use same from/to as POST.
 */
export async function getEmployeeCsrCoachingBatch(
  employeeId: number,
  params: { from: string; to: string }
): Promise<EmployeeCsrCoachingBatchResponse> {
  const { data } = await http.get<EmployeeCsrCoachingBatchResponse>(
    `/openphone/calls/csr-coaching/employees/${employeeId}`,
    { params }
  );
  return data;
}
