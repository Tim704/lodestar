import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import { Shell } from './components/Shell';
import { Spinner } from './components/ui';
import LoginPage from './pages/Login';
import TodayPage from './pages/Today';
import TasksPage from './pages/Tasks';
import FocusPage from './pages/Focus';
import CalendarPage from './pages/Calendar';
import StudyPage from './pages/Study';
import NotesPage from './pages/Notes';
import BacklogPage from './pages/Backlog';
import WatchersPage from './pages/Watchers';
import ReviewPage from './pages/Review';
import SettingsPage from './pages/Settings';

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner label="Finding north…" />
      </div>
    );
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Shell>
      <Routes>
        <Route path="/" element={<TodayPage />} />
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/focus" element={<FocusPage />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/study" element={<StudyPage />} />
        <Route path="/notes" element={<NotesPage />} />
        <Route path="/backlog" element={<BacklogPage />} />
        <Route path="/watchers" element={<WatchersPage />} />
        <Route path="/review" element={<ReviewPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}
