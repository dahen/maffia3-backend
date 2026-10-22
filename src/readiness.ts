import type { Phase, PowerView } from './contracts.ts';

export interface PendingRole { roleId: string; player: string; powers: { id: string; name: string }[] }
export interface PhaseReadiness { kind: 'actions' | 'responses'; pending: PendingRole[]; missingCount: number; nextPhase: Phase }
export interface PhaseGuard extends Omit<PhaseReadiness,'kind'> { kind:'actions'|'responses'|'mixed'; fromPhase: Phase; toPhase: Phase; token: string }
interface ProgressRole { id: string; player: string; alive: boolean; powers: Pick<PowerView,'id'|'name'|'type'|'enabled'|'gmResponse'|'action'>[] }

export function phaseReadiness(phase: Phase, roles: ProgressRole[]): PhaseReadiness | null {
  if (phase !== 1 && phase !== 2) return null;
  const kind = phase === 1 ? 'actions' : 'responses';
  const pending = roles.filter(r=>r.alive).flatMap(role=>{
    const powers = role.powers.filter(p=>p.enabled && (kind === 'actions'
      ? p.type !== 'None' && !p.action?.value.trim()
      : p.gmResponse && (p.type === 'None' || Boolean(p.action?.value.trim())) && !p.action?.response.trim()
    )).map(p=>({id:p.id,name:p.name}));
    return powers.length ? [{roleId:role.id,player:role.player,powers}] : [];
  });
  return {kind,pending,missingCount:pending.reduce((sum,r)=>sum+r.powers.length,0),nextPhase:phase === 1 ? 2 : 3};
}
