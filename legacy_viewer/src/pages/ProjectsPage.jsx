import { useOutletContext } from 'react-router-dom';
import { ProjectsOverview } from '../components/projects/ProjectsOverview.jsx';

export function ProjectsPage() {
  const { projects, selectedProjectId, onSelectProject } = useOutletContext();

  return (
    <ProjectsOverview
      projects={projects}
      selectedProjectId={selectedProjectId}
      onSelectProject={onSelectProject}
    />
  );
}
