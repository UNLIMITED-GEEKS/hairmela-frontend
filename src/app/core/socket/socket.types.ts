import { TimelineEntryDto } from '../../api/models/timeline-entry-dto';

export type { TimelineEntryDto };

export interface CustomerCalledPayload {
  queueId: string;
  memberName: string;
  position: number;
}

export type ConnectionState = 'connected' | 'reconnecting' | 'disconnected';
