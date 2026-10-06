import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import BatchView from './components/BatchView.jsx';
import NewListView from './components/NewListView.jsx';
import Sidebar from './components/Sidebar.jsx';
import { Toast } from './components/ui.jsx';

// Tiny hash router: #/lists/12 keeps the open list across refreshes and makes it linkable.
const readHash = () => {
  const m = window.location.hash.match(/^#\/lists\/(\d+)/);
  return m ? Number(m[1]) : null;
};

export default function App() {
  const [meta, setMeta] = useState(null);
  const [health, setHealth] = useState(null);
  const [batches, setBatches] = useState([]);
  const [activeId, setActiveId] = useState(readHash);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  const notify = useCallback((message) => {
    setToast({ message });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  }, []);

  const refreshBatches = useCallback(() => {
    api.listBatches().then(setBatches).catch(() => {});
  }, []);

  useEffect(() => {
    api.meta().then(setMeta).catch(() => notify('Cannot reach the LeadLens API. Is the server running?'));
    api.health().then(setHealth).catch(() => {});
    refreshBatches();
    const onHash = () => setActiveId(readHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [notify, refreshBatches]);

  const open = (id) => {
    window.location.hash = id ? `/lists/${id}` : '';
    setActiveId(id);
  };

  return (
    <div className="flex h-full flex-col md:flex-row">
      <Sidebar batches={batches} activeId={activeId} onSelect={open} onNew={() => open(null)} health={health} />
      <main className="min-w-0 flex-1 overflow-y-auto">
        {activeId === null ? (
          <NewListView
            meta={meta}
            notify={notify}
            onCreated={(id) => {
              refreshBatches();
              open(id);
            }}
          />
        ) : (
          <BatchView
            key={activeId}
            batchId={activeId}
            notify={notify}
            onChanged={refreshBatches}
            onDeleted={() => {
              refreshBatches();
              open(null);
            }}
          />
        )}
      </main>
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
