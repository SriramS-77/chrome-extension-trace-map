import { createRoot } from 'react-dom/client';
import { SessionsPage } from './SessionsPage';
import '../../src/ui/theme.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');
createRoot(root).render(<SessionsPage />);
