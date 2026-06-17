import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOutletContext } from 'react-router-dom';
import { Editor } from 'primereact/editor';
import { Message } from 'primereact/message';
import { Dropdown } from 'primereact/dropdown';
import { apiClient } from '../api/client.js';

export function CreateProjectPage() {
  const navigate = useNavigate();
  const [error, setError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [tenants, setTenants] = useState([]);
  const [selectedTenant, setSelectedTenant] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [loadingTenants, setLoadingTenants] = useState(true);
  
  // Get outlet context - must be called unconditionally
  const outletContext = useOutletContext();
  const projectForm = outletContext?.projectForm;
  const onCreateProject = outletContext?.onCreateProject;
  
  // Use outlet context form if available, otherwise use local state
  const [localName, setLocalName] = useState('');
  const [localDescription, setLocalDescription] = useState('');
  
  const name = projectForm?.fields?.name || localName;
  const description = projectForm?.fields?.description || localDescription;
  
  // Fetch current user and available tenants
  useEffect(() => {
    const fetchData = async () => {
      try {
        // Get current user info
        const userData = await apiClient.get('/auth/me');
        setCurrentUser(userData);
        
        // Get available tenants
        const tenantsData = await apiClient.get('/auth/tenants');
        setTenants(tenantsData);
        
        // Set default tenant to current user's tenant
        if (tenantsData.length > 0) {
          const defaultTenant = tenantsData.find(t => t.name === userData.tenant_id) || tenantsData[0];
          setSelectedTenant(defaultTenant);
        }
      } catch (err) {
        console.error('Failed to fetch tenants:', err);
      } finally {
        setLoadingTenants(false);
      }
    };
    
    fetchData();
  }, []);

  // Debug: Verify component mounts
  useEffect(() => {
    console.log('[CreateProjectPage] Component mounted', {
      hasProjectForm: !!projectForm,
      hasOnCreateProject: typeof onCreateProject === 'function',
      outletContextKeys: outletContext ? Object.keys(outletContext) : 'no context'
    });
  }, [outletContext, projectForm, onCreateProject]);

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    
    console.log('[CreateProjectPage] handleSubmit called', { 
      hasProjectForm: !!projectForm,
      hasOnCreateProject: typeof onCreateProject === 'function',
      name: name?.trim(),
      isSubmitting
    });
    
    if (isSubmitting) {
      console.log('[CreateProjectPage] Already submitting, ignoring click');
      return;
    }
    
    const trimmedName = name?.trim();
    if (!trimmedName) {
      setError('Project name is required');
      return;
    }
    
    setError(null);
    setIsSubmitting(true);
    
    try {
      // Try using outlet context function first, fallback to direct API call
      if (typeof onCreateProject === 'function') {
        console.log('[CreateProjectPage] Calling onCreateProject from outlet context...');
        await onCreateProject();
      } else {
        console.log('[CreateProjectPage] onCreateProject not available, calling API directly...');
        const payload = {
          name: trimmedName,
          description: description?.trim() || null,
        };
        
        // Only include tenant_id if it's different from current user's tenant
        // or if user has multiple tenants
        if (selectedTenant && selectedTenant.name !== currentUser?.tenant_id) {
          payload.tenant_id = selectedTenant.name;
        }
        
        const response = await apiClient.post('/projects', payload);
        console.log('[CreateProjectPage] Project created via direct API call:', response);
        // Reset local form if using local state
        if (!projectForm) {
          setLocalName('');
          setLocalDescription('');
        }
      }
      console.log('[CreateProjectPage] Project created successfully, navigating...');
      navigate('/projects');
    } catch (err) {
      console.error('[CreateProjectPage] Error creating project:', err);
      const errorMessage = err?.response?.data?.detail || err?.message || 'Failed to create project';
      setError(errorMessage);
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    navigate('/projects');
  };

  return (
    <section className="celnight-section">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--celnight-space-xl)' }}>
        <h1 className="section-title">Create project</h1>
        <button
          type="button"
          className="celnight-chip"
          onClick={handleCancel}
        >
          Cancel
        </button>
      </div>
      <div className="celnight-form">
        <p className="celnight-form__description">Spin up a new Celloris workspace.</p>
        
        {error && (
          <div style={{ marginBottom: '1rem' }}>
            <Message severity="error" text={error} style={{ width: '100%' }} />
          </div>
        )}

        <div className="celnight-form__fields">
          {/* Tenant selector - only show if user has multiple tenants or is admin */}
          {!loadingTenants && tenants.length > 1 && (
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', color: 'var(--celnight-text-secondary)' }}>
                Tenant
              </label>
              <Dropdown
                value={selectedTenant}
                options={tenants}
                onChange={(e) => setSelectedTenant(e.value)}
                optionLabel="name"
                placeholder="Select tenant"
                className="celnight-input"
                style={{ width: '100%' }}
                filter
                filterBy="name"
              />
            </div>
          )}
          <input
            type="text"
            className="celnight-input"
            placeholder="Project name"
            value={name || ''}
            onChange={(e) => {
              const value = e.target.value;
              console.log('[CreateProjectPage] Name changed:', value);
              if (projectForm?.handleChange) {
                projectForm.handleChange('name')(e);
              } else {
                setLocalName(value);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && name?.trim() && !isSubmitting) {
                handleSubmit(e);
              }
            }}
          />
          <div className="celnight-editor-wrapper">
            <label className="celnight-editor-label">Description (optional)</label>
            <Editor
              value={description || ''}
              onTextChange={(e) => {
                const value = e.htmlValue || '';
                if (projectForm?.handleChange) {
                  projectForm.handleChange('description')({ target: { value } });
                } else {
                  setLocalDescription(value);
                }
              }}
              style={{ height: '200px' }}
              className="celnight-editor"
            />
          </div>
        </div>
        <button 
          className="celnight-button" 
          type="button" 
          onClick={(e) => {
            console.log('[CreateProjectPage] Button clicked!', { 
              disabled: !name?.trim(),
              isSubmitting,
              hasHandler: typeof handleSubmit === 'function',
              name: name,
              nameLength: name?.length
            });
            handleSubmit(e);
          }} 
          disabled={!name?.trim() || isSubmitting}
          style={{ cursor: (name?.trim() && !isSubmitting) ? 'pointer' : 'not-allowed' }}
        >
          {isSubmitting ? 'Creating...' : 'Create project'}
        </button>
      </div>
    </section>
  );
}

