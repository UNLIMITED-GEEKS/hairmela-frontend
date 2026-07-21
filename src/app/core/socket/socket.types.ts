import { TimelineEntryDto } from '../../api/models/timeline-entry-dto';

export type { TimelineEntryDto };

export interface CustomerCalledPayload {
  queueId: string;
  memberName: string;
  position: number;
}

export type ConnectionState = 'connected' | 'reconnecting' | 'disconnected';

// Who caused a queueTimeline broadcast to fire — carried on live-update
// frames only (the initial join-room snapshot has no source, since nothing
// "caused" it). STAFF covers both the barber's own action AND a
// colleague/admin acting on that barber's queue — the backend can't
// distinguish those two cases (see QueueSocketService's self-action
// suppression, which is what actually tells them apart on the frontend).
export type QueueUpdateSource = 'CUSTOMER' | 'STAFF';

export interface QueueTimelinePayload {
  queueId: string;
  timeline: TimelineEntryDto[];
  serverTime?: string;
  source?: QueueUpdateSource;
}
