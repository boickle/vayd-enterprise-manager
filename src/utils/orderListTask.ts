export function isOrderListAutomationTask(task: {
  triggerDefinitionId?: string | null;
}): boolean {
  return (task.triggerDefinitionId ?? '').startsWith('order_list_item:');
}

export function orderListPath(branchId?: number | null): string {
  if (branchId != null && Number.isFinite(branchId) && branchId > 0) {
    return `/schedule/inventory/order-list?branchId=${encodeURIComponent(String(branchId))}`;
  }
  return '/schedule/inventory/order-list';
}

export function orderListItemLines(body: string | null | undefined): string[] {
  if (!body?.trim()) return [];
  return body
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}
