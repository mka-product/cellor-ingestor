import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Logo } from './components/Logo.jsx';
import { apiClient } from './api/client.js';
import { useFormFields } from './hooks/useFormFields.js';
import { ProjectsPage } from './pages/ProjectsPage.jsx';
import { DatasetsPage } from './pages/DatasetsPage.jsx';
import { SlidesPage } from './pages/SlidesPage.jsx';
import { CreateProjectPage } from './pages/CreateProjectPage.jsx';
import { CreateDatasetPage } from './pages/CreateDatasetPage.jsx';
import { SlideViewerPage } from './pages/SlideViewerPage.jsx';
import { ProfilePage } from './pages/ProfilePage.jsx';
import { AdminPage } from './pages/AdminPage.jsx';
import { useTheme } from './contexts/ThemeContext.jsx';
import { ProfileMenu } from './components/ProfileMenu.jsx';
import { TenantSwitcher } from './components/TenantSwitcher.jsx';

function useAsync(fn, deps = []) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  const run = async (...args) => {
    setPending(true);
    setError(null);
    try {
      const result = await fn(...args);
      return result;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setPending(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  return [run, pending, error];
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<AppShell />}>
        <Route index element={<Navigate to="/projects" replace />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="projects/new" element={<CreateProjectPage />} />
        <Route path="projects/:projectId" element={<DatasetsPage />} />
        <Route path="projects/:projectId/datasets/new" element={<CreateDatasetPage />} />
        <Route path="projects/:projectId/datasets/:datasetId" element={<SlidesPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="admin" element={<AdminPage />} />
        <Route
          path="projects/:projectId/datasets/:datasetId/slides/:slideId/viewer"
          element={<SlideViewerPage />}
        />
      </Route>
    </Routes>
  );
}

function AppShell() {
  const { theme, toggleTheme } = useTheme();
  const [projects, setProjects] = useState([]);
  const [datasets, setDatasets] = useState([]);
  const [slides, setSlides] = useState([]);

  const projectForm = useFormFields({ name: '', description: '' });
  const datasetForm = useFormFields({ name: '', description: '' });
  const slideForm = useFormFields({ name: '', file_path: '' });

  const location = useLocation();
  const navigate = useNavigate();

  const pathSegments = location.pathname.split('/').filter(Boolean);
  const selectedProjectId = pathSegments[0] === 'projects' ? pathSegments[1] || null : null;
  const selectedDatasetId =
    pathSegments[0] === 'projects' && pathSegments[2] === 'datasets' ? pathSegments[3] || null : null;

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) || null,
    [projects, selectedProjectId],
  );
  const selectedDataset = useMemo(
    () => datasets.find((dataset) => dataset.id === selectedDatasetId) || null,
    [datasets, selectedDatasetId],
  );

  const [fetchProjects] = useAsync(async () => {
    const data = await apiClient.get('/projects');
    setProjects(data);
  }, []);

  const [fetchDatasets] = useAsync(async (projectId) => {
    if (!projectId) {
      setDatasets([]);
      return;
    }
    const data = await apiClient.get(`/datasets/by-project/${projectId}`);
    setDatasets(data);
  }, []);

  const [fetchSlides] = useAsync(async (datasetId) => {
    if (!datasetId || datasetId === 'new') {
      setSlides([]);
      return;
    }
    const data = await apiClient.get(`/slides-meta/by-dataset/${datasetId}`);
    setSlides(data);
  }, []);

  useEffect(() => {
    fetchProjects();
  }, []);

  useEffect(() => {
    // Only fetch datasets if selectedProjectId is a valid UUID (not "new")
    if (selectedProjectId && selectedProjectId !== 'new') {
      fetchDatasets(selectedProjectId);
    } else {
      setDatasets([]);
    }
  }, [selectedProjectId]);

  useEffect(() => {
    if (selectedDatasetId) {
      fetchSlides(selectedDatasetId);
    } else {
      setSlides([]);
    }
  }, [selectedDatasetId]);

  const handleCreateProject = async () => {
    const name = projectForm.fields.name.trim();
    if (!name) {
      return;
    }
    try {
      await apiClient.post('/projects', {
        name,
        description: projectForm.fields.description.trim() || null,
      });
      projectForm.reset();
      await fetchProjects();
    } catch (error) {
      console.error('Failed to create project:', error);
      throw error; // Re-throw so CreateProjectPage can handle it
    }
  };

  const handleCreateDataset = async () => {
    const name = datasetForm.fields.name.trim();
    if (!selectedProjectId || !name) return;
    await apiClient.post(`/datasets/by-project/${selectedProjectId}`, {
      name,
      description: datasetForm.fields.description.trim() || null,
    });
    datasetForm.reset();
    await fetchDatasets(selectedProjectId);
  };

  const handleCreateSlide = async () => {
    const name = slideForm.fields.name.trim();
    if (!selectedDatasetId || !name) return;
    await apiClient.post(`/slides-meta/by-dataset/${selectedDatasetId}`, {
      name,
      file_path: slideForm.fields.file_path.trim() || null,
    });
    slideForm.reset();
    await fetchSlides(selectedDatasetId);
  };

  const handleSelectProject = (projectId) => {
    if (!projectId) {
      navigate('/projects');
      return;
    }
    navigate(`/projects/${projectId}`);
  };

  const handleSelectDataset = (datasetId) => {
    if (!selectedProjectId) return;
    if (!datasetId) {
      navigate(`/projects/${selectedProjectId}`);
      return;
    }
    navigate(`/projects/${selectedProjectId}/datasets/${datasetId}`);
  };

  const explorerLink =
    selectedDataset && selectedDataset.storage_path
      ? `/files?path=${encodeURIComponent(selectedDataset.storage_path.replace('/mnt/storage/', ''))}`
      : '/';

  const outletContext = {
    projects,
    selectedProjectId,
    onSelectProject: handleSelectProject,
    projectForm,
    onCreateProject: handleCreateProject,
    selectedProject,
    datasets,
    selectedDatasetId,
    onSelectDataset: handleSelectDataset,
    datasetForm,
    onCreateDataset: handleCreateDataset,
    slides,
    slideForm,
    onCreateSlide: handleCreateSlide,
    selectedDataset,
    explorerLink,
    fetchSlides,
  };

  return (
    <div className="celnight-app-shell">
      <header className="celnight-topbar">
        <Link to="/projects" className="celnight-topbar__logo-link">
          <Logo className="celnight-topbar__logo" />
        </Link>
        <div className="celnight-topbar__actions">
          <TenantSwitcher />
          <button
            className="celnight-theme-toggle"
            type="button"
            onClick={toggleTheme}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          >
            {theme === 'dark' ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>
          <ProfileMenu />
        </div>
      </header>

      <main className="celnight-content">
        <Outlet context={outletContext} />
      </main>
    </div>
  );
}

export default App;

