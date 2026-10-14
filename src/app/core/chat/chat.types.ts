import { ConversationLastMessageSnippetDto } from '../../api/models/conversation-last-message-snippet-dto';
import { ConversationResponseDto } from '../../api/models/conversation-response-dto';
import { ConversationMessageResponseDto } from '../../api/models/conversation-message-response-dto';
import { ConversationEligibilityResponseDto } from '../../api/models/conversation-eligibility-response-dto';
import { UnreadCountResponseDto } from '../../api/models/unread-count-response-dto';
import { BroadcastQueuedResponseDto } from '../../api/models/broadcast-queued-response-dto';
import { PaginatedMessagesResponseDto } from '../../api/models/paginated-messages-response-dto';
import { CreateConversationDto as ApiCreateConversationDto } from '../../api/models/create-conversation-dto';
import { SendMessageDto as ApiSendMessageDto } from '../../api/models/send-message-dto';

export type MessageStatus = 'PENDING' | 'SENT' | 'DELIVERED' | 'READ';
export type MessageSenderRole = 'CUSTOMER' | 'STAFF' | 'OWNER';
export type ConversationStatus = 'ACTIVE' | 'ARCHIVED' | 'BLOCKED';

// Badge events contain preview text but no message ID or sender role. Keep
// those fields absent until REST supplies the actual message metadata.
export type ConversationItemDto = Omit<ConversationResponseDto, 'lastMessage'> & {
  lastMessage?:
    | (Omit<ConversationLastMessageSnippetDto, 'id' | 'senderRole'> &
        Partial<Pick<ConversationLastMessageSnippetDto, 'id' | 'senderRole'>>)
    | null;
};

export type ConversationMessageDto = Omit<ConversationMessageResponseDto, 'status'> & {
  status: MessageStatus;
};

export type ConversationEligibilityDto = ConversationEligibilityResponseDto;
export type UnreadCountDto = UnreadCountResponseDto;
export type SalonBroadcastResponseDto = BroadcastQueuedResponseDto;
export interface MessageHistoryResponseDto {
  data: ConversationMessageDto[];
  hasMore: boolean;
}
export type CreateConversationDto = ApiCreateConversationDto;
export type SendMessageDto = ApiSendMessageDto;

export interface SalonBroadcastDto {
  body: string;
  mediaUrl?: string | null;
}

export interface MarkReadDto {
  upToMessageId?: string;
}

export interface ConversationJoinPayload {
  conversationId: string;
}

export interface TypingPayload {
  conversationId: string;
}

export interface TypingIndicatorPayload {
  conversationId: string;
  userId: string;
  userName: string;
  isTyping: boolean;
}

export interface MessageStatusUpdatedPayload {
  conversationId: string;
  messageId?: string;
  clientMessageId?: string;
  status: MessageStatus;
  deliveredAt?: string;
  readAt?: string;
  readerUserId?: string;
  upToMessageId?: string;
}

export interface InboxBadgeUpdatedPayload {
  conversationId?: string;
  unreadCount?: number;
  lastMessage?: {
    senderName?: string;
    mediaDurationSeconds?: number | null;
    body?: string;
    createdAt?: string;
  };
}
