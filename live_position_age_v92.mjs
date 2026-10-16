// Strict read-only expiry classifier. Unknown timestamp is never treated as a safe position.
export const MAX_HOLD_MS = 4 * 60 * 60 * 1000;
const time = row => {
  // GMO FX positions expose timestamp as an ISO8601 string. No heuristic unit conversion.
  const value = row?.timestamp;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return NaN;
  return Date.parse(value);
};
export function classifyLiveBrokerExposure(positions, now) {
  if (!Array.isArray(positions) || !Number.isSafeInteger(now) || now <= 0) throw Error('INVALID_EXPOSURE_AUDIT_INPUT');
  let expiredCount = 0, unknownCount = 0, activeCount = 0;
  const entries = positions.map(p => {
    const parsed = time(p);
    const identity = String(p?.positionId ?? 'UNKNOWN');
    // More than one position is not permitted by the strategy but still audited.
    if (!Number.isFinite(parsed) || parsed > now || parsed <= 0) {
      unknownCount++;
      return {positionId:identity,status:'UNKNOWN_ENTRY_TIME',dueForExitReview:true};
    }
    const ageMs=now-parsed;
    if(ageMs>=MAX_HOLD_MS){expiredCount++;return {positionId:identity,status:'FOUR_HOURS_ELAPSED',ageMs,dueForExitReview:true};}
    activeCount++;
    return {positionId:identity,status:'OPEN_BEFORE_FOUR_HOURS',ageMs,dueForExitReview:false};
  });
  return Object.freeze({positionCount:positions.length,expiredCount,unknownCount,activeCount,entries,brokerWriteAuthorized:false,orderSent:false});
}
