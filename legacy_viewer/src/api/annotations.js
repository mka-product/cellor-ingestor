import { apiClient } from './client';

export const annotationsApi = {
  // Layers
  getLayers: (slideId) => apiClient.get(`/slides/${slideId}/layers`),
  
  createLayer: (slideId, layerData) => apiClient.post(`/slides/${slideId}/layers`, layerData),
  
  updateLayer: (layerId, layerData) => apiClient.patch(`/layers/${layerId}`, layerData),
  
  deleteLayer: (layerId) => apiClient.delete(`/layers/${layerId}`),
  
  // Annotations
  getAnnotations: (slideId, filters = {}) => {
    const params = new URLSearchParams();
    if (filters.layerId) params.append('layer_id', filters.layerId);
    if (filters.status) params.append('status', filters.status);
    
    const queryString = params.toString() ? `?${params.toString()}` : '';
    return apiClient.get(`/slides/${slideId}/annotations${queryString}`);
  },
  
  createAnnotation: (layerId, annotation) => apiClient.post(`/layers/${layerId}/annotations`, annotation),
  
  getAnnotation: (annotationId) => apiClient.get(`/annotations/${annotationId}`),
  
  updateAnnotation: (annotationId, annotation) => apiClient.patch(`/annotations/${annotationId}`, annotation),
  
  deleteAnnotation: (annotationId) => apiClient.delete(`/annotations/${annotationId}`),
  
  // Comments
  listComments: (annotationId, parentId = null) => {
    const params = new URLSearchParams();
    if (parentId) params.append('parent_id', parentId);
    const queryString = params.toString() ? `?${params.toString()}` : '';
    return apiClient.get(`/annotations/${annotationId}/comments${queryString}`);
  },
  
  createComment: (annotationId, content, parentId = null) => 
    apiClient.post(`/annotations/${annotationId}/comments`, { content, parent_id: parentId }),
  
  getComment: (commentId) => apiClient.get(`/comments/${commentId}`),
  
  updateComment: (commentId, content) => 
    apiClient.patch(`/comments/${commentId}`, { content }),
  
  deleteComment: (commentId) => apiClient.delete(`/comments/${commentId}`),
  
  listReplies: (commentId) => apiClient.get(`/comments/${commentId}/replies`),
  
  // Get collaborators for @mentions (from project/dataset memberships)
  getCollaborators: (projectId, datasetId) => {
    // This would need to be added to the backend, or we can fetch from project/dataset members
    // For now, we'll use tenant users endpoint
    return apiClient.get(`/auth/tenant/users`);
  },
};
