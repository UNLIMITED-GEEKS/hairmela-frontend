import { Component, input } from '@angular/core';
import { MessageStatus } from '../../../core/chat/chat.types';

@Component({
  selector: 'app-chat-status-icon',
  standalone: true,
  template: `
    @switch (status()) {
      @case ('PENDING') {
        <svg class="w-3.5 h-3.5 text-slate-400 inline-block animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <circle cx="12" cy="12" r="10" stroke-width="2.5" stroke-dasharray="32" stroke-linecap="round"/>
        </svg>
      }
      @case ('SENT') {
        <svg class="w-3.5 h-3.5 text-slate-400 inline-block" viewBox="0 0 16 16" fill="currentColor">
          <path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z"/>
        </svg>
      }
      @case ('DELIVERED') {
        <svg class="w-4 h-3.5 text-slate-400 inline-block" viewBox="0 0 20 16" fill="currentColor">
          <path d="M12.854 3.646a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708 0l-2.5-2.5a.5.5 0 1 1 .708-.708L6.5 9.293l5.646-5.647a.5.5 0 0 1 .708 0z"/>
          <path d="M17.854 3.646a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708 0l-.854-.854.708-.708.5.5 5.646-5.646a.5.5 0 0 1 .708 0z"/>
        </svg>
      }
      @case ('READ') {
        <svg class="w-4 h-3.5 text-sky-400 inline-block" viewBox="0 0 20 16" fill="currentColor">
          <path d="M12.854 3.646a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708 0l-2.5-2.5a.5.5 0 1 1 .708-.708L6.5 9.293l5.646-5.647a.5.5 0 0 1 .708 0z"/>
          <path d="M17.854 3.646a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708 0l-.854-.854.708-.708.5.5 5.646-5.646a.5.5 0 0 1 .708 0z"/>
        </svg>
      }
    }
  `,
})
export class ChatStatusIconComponent {
  readonly status = input.required<MessageStatus>();
}

