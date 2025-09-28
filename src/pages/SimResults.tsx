// src/pages/SimResults.tsx
import { useState } from 'react';
import { http } from '../api/http';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
  Bar,
} from 'recharts';

export default function SimResults() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setErr(null);
    try {
      const params = {
        months: 1,
        numClients: 1000,
        requestsPerDayMean: 12,
        serviceMinutesMean: 45,
        serviceMinutesStd: 15,
        useTraffic: false,
        crossDoctor: true,
        sampleDaysPct: 0.4,
        seed: 42,
      };
      const { data } = await http.post('/sim/run', params);
      setData(data);
    } catch (e: any) {
      setErr(e?.response?.data?.message || e?.message || 'Run failed');
    } finally {
      setLoading(false);
    }
  }

  const perDay =
    data?.perDay?.map((d: any) => ({
      day: d.date,
      doctor: d.doctorPimsId,
      baselineDriveMin: Math.round(d.baselineDriveSec / 60),
      optimDriveMin: Math.round(d.optimizedDriveSec / 60),
      baselineAppts: d.baselineAppts,
      optimAppts: d.optimizedAppts,
      baselineRejected: d.baselineRejected,
      optimRejected: d.optimizedRejected,
    })) ?? [];

  const dailyAggregates = aggregateByDate(perDay);

  return (
    <div className="card">
      <h2>Routing Simulation</h2>
      <button className="btn" disabled={loading} onClick={run}>
        {loading ? 'Running…' : 'Run 6-month Simulation'}
      </button>
      {err && (
        <div className="danger" style={{ marginTop: 8 }}>
          {err}
        </div>
      )}
      {!data && (
        <p className="muted" style={{ marginTop: 8 }}>
          Click run to generate results.
        </p>
      )}

      {data && (
        <>
          <div style={{ display: 'grid', gap: 24, marginTop: 16 }}>
            <div className="card">
              <h3>Drive Minutes per Day (sum across doctors)</h3>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={dailyAggregates}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="day" hide />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="baselineDriveMin" name="Baseline" dot={false} />
                  <Line type="monotone" dataKey="optimDriveMin" name="Optimized" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="card">
              <h3>Appointments per Day</h3>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={dailyAggregates}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="day" hide />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="baselineAppts" name="Baseline" dot={false} />
                  <Line type="monotone" dataKey="optimAppts" name="Optimized" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="card">
              <h3>Rejections per Day</h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={dailyAggregates}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="day" hide />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="baselineRejected" name="Baseline Rejected" />
                  <Bar dataKey="optimRejected" name="Optimized Rejected" />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="card">
              <h3>Totals</h3>
              <p>
                Baseline drive: <b>{Math.round(data.totals.baselineDriveMin)}</b> min · Optimized
                drive: <b>{Math.round(data.totals.optimizedDriveMin)}</b> min
              </p>
              <p>
                Baseline appts: <b>{data.totals.baselineAppts}</b> · Optimized appts:{' '}
                <b>{data.totals.optimizedAppts}</b>
              </p>
              <p>
                Baseline rejected: <b>{data.totals.baselineRejected}</b> · Optimized rejected:{' '}
                <b>{data.totals.optimizedRejected}</b>
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function aggregateByDate(rows: any[]) {
  const map = new Map<string, any>();
  for (const r of rows) {
    const m = map.get(r.day) ?? {
      day: r.day,
      baselineDriveMin: 0,
      optimDriveMin: 0,
      baselineAppts: 0,
      optimAppts: 0,
      baselineRejected: 0,
      optimRejected: 0,
    };
    m.baselineDriveMin += r.baselineDriveMin;
    m.optimDriveMin += r.optimDriveMin;
    m.baselineAppts += r.baselineAppts;
    m.optimAppts += r.optimAppts;
    m.baselineRejected += r.baselineRejected;
    m.optimRejected += r.optimRejected;
    map.set(r.day, m);
  }
  return Array.from(map.values());
}
