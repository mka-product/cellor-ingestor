import React, { useState, useEffect, useRef } from 'react';
import { annotationsApi } from '../../api/annotations';
import { apiClient } from '../../api/client';

export function CommentsPanel({ annotation, isOpen, onClose, currentUserId }) {
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [replyingTo, setReplyingTo] = useState(null);
  const [editingComment, setEditingComment] = useState(null);
  const [newComment, setNewComment] = useState('');
  const [replyText, setReplyText] = useState({});
  const [editText, setEditText] = useState({});
  const [expandedReplies, setExpandedReplies] = useState(new Set());
  const [repliesByCommentId, setRepliesByCommentId] = useState({});
  const [collaborators, setCollaborators] = useState([]);
  const [mentionSuggestions, setMentionSuggestions] = useState([]);
  const [currentInputRef, setCurrentInputRef] = useState(null);
  
  const panelRef = useRef(null);
  const scrollRef = useRef(null);
  const dragRef = useRef({ active: false, startX: 0, startY: 0, initialX: 0, initialY: 0 });
  const pollingIntervalRef = useRef(null);
  
  const [position, setPosition] = useState({ 
    x: window.innerWidth - 680, // Position next to annotation panel
    y: 100 
  });

  // Fetch comments
  const fetchComments = async () => {
    if (!annotation?.id) return;
    
    setLoading(true);
    setError(null);
    try {
      const data = await annotationsApi.listComments(annotation.id);
      setComments(data || []);
    } catch (err) {
      console.error('Failed to fetch comments:', err);
      setError('Failed to load comments');
    } finally {
      setLoading(false);
    }
  };

  // Fetch replies for a comment
  const fetchReplies = async (commentId) => {
    try {
      const replies = await annotationsApi.listReplies(commentId);
      return replies || [];
    } catch (err) {
      console.error('Failed to fetch replies:', err);
      return [];
    }
  };

  // Load comments when annotation changes
  useEffect(() => {
    if (isOpen && annotation?.id) {
      fetchComments();
      
      // Start polling for real-time updates (every 5 seconds)
      pollingIntervalRef.current = setInterval(() => {
        fetchComments();
      }, 5000);
    }
    
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, [isOpen, annotation?.id]);

  // Fetch collaborators for @mentions
  useEffect(() => {
    if (isOpen && annotation?.id) {
      apiClient.get('/auth/tenant/users')
        .then(users => {
          setCollaborators(users || []);
        })
        .catch(err => {
          console.error('Failed to fetch collaborators:', err);
        });
    }
  }, [isOpen, annotation?.id]);

  // Load replies when expanded
  useEffect(() => {
    const loadReplies = async () => {
      const toLoad = Array.from(expandedReplies).filter(
        commentId => !repliesByCommentId[commentId] && comments.find(c => c.id === commentId)?.replies_count > 0
      );
      
      for (const commentId of toLoad) {
        const replies = await fetchReplies(commentId);
        setRepliesByCommentId(prev => ({ ...prev, [commentId]: replies }));
      }
    };
    
    if (expandedReplies.size > 0 && comments.length > 0) {
      loadReplies();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedReplies, comments.length]);

  // Handle @mention detection
  const handleMentionInput = (text, inputRef, setTextFn) => {
    setCurrentInputRef(inputRef);
    const cursorPos = inputRef.selectionStart;
    const textBeforeCursor = text.substring(0, cursorPos);
    const match = textBeforeCursor.match(/@(\w*)$/);
    
    if (match) {
      const query = match[1].toLowerCase();
      const filtered = collaborators
        .filter(c => c.username && c.username.toLowerCase().includes(query))
        .slice(0, 5);
      
      if (filtered.length > 0) {
        setMentionSuggestions(filtered);
      } else {
        setMentionSuggestions([]);
      }
    } else {
      setMentionSuggestions([]);
    }
    
    setTextFn(text);
  };

  // Insert mention
  const insertMention = (username, inputRef, text, setTextFn) => {
    const cursorPos = inputRef.selectionStart;
    const textBeforeCursor = text.substring(0, cursorPos);
    const textAfterCursor = text.substring(cursorPos);
    
    // Replace @partial with @username
    const newText = textBeforeCursor.replace(/@\w*$/, `@${username} `) + textAfterCursor;
    setTextFn(newText);
    setMentionSuggestions([]);
    
    // Set cursor after mention
    setTimeout(() => {
      const newPos = textBeforeCursor.replace(/@\w*$/, `@${username} `).length;
      inputRef.setSelectionRange(newPos, newPos);
      inputRef.focus();
    }, 0);
  };

  // Create new comment
  const handleCreateComment = async () => {
    if (!newComment.trim() || !annotation?.id) return;
    
    try {
      await annotationsApi.createComment(annotation.id, newComment.trim());
      setNewComment('');
      await fetchComments();
      // Scroll to bottom
      if (scrollRef.current) {
        setTimeout(() => {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }, 100);
      }
    } catch (err) {
      console.error('Failed to create comment:', err);
      setError('Failed to post comment');
    }
  };

  // Reply to comment
  const handleReply = async (commentId) => {
    const text = replyText[commentId]?.trim();
    if (!text) return;
    
    try {
      await annotationsApi.createComment(annotation.id, text, commentId);
      setReplyText({ ...replyText, [commentId]: '' });
      setReplyingTo(null);
      await fetchComments();
      // Expand replies if collapsed
      setExpandedReplies(prev => new Set([...prev, commentId]));
    } catch (err) {
      console.error('Failed to reply:', err);
      setError('Failed to post reply');
    }
  };

  // Edit comment
  const handleEdit = async (commentId) => {
    const text = editText[commentId]?.trim();
    if (!text) return;
    
    try {
      await annotationsApi.updateComment(commentId, text);
      setEditText({ ...editText, [commentId]: '' });
      setEditingComment(null);
      await fetchComments();
    } catch (err) {
      console.error('Failed to edit comment:', err);
      setError('Failed to update comment');
    }
  };

  // Delete comment
  const handleDelete = async (commentId) => {
    if (!confirm('Delete this comment?')) return;
    
    try {
      await annotationsApi.deleteComment(commentId);
      await fetchComments();
      // Clear replies cache for deleted comment
      setRepliesByCommentId(prev => {
        const next = { ...prev };
        delete next[commentId];
        return next;
      });
    } catch (err) {
      console.error('Failed to delete comment:', err);
      setError('Failed to delete comment');
    }
  };

  // Toggle replies visibility
  const toggleReplies = (commentId) => {
    setExpandedReplies(prev => {
      const next = new Set(prev);
      if (next.has(commentId)) {
        next.delete(commentId);
        // Clear replies cache when collapsed
        setRepliesByCommentId(prevReplies => {
          const nextReplies = { ...prevReplies };
          delete nextReplies[commentId];
          return nextReplies;
        });
      } else {
        next.add(commentId);
      }
      return next;
    });
  };

  // Format date
  const formatDate = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const handlePointerDown = (e) => {
    if (e.target.closest('input') || e.target.closest('textarea') || e.target.closest('button')) return;
    dragRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      initialX: position.x,
      initialY: position.y
    };
    
    const handlePointerMove = (e) => {
      if (!dragRef.current.active) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      setPosition({
        x: dragRef.current.initialX + dx,
        y: dragRef.current.initialY + dy
      });
    };
    
    const handlePointerUp = () => {
      dragRef.current.active = false;
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
    };
    
    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
  };

  // Render comment item (recursive for replies)
  const renderComment = (comment, depth = 0) => {
    const isAuthor = comment.author_keycloak_id === currentUserId;
    const hasReplies = comment.replies_count > 0;
    const isExpanded = expandedReplies.has(comment.id);
    const isEditing = editingComment === comment.id;
    const isReplying = replyingTo === comment.id;
    const replies = isExpanded && depth < 2 ? (repliesByCommentId[comment.id] || []) : [];

    return (
      <div key={comment.id} className="comment-item" style={{ marginLeft: depth * 20 }}>
        <div className="comment-header">
          <span className="comment-author">{comment.author_username || 'Unknown'}</span>
          <span className="comment-time">{formatDate(comment.created_at)}</span>
          {comment.status === 'edited' && <span className="comment-edited">(edited)</span>}
        </div>
        
        {isEditing ? (
          <div className="comment-edit-form">
            <textarea
              value={editText[comment.id] ?? comment.content}
              onChange={(e) => handleMentionInput(e.target.value, e.target, (text) => {
                setEditText({ ...editText, [comment.id]: text });
              })}
              rows={3}
              className="comment-input"
              autoFocus
            />
            {mentionSuggestions.length > 0 && currentInputRef && (
              <div className="mention-suggestions">
                {mentionSuggestions.map(user => (
                  <div
                    key={user.id}
                    className="mention-suggestion"
                    onClick={() => insertMention(
                      user.username,
                      currentInputRef,
                      editText[comment.id] ?? comment.content,
                      (text) => setEditText({ ...editText, [comment.id]: text })
                    )}
                  >
                    @{user.username}
                  </div>
                ))}
              </div>
            )}
            <div className="comment-actions">
              <button onClick={() => handleEdit(comment.id)} className="comment-button">Save</button>
              <button onClick={() => {
                setEditingComment(null);
                setEditText({ ...editText, [comment.id]: '' });
              }} className="comment-button comment-button--ghost">Cancel</button>
            </div>
          </div>
        ) : (
          <>
            <div className="comment-content">{comment.content}</div>
            
            <div className="comment-footer">
              <div className="comment-footer__left">
                {depth < 2 && (
                  <button
                    onClick={() => {
                      setReplyingTo(isReplying ? null : comment.id);
                      if (!isReplying) {
                        setReplyText({ ...replyText, [comment.id]: '' });
                      }
                    }}
                    className="comment-link"
                  >
                    Reply
                  </button>
                )}
                {isAuthor && (
                  <>
                    <button
                      onClick={() => {
                        setEditingComment(comment.id);
                        setEditText({ ...editText, [comment.id]: comment.content });
                      }}
                      className="comment-link"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(comment.id)}
                      className="comment-link comment-link--danger"
                    >
                      Delete
                    </button>
                  </>
                )}
              </div>
              
              <div className="comment-footer__right">
                {hasReplies && (
                  <button
                    onClick={() => toggleReplies(comment.id)}
                    className="comment-toggle-replies"
                    title={isExpanded ? "Hide replies" : `Show ${comment.replies_count} ${comment.replies_count === 1 ? 'reply' : 'replies'}`}
                  >
                    {isExpanded ? (
                      <span>See less</span>
                    ) : (
                      <span>{comment.replies_count} {comment.replies_count === 1 ? 'reply' : 'replies'}</span>
                    )}
                  </button>
                )}
              </div>
            </div>
            
            {isReplying && (
              <div className="comment-reply-form">
                <textarea
                  value={replyText[comment.id] || ''}
                  onChange={(e) => handleMentionInput(e.target.value, e.target, (text) => {
                    setReplyText({ ...replyText, [comment.id]: text });
                  })}
                  rows={3}
                  className="comment-input"
                  placeholder="Write a reply..."
                  autoFocus
                />
                {mentionSuggestions.length > 0 && currentInputRef && (
                  <div className="mention-suggestions">
                    {mentionSuggestions.map(user => (
                      <div
                        key={user.id}
                        className="mention-suggestion"
                        onClick={() => insertMention(
                          user.username,
                          currentInputRef,
                          replyText[comment.id] || '',
                          (text) => setReplyText({ ...replyText, [comment.id]: text })
                        )}
                      >
                        @{user.username}
                      </div>
                    ))}
                  </div>
                )}
                <div className="comment-actions">
                  <button
                    onClick={() => handleReply(comment.id)}
                    className="comment-button"
                    disabled={!replyText[comment.id]?.trim()}
                  >
                    Post Reply
                  </button>
                  <button
                    onClick={() => {
                      setReplyingTo(null);
                      setReplyText({ ...replyText, [comment.id]: '' });
                    }}
                    className="comment-button comment-button--ghost"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
            
            {isExpanded && hasReplies && depth < 2 && (
              <div className="comment-replies">
                {replies.map(reply => renderComment(reply, depth + 1))}
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  if (!isOpen || !annotation) return null;

  return (
    <div
      ref={panelRef}
      className="comments-panel"
      style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
    >
      <div className="comments-panel__header" onPointerDown={handlePointerDown}>
        <h3>
          Comments
          {comments.length > 0 && <span className="comments-count">({comments.length})</span>}
        </h3>
        <button className="comments-panel__close" onClick={onClose}>×</button>
      </div>
      
      <div className="comments-panel__content" ref={scrollRef}>
        {error && (
          <div className="comments-error">{error}</div>
        )}
        
        {loading && comments.length === 0 ? (
          <div className="comments-loading">Loading comments...</div>
        ) : comments.length === 0 ? (
          <div className="comments-empty">No comments yet. Be the first to comment!</div>
        ) : (
          <div className="comments-list">
            {comments.map(comment => renderComment(comment))}
          </div>
        )}
      </div>
      
      <div className="comments-panel__input">
        <textarea
          value={newComment}
          onChange={(e) => handleMentionInput(e.target.value, e.target, setNewComment)}
          rows={3}
          className="comment-input"
          placeholder="Add a comment... (Use @ to mention someone)"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              handleCreateComment();
            }
          }}
        />
        {mentionSuggestions.length > 0 && currentInputRef && (
          <div className="mention-suggestions">
            {mentionSuggestions.map(user => (
              <div
                key={user.id}
                className="mention-suggestion"
                onClick={() => insertMention(
                  user.username,
                  currentInputRef,
                  newComment,
                  setNewComment
                )}
              >
                @{user.username}
              </div>
            ))}
          </div>
        )}
        <div className="comment-actions">
          <button
            onClick={handleCreateComment}
            className="comment-button"
            disabled={!newComment.trim()}
          >
            Post Comment (Ctrl+Enter)
          </button>
        </div>
      </div>
    </div>
  );
}
