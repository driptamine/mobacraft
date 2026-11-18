/** Income values use the HUD's ten-second period. */
export const RESOURCE_RATE_SECONDS = 10;
export const BASE_REQUISITION_RATE = 20;
export const LISTENING_POST_REQUISITION_RATES = [6, 12, 18, 24];
export function startingResources(faction = 'ig'): { requisition: number; energy: number } {
  return { requisition: faction === 'necrons' || faction === 'necron' ? 1500 : 1000, energy: 100 };
}
export function pointRequisitionRate(point: { lpTier?: number; hasListeningPost?: boolean }): number {
  const tier = point.hasListeningPost ? Math.max(1, point.lpTier || 0) : point.lpTier || 0;
  return LISTENING_POST_REQUISITION_RATES[Math.max(0, Math.min(3, tier))];
}
