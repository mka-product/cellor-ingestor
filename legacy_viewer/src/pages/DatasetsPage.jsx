import { useState, useEffect } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { Editor } from 'primereact/editor';
import { DatasetsOverview } from '../components/datasets/DatasetsOverview.jsx';
import { ProjectMembers } from '../components/projects/ProjectMembers.jsx';
import { ProjectActivity } from '../components/projects/ProjectActivity.jsx';
import { apiClient } from '../api/client.js';

export function DatasetsPage() {
  const {
    selectedProject,
    datasets,
    selectedDatasetId,
    onSelectDataset,
  } = useOutletContext();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState(0);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [localProject, setLocalProject] = useState(selectedProject);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [titleValue, setTitleValue] = useState(selectedProject?.name || '');
  const [descriptionValue, setDescriptionValue] = useState(selectedProject?.description || '');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setLocalProject(selectedProject);
    setTitleValue(selectedProject?.name || '');
    setDescriptionValue(selectedProject?.description || '');
  }, [selectedProject]);

  useEffect(() => {
    // Fetch current user info to get keycloak_id
    apiClient.get('/auth/me')
      .then(data => {
        setCurrentUserId(data.keycloak_id);
      })
      .catch(err => {
        console.warn('Failed to fetch current user:', err);
      });
  }, []);

  const tabs = [
    { label: 'Overview', index: 0 },
    { label: 'Members', index: 1 },
    { label: 'Activity', index: 2 },
  ];

  const formatDate = (dateString) => {
    if (!dateString) return '—';
    return new Date(dateString).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' });
  };

  const saveProject = async (payload) => {
    if (!localProject) return null;
    setIsSaving(true);
    try {
      const updated = await apiClient.patch(`/projects/${localProject.id}`, payload);
      setLocalProject(updated);
      setTitleValue(updated.name || '');
      setDescriptionValue(updated.description || '');
      return updated;
    } catch (err) {
      console.error('Failed to update project', err);
      alert('Failed to update project');
      return null;
    } finally {
      setIsSaving(false);
    }
  };

  if (!selectedProject) {
    return (
      <section className="celnight-section celnight-section--flat">
        <div className="section-empty">Select a project to view datasets and members.</div>
      </section>
    );
  }

  return (
    <section className="celnight-section celnight-section--flat">
      {/* Breadcrumb, Title, and Description outside tabs */}
      <div className="celnight-breadcrumb">
        <button
          type="button"
          className="celnight-breadcrumb__link"
          onClick={() => navigate('/projects')}
        >
          Projects
        </button>
        <span> / </span>
        <button
          type="button"
          className="celnight-breadcrumb__link"
          onClick={() => navigate(`/projects/${selectedProject.id}`)}
        >
          {selectedProject.name}
        </button>
      </div>
      {/* Custom Tabs matching admin section style */}
      <div className="admin-tabs">
        {tabs.map((tab) => (
          <button
            key={tab.index}
            className={`admin-tab ${activeTab === tab.index ? 'admin-tab--active' : ''}`}
            onClick={() => setActiveTab(tab.index)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="admin-tab-content">
        {activeTab === 0 && (
          <div className="celnight-section celnight-section--flat">
            <div className="project-overview-grid">
              <div className="project-overview-main">
                <div className="project-overview-editable project-overview-title-row">
                  {isEditingTitle ? (
                    <div style={{ display: 'flex', gap: 'var(--celnight-space-sm)', alignItems: 'center' }}>
                      <input
                        type="text"
                        className="celnight-input"
                        value={titleValue}
                        onChange={(e) => setTitleValue(e.target.value)}
                        style={{ flex: 1 }}
                        disabled={isSaving}
                      />
                      <button
                        type="button"
                        className="celnight-button"
                        onClick={async () => {
                          const updated = await saveProject({ name: titleValue, description: descriptionValue });
                          if (updated) setIsEditingTitle(false);
                        }}
                        disabled={isSaving || !titleValue.trim()}
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        className="celnight-button celnight-button--ghost"
                        onClick={() => {
                          setTitleValue(localProject?.name || '');
                          setIsEditingTitle(false);
                        }}
                        disabled={isSaving}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <h2 className="projects-page-title project-overview-title">
                      {localProject?.name}
                    </h2>
                  )}
                  {!isEditingTitle && (
                    <button
                      type="button"
                      className="project-inline-edit-button"
                      onClick={() => setIsEditingTitle(true)}
                      aria-label="Edit title"
                    >
                      ✎
                    </button>
                  )}
                </div>
                <div className="project-overview-editable" style={{ marginTop: 'var(--celnight-space-lg)' }}>
                  <div className="project-overview-description-row">
                    <h3 style={{ margin: 0 }}>Description</h3>
                    {!isEditingDescription && (
                      <button
                        type="button"
                        className="project-inline-edit-button"
                        onClick={() => setIsEditingDescription(true)}
                        aria-label="Edit description"
                        style={{ marginLeft: 'auto' }}
                      >
                        ✎
                      </button>
                    )}
                  </div>
                  {isEditingDescription ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--celnight-space-sm)' }}>
                      <Editor
                        value={descriptionValue}
                        onTextChange={(e) => setDescriptionValue(e.htmlValue || '')}
                        style={{ height: '200px' }}
                        className="celnight-editor"
                        readOnly={isSaving}
                      />
                      <div style={{ display: 'flex', gap: 'var(--celnight-space-sm)' }}>
                        <button
                          type="button"
                          className="celnight-button"
                          onClick={async () => {
                            const updated = await saveProject({ name: titleValue, description: descriptionValue });
                            if (updated) setIsEditingDescription(false);
                          }}
                          disabled={isSaving}
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          className="celnight-button celnight-button--ghost"
                          onClick={() => {
                            setDescriptionValue(localProject?.description || '');
                            setIsEditingDescription(false);
                          }}
                          disabled={isSaving}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {localProject?.description ? (
                        <div
                          className="section-subtitle"
                          dangerouslySetInnerHTML={{ __html: localProject.description }}
                        />
                      ) : (
                        <p className="section-subtitle">No description yet</p>
                      )}
                    </>
                  )}
                </div>
              </div>
              <div className="project-overview-meta">
                <h3 className="project-overview-meta__title">Project info</h3>
                <ul className="project-overview-meta__list">
                  <li>
                    <span className="project-overview-meta__label">Created:</span>
                    <span className="project-overview-meta__value">{formatDate(localProject?.created_at)}</span>
                  </li>
                  <li>
                    <span className="project-overview-meta__label">Last updated:</span>
                    <span className="project-overview-meta__value">{formatDate(localProject?.updated_at)}</span>
                  </li>
                  <li>
                    <span className="project-overview-meta__label">Datasets:</span>
                    <span className="project-overview-meta__value">{datasets?.length ?? 0}</span>
                  </li>
                </ul>
              </div>
            </div>
            <DatasetsOverview
              project={localProject || selectedProject}
              datasets={datasets}
              selectedDatasetId={selectedDatasetId}
              onSelectDataset={onSelectDataset}
            />
          </div>
        )}
        {activeTab === 1 && (
          <ProjectMembers projectId={selectedProject.id} currentUserId={currentUserId} />
        )}
        {activeTab === 2 && (
          <ProjectActivity projectId={selectedProject.id} />
        )}
      </div>
    </section>
  );
}
