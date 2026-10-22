import { BroadcastAutomationResponseDto } from '../../../api/models/broadcast-automation-response-dto';

// The generated schedule union — switch on `kind` to narrow it. Every date and
// time in it is in the SALON's timezone, sent exactly as the owner picked it.
export type BroadcastSchedule = BroadcastAutomationResponseDto['schedule'];
export type BroadcastScheduleKind = BroadcastSchedule['kind'];
export type BroadcastChannel = BroadcastAutomationResponseDto['channels'][number];
export type BroadcastRunStatus = NonNullable<BroadcastAutomationResponseDto['lastRunStatus']>;

export const CHANNEL_OPTIONS: { value: BroadcastChannel; label: string }[] = [
  { value: 'IN_APP', label: 'In-app chat' },
  { value: 'SMS', label: 'SMS' },
  { value: 'WHATSAPP', label: 'WhatsApp' },
];

export const MAX_ACTIVE_BROADCAST_AUTOMATIONS = 5;
