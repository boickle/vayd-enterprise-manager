import RecordsRequestsPage from './RecordsRequestsPage';

/** Scheduling → Records: records requests to and from other hospitals (owner, Nov 13, 2026). */
export default function RecordsPage() {
  return (
    <div className="container">
      <div className="settings-page">
        <h1 className="settings-title">Records</h1>
        <RecordsRequestsPage />
      </div>
    </div>
  );
}
