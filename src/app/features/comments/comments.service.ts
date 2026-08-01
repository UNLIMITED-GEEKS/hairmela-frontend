import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map, switchMap } from 'rxjs';
import { ApiConfiguration } from '../../api/api-configuration';
import { CommentResponseDto } from '../../api/models/comment-response-dto';
import { commentsControllerList } from '../../api/fn/queues/comments-controller-list';
import { commentsControllerCreate } from '../../api/fn/queues/comments-controller-create';
import { uploadToCloudinary } from '../../core/media/cloudinary-upload';

export interface PostCommentInput {
  body: string;
  image: File | null;
}

// Stateless wrapper around the comments API, shared by every surface that
// reads/posts a thread (My Position, the queue-list per-entry accordion, and
// the one-shot join-modal note). No caching/signals here — each caller owns
// its own loading/error/thread state, since threads are per-entry, short-
// lived (hard-deleted when the visit ends), and there's no live update
// mechanism to keep a shared cache fresh against (comments spec: manual
// refresh only, no sockets).
@Injectable({ providedIn: 'root' })
export class CommentsService {
  private readonly _http = inject(HttpClient);
  private readonly _apiConfig = inject(ApiConfiguration);

  list(queueId: string, entryId: string): Observable<CommentResponseDto[]> {
    return commentsControllerList(this._http, this._apiConfig.rootUrl, {
      queueId,
      entryId,
    }).pipe(map((res) => res.body));
  }

  // Uploads the image (if any) straight to Cloudinary first, then posts the
  // comment with the resulting URL/publicId — same two-step pattern as media
  // uploads, and for the same reason: a multipart POST to our own API emptied
  // its body whenever a service worker was registered, so nothing in this
  // feature sends a file to our backend directly.
  post(queueId: string, entryId: string, input: PostCommentInput): Observable<CommentResponseDto> {
    if (!input.image) {
      return this._create(queueId, entryId, { body: input.body || undefined });
    }
    return uploadToCloudinary(this._http, input.image).pipe(
      switchMap((uploaded) =>
        this._create(queueId, entryId, {
          body: input.body || undefined,
          imageUrl: uploaded.secure_url,
          imagePublicId: uploaded.public_id,
        }),
      ),
    );
  }

  private _create(
    queueId: string,
    entryId: string,
    body: { body?: string; imageUrl?: string; imagePublicId?: string },
  ): Observable<CommentResponseDto> {
    return commentsControllerCreate(this._http, this._apiConfig.rootUrl, {
      queueId,
      entryId,
      body,
    }).pipe(map((res) => res.body));
  }
}
