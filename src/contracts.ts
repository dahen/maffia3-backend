export const PHASES = ['Möte', 'Natt', 'Gryning', 'Morgon'] as const;
export type Phase = 0 | 1 | 2 | 3;
export type PowerType = 'player-kill' | 'player-other' | 'Text' | 'Yes/No' | 'None';
export function targetsPlayer(type: PowerType) { return type === 'player-kill' || type === 'player-other'; }
export interface User { id: string; name: string; admin: boolean }
export interface Power { id: string; name: string; description: string; type: PowerType; groupId: string | null; conditional: boolean; gmResponse: boolean }
export interface Role { id: string; userId: string; player: string; name: string; summary: string; win: string; team: string; gmHint: string; notes: string; alive: boolean; powers: Power[] }
export interface RoundRole { blocked: boolean; summoned: boolean; enabled: string[]; notes: string; morningNotes: string }
export interface Action { value: string; targetId: string | null; executorId: string; response: string }
export interface Countdown { deadline: string; minutes: number; sent: number[]; actorId: string; actorName: string }
export interface DeathSource { actorRoleId: string; actorPlayer: string; actorRole: string; powerId: string; powerName: string; actionKey: string; sourceRevision: number }
export interface Death { roleId: string; cause: 'night' | 'lynch' | 'day'; reason: string; source: DeathSource | null; clue: string }
export interface Round { number: number; phase: Phase; notes: string; countdown: Countdown | null; deaths: Death[]; dayOutcome: 'pending' | 'none' | 'deaths'; roles: Record<string, RoundRole>; actions: Record<string, Action> }
export interface Room { id: string; name: string; kind: 'gm' | 'group'; roleIds: string[] }
export interface Message { id: string; roomId: string; senderId: string; senderName: string; admin: boolean; body: string; round: number; time: string }
export type Theme = 'jungle' | 'classic';
export interface GameState { theme: Theme; roles: Role[]; rounds: Round[]; rooms: Room[]; messages: Message[] }
export interface GameSummary { id: string; name: string; mode: 'test' | 'live'; theme: Theme; players: number; round: number; phase: Phase }
export interface PowerView extends Power { enabled: boolean; action: Action | null }
export interface RoleView extends Omit<Role, 'powers'> { powers: PowerView[]; blocked: boolean; summoned: boolean; roundNotes: string; morningNotes: string; finished: boolean; gmFinished: boolean }
export interface RoomView extends Room { unread: number; latest: string | null; count: number }
export interface TimelineEntry { id: number; parentId: number | null; label: string; round: number; phase: Phase; time: string; current: boolean }
export interface GameView { game: GameSummary; revision: number; viewedRound: number; viewedPhase: Phase; dayOutcome: Round['dayOutcome']; morning: (Death & { player: string })[]; countdown: { deadline: string; paused: boolean } | null; roundNumbers: number[]; notes: string; roles: RoleView[]; rooms: RoomView[]; targets: { id: string; name: string; alive: boolean }[]; timeline: TimelineEntry[]; canUndo: boolean; canRedo: boolean }
