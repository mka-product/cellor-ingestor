import { useState } from "react";

import type { AnnotationComment } from "../../domain/workspace";
import { FloatingPanelFrame } from "./FloatingPanelFrame";

type Thread = { comment: AnnotationComment; replies: AnnotationComment[] };

type Props = {
  comments: Thread[];
  position: { x: number; y: number };
  zIndex: number;
  onPositionChange: (position: { x: number; y: number }) => void;
  onBringToFront: () => void;
  onClose: () => void;
  onAddComment: (body: string, parentId: string | null) => Promise<void>;
  onUpdateComment: (commentId: string, body: string, author: string) => Promise<void>;
  onDeleteComment: (commentId: string) => Promise<void>;
};

export function CommentsPanel(props: Props) {
  const [draft, setDraft] = useState("");
  const [replyTarget, setReplyTarget] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState("");

  return (
    <FloatingPanelFrame
      panelId="comments"
      title="Comments"
      position={props.position}
      zIndex={props.zIndex}
      subtitle={`${props.comments.length} thread${props.comments.length === 1 ? "" : "s"}`}
      onPositionChange={props.onPositionChange}
      onBringToFront={props.onBringToFront}
      onClose={props.onClose}
    >
      <div className="workspace-comments workspace-stack">
        <textarea rows={3} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Add a review comment" />
        <button
          type="button"
          onClick={() => {
            if (!draft.trim()) return;
            void props.onAddComment(draft.trim(), null).then(() => setDraft(""));
          }}
        >
          Add Comment
        </button>
        {props.comments.length === 0 ? <div className="workspace-empty">No comments yet.</div> : null}
        {props.comments.map(({ comment, replies }) => (
          <div key={comment.id} className="workspace-comment-thread">
            <div className="workspace-comment-card">
              <div className="workspace-row">
                <strong>{comment.author}</strong>
                <div className="workspace-inline-actions">
                  <button
                    type="button"
                    className="workspace-icon-button"
                    onClick={() => {
                      setEditingCommentId(comment.id);
                      setEditingDraft(comment.body);
                    }}
                  >
                    ✎
                  </button>
                  <button type="button" className="workspace-icon-button" onClick={() => setReplyTarget(comment.id)}>
                    ↳
                  </button>
                  <button type="button" className="workspace-icon-button danger" onClick={() => void props.onDeleteComment(comment.id)}>
                    ×
                  </button>
                </div>
              </div>
              {editingCommentId === comment.id ? (
                <>
                  <textarea rows={3} value={editingDraft} onChange={(event) => setEditingDraft(event.target.value)} />
                  <button
                    type="button"
                    onClick={() =>
                      void props.onUpdateComment(comment.id, editingDraft, comment.author).then(() => {
                        setEditingCommentId(null);
                        setEditingDraft("");
                      })
                    }
                  >
                    Save
                  </button>
                </>
              ) : (
                <p>{comment.body}</p>
              )}
              <div className="workspace-panel__subtle">{new Date(comment.createdAt).toLocaleString()}</div>
            </div>
            {replyTarget === comment.id ? (
              <div className="workspace-reply-box">
                <textarea rows={2} value={replyDraft} onChange={(event) => setReplyDraft(event.target.value)} placeholder="Reply to comment" />
                <div className="workspace-inline-actions">
                  <button
                    type="button"
                    onClick={() =>
                      void props.onAddComment(replyDraft.trim(), comment.id).then(() => {
                        setReplyDraft("");
                        setReplyTarget(null);
                      })
                    }
                  >
                    Reply
                  </button>
                  <button type="button" className="workspace-icon-button" onClick={() => setReplyTarget(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
            {replies.length > 0 ? (
              <div className="workspace-replies">
                {replies.map((reply) => (
                  <div key={reply.id} className="workspace-comment-card is-reply">
                    <div className="workspace-row">
                      <strong>{reply.author}</strong>
                      <button type="button" className="workspace-icon-button danger" onClick={() => void props.onDeleteComment(reply.id)}>
                        ×
                      </button>
                    </div>
                    <p>{reply.body}</p>
                    <div className="workspace-panel__subtle">{new Date(reply.createdAt).toLocaleString()}</div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </FloatingPanelFrame>
  );
}
