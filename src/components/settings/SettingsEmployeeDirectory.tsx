import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchAllEmployees,
  fetchEmployee,
  fetchEmployeeRoles,
  type Employee,
  type EmployeeRole,
} from '../../api/appointmentSettings';
import {
  deleteEmployees,
  saveEmployees,
  upsertEmployees,
  type EmployeeDto,
} from '../../api/employeesMutations';

const DEFAULT_PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

function extractErr(err: unknown): string {
  const e = err as { response?: { data?: { message?: string } }; message?: string };
  return e?.response?.data?.message ?? e?.message ?? 'Request failed';
}

function empPimsUserId(e: Employee): string {
  const raw = (e as Record<string, unknown>).pimsUserId;
  if (raw == null) return '—';
  return String(raw);
}

function empPimsId(e: Employee): string {
  const raw = (e as Record<string, unknown>).pimsId;
  if (raw == null) return '—';
  return String(raw);
}

function empActive(e: Employee): boolean {
  const r = e as Record<string, unknown>;
  if (r.isActive === false || r.isDeleted === true) return false;
  return true;
}

function str(v: unknown): string {
  if (v == null) return '';
  return String(v);
}

/** Empty string → null for API nullable string fields */
function blankToNull(s: string): string | null {
  const t = s.trim();
  return t === '' ? null : t;
}

type ModalMode = 'add' | 'edit' | null;

type Props = {
  onMessage?: (msg: string, kind: 'success' | 'error') => void;
};

export default function SettingsEmployeeDirectory({ onMessage }: Props) {
  const [rows, setRows] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [title, setTitle] = useState('');
  const [designation, setDesignation] = useState('');
  const [pimsId, setPimsId] = useState('');
  const [pimsUserId, setPimsUserId] = useState('');
  const [pimsType, setPimsType] = useState('EVET');
  const [isProvider, setIsProvider] = useState(false);
  const [middleName, setMiddleName] = useState('');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [address1, setAddress1] = useState('');
  const [address2, setAddress2] = useState('');
  const [address3, setAddress3] = useState('');
  const [city, setCity] = useState('');
  const [stateAbbr, setStateAbbr] = useState('');
  const [zipcode, setZipcode] = useState('');
  const [county, setCounty] = useState('');
  const [country, setCountry] = useState('');
  const [phone1, setPhone1] = useState('');
  const [phone2, setPhone2] = useState('');
  const [roleIdsSelected, setRoleIdsSelected] = useState<number[]>([]);
  const [rolesCatalog, setRolesCatalog] = useState<EmployeeRole[]>([]);

  const practice = useMemo(() => ({ id: DEFAULT_PRACTICE_ID }), []);

  useEffect(() => {
    let cancelled = false;
    void fetchEmployeeRoles()
      .then((list) => {
        if (!cancelled) setRolesCatalog(Array.isArray(list) ? list : []);
      })
      .catch(() => {
        if (!cancelled) setRolesCatalog([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const list = await fetchAllEmployees();
      setRows(Array.isArray(list) ? list : []);
    } catch (e) {
      setLoadError(extractErr(e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openAdd = () => {
    setEditingId(null);
    setFirstName('');
    setLastName('');
    setMiddleName('');
    setEmail('');
    setTitle('');
    setDesignation('');
    setLicenseNumber('');
    setPimsId('');
    setPimsUserId('');
    setPimsType('EVET');
    setIsProvider(false);
    setAddress1('');
    setAddress2('');
    setAddress3('');
    setCity('');
    setStateAbbr('');
    setZipcode('');
    setCounty('');
    setCountry('');
    setPhone1('');
    setPhone2('');
    setRoleIdsSelected([]);
    setModalMode('add');
  };

  const applyRecordToForm = (full: Employee) => {
    const r = full as Record<string, unknown>;
    setFirstName(str(full.firstName));
    setLastName(str(full.lastName));
    setMiddleName(str(r.middleName));
    setEmail(str(full.email));
    setTitle(str(full.title));
    setDesignation(str(full.designation));
    setLicenseNumber(str(r.licenseNumber));
    setPimsId(str(r.pimsId));
    setPimsUserId(str(r.pimsUserId));
    setPimsType(str(r.pimsType) || 'EVET');
    setIsProvider(full.isProvider === true);
    setAddress1(str(r.address1));
    setAddress2(str(r.address2));
    setAddress3(str(r.address3));
    setCity(str(r.city));
    setStateAbbr(str(r.state));
    setZipcode(str(r.zipcode));
    setCounty(str(r.county));
    setCountry(str(r.country));
    setPhone1(str(r.phone1));
    setPhone2(str(r.phone2));
    const rid = r.roleIds;
    if (Array.isArray(rid)) {
      setRoleIdsSelected(
        rid.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0)
      );
    } else {
      setRoleIdsSelected([]);
    }
  };

  const openEdit = async (id: number) => {
    setSaving(false);
    setModalMode(null);
    try {
      const full = await fetchEmployee(id);
      setEditingId(id);
      applyRecordToForm(full);
      setModalMode('edit');
    } catch (e) {
      onMessage?.(extractErr(e), 'error');
    }
  };

  const toggleRoleId = (roleId: number) => {
    setRoleIdsSelected((cur) =>
      cur.includes(roleId) ? cur.filter((x) => x !== roleId) : [...cur, roleId].sort((a, b) => a - b)
    );
  };

  const closeModal = () => {
    if (!saving) setModalMode(null);
  };

  const buildPayloadFromForm = (): Record<string, unknown> => {
    const fn = firstName.trim();
    const ln = lastName.trim();
    const payload: Record<string, unknown> = {
      firstName: fn,
      lastName: ln,
      middleName: blankToNull(middleName),
      email: blankToNull(email),
      title: blankToNull(title),
      designation: blankToNull(designation),
      licenseNumber: blankToNull(licenseNumber),
      pimsId: blankToNull(pimsId),
      pimsUserId: blankToNull(pimsUserId),
      pimsType: blankToNull(pimsType) ?? 'EVET',
      isProvider,
      address1: blankToNull(address1),
      address2: blankToNull(address2),
      address3: blankToNull(address3),
      city: blankToNull(city),
      state: blankToNull(stateAbbr),
      zipcode: blankToNull(zipcode),
      county: blankToNull(county),
      country: blankToNull(country),
      phone1: blankToNull(phone1),
      phone2: blankToNull(phone2),
      roleIds: roleIdsSelected.length ? [...roleIdsSelected] : [],
      practice,
      isActive: true,
      isDeleted: false,
    };
    return payload;
  };

  const submitModal = async (e: FormEvent) => {
    e.preventDefault();
    const fn = firstName.trim();
    const ln = lastName.trim();
    if (!fn || !ln) {
      onMessage?.('First name and last name are required.', 'error');
      return;
    }
    setSaving(true);
    try {
      const basePayload = buildPayloadFromForm();
      const pid = pimsId.trim();

      if (modalMode === 'add') {
        const dto = { ...basePayload } as EmployeeDto;
        if (pid) {
          await upsertEmployees(dto);
          onMessage?.('Employee upserted.', 'success');
        } else {
          await saveEmployees(dto);
          onMessage?.('Employee saved.', 'success');
        }
      } else if (modalMode === 'edit' && editingId != null) {
        const full = await fetchEmployee(editingId);
        const prev = full as unknown as Record<string, unknown>;
        const merged: EmployeeDto = {
          ...prev,
          ...basePayload,
          id: editingId,
          practice: (full.practice as object | undefined) ?? (prev.practice as object | undefined) ?? practice,
          isActive: prev.isActive !== false,
          isDeleted: prev.isDeleted === true,
        } as EmployeeDto;
        await saveEmployees(merged);
        onMessage?.('Employee updated.', 'success');
      }
      setModalMode(null);
      await load();
    } catch (err) {
      onMessage?.(extractErr(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async (emp: Employee) => {
    if (!window.confirm(`Deactivate ${emp.firstName} ${emp.lastName}? They will be hidden from active lists.`)) {
      return;
    }
    try {
      const full = await fetchEmployee(emp.id);
      const merged = {
        ...(full as unknown as Record<string, unknown>),
        id: emp.id,
        isActive: false,
        isDeleted: false,
      } as EmployeeDto;
      await saveEmployees(merged);
      onMessage?.('Employee deactivated.', 'success');
      await load();
    } catch (err) {
      onMessage?.(extractErr(err), 'error');
    }
  };

  const reactivate = async (emp: Employee) => {
    try {
      const full = await fetchEmployee(emp.id);
      const merged = {
        ...(full as unknown as Record<string, unknown>),
        id: emp.id,
        isActive: true,
        isDeleted: false,
      } as EmployeeDto;
      await saveEmployees(merged);
      onMessage?.('Employee reactivated.', 'success');
      await load();
    } catch (err) {
      onMessage?.(extractErr(err), 'error');
    }
  };

  const removeRow = async (emp: Employee) => {
    if (
      !window.confirm(
        `Permanently delete employee #${emp.id} from the database? This cannot be undone.`
      )
    ) {
      return;
    }
    try {
      await deleteEmployees([emp.id]);
      onMessage?.('Employee deleted.', 'success');
      await load();
    } catch (err) {
      onMessage?.(extractErr(err), 'error');
    }
  };

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) =>
      `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`)
    );
  }, [rows]);

  return (
    <div className="settings-employee-directory">
      <p className="muted" style={{ marginBottom: 16, maxWidth: 900 }}>
        Add or edit staff using <code>POST /employees/upsert</code> (when PIMS ID is set on add) or{' '}
        <code>POST /employees</code> (save). The editor loads the same fields returned by <code>GET /employees/:id</code>{' '}
        (name, PIMS ids, address, phones, <code>roleIds</code>, etc.). Deactivate via <code>isActive: false</code>; delete
        via <code>DELETE /employees?ids=…</code>.
      </p>

      <div style={{ marginBottom: 12 }}>
        <button type="button" className="btn" onClick={openAdd}>
          + Add employee
        </button>
        <button type="button" className="btn secondary" style={{ marginLeft: 8 }} onClick={() => void load()}>
          Refresh
        </button>
      </div>

      {loading && <p className="muted">Loading employees…</p>}
      {loadError && <div className="settings-error-message">{loadError}</div>}

      {!loading && !loadError && (
        <div className="settings-table-container" style={{ overflowX: 'auto' }}>
          <table className="settings-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Email</th>
                <th>PIMS ID</th>
                <th>PIMS user</th>
                <th>Provider</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((emp) => (
                <tr key={emp.id}>
                  <td>{emp.id}</td>
                  <td>
                    {(() => {
                      const r = emp as Record<string, unknown>;
                      const mid = str(r.middleName);
                      const parts = [emp.title, emp.firstName, mid, emp.lastName].filter(Boolean);
                      return parts.length ? parts.join(' ') : `${emp.firstName} ${emp.lastName}`;
                    })()}
                  </td>
                  <td>{emp.email || '—'}</td>
                  <td>{empPimsId(emp)}</td>
                  <td>{empPimsUserId(emp)}</td>
                  <td>{emp.isProvider ? 'Yes' : 'No'}</td>
                  <td>{empActive(emp) ? 'Active' : 'Inactive'}</td>
                  <td>
                    <button type="button" className="btn secondary" onClick={() => void openEdit(emp.id)}>
                      Edit
                    </button>
                    {empActive(emp) ? (
                      <button
                        type="button"
                        className="btn secondary"
                        style={{ marginLeft: 6 }}
                        onClick={() => void deactivate(emp)}
                      >
                        Deactivate
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn secondary"
                        style={{ marginLeft: 6 }}
                        onClick={() => void reactivate(emp)}
                      >
                        Reactivate
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn secondary"
                      style={{ marginLeft: 6, color: '#b91c1c' }}
                      onClick={() => void removeRow(emp)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalMode && (
        <div className="settings-employee-modal-root" role="presentation">
          <button type="button" className="settings-employee-modal-backdrop" aria-label="Close" onClick={closeModal} />
          <div className="settings-employee-modal settings-employee-modal--wide" role="dialog" aria-modal="true">
            <div className="settings-employee-modal__head">
              <h3>{modalMode === 'add' ? 'Add employee' : 'Edit employee'}</h3>
              <button type="button" className="settings-close" onClick={closeModal} aria-label="Close">
                ×
              </button>
            </div>
            <form onSubmit={submitModal} className="settings-employee-modal__form">
              <fieldset className="settings-employee-modal__fieldset">
                <legend className="settings-employee-modal__legend">Name &amp; role</legend>
                <div className="settings-employee-modal__grid">
                  <label>
                    <span className="label">First name *</span>
                    <input className="input" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
                  </label>
                  <label>
                    <span className="label">Middle name</span>
                    <input className="input" value={middleName} onChange={(e) => setMiddleName(e.target.value)} />
                  </label>
                  <label>
                    <span className="label">Last name *</span>
                    <input className="input" value={lastName} onChange={(e) => setLastName(e.target.value)} required />
                  </label>
                  <label>
                    <span className="label">Title</span>
                    <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
                  </label>
                  <label>
                    <span className="label">Designation</span>
                    <input className="input" value={designation} onChange={(e) => setDesignation(e.target.value)} />
                  </label>
                  <label>
                    <span className="label">License number</span>
                    <input className="input" value={licenseNumber} onChange={(e) => setLicenseNumber(e.target.value)} />
                  </label>
                  <label className="settings-employee-modal__full">
                    <span className="label">Email</span>
                    <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, alignSelf: 'end' }}>
                    <input type="checkbox" checked={isProvider} onChange={(e) => setIsProvider(e.target.checked)} />
                    <span>Scheduling provider</span>
                  </label>
                </div>
              </fieldset>

              <fieldset className="settings-employee-modal__fieldset">
                <legend className="settings-employee-modal__legend">PIMS</legend>
                <div className="settings-employee-modal__grid">
                  <label>
                    <span className="label">PIMS ID</span>
                    <input className="input" value={pimsId} onChange={(e) => setPimsId(e.target.value)} />
                  </label>
                  <label>
                    <span className="label">PIMS user ID</span>
                    <input className="input" value={pimsUserId} onChange={(e) => setPimsUserId(e.target.value)} />
                  </label>
                  <label>
                    <span className="label">PIMS type</span>
                    <input className="input" value={pimsType} onChange={(e) => setPimsType(e.target.value)} placeholder="EVET" />
                  </label>
                </div>
              </fieldset>

              <fieldset className="settings-employee-modal__fieldset">
                <legend className="settings-employee-modal__legend">Address</legend>
                <div className="settings-employee-modal__grid">
                  <label className="settings-employee-modal__full">
                    <span className="label">Address line 1</span>
                    <input className="input" value={address1} onChange={(e) => setAddress1(e.target.value)} />
                  </label>
                  <label className="settings-employee-modal__full">
                    <span className="label">Address line 2</span>
                    <input className="input" value={address2} onChange={(e) => setAddress2(e.target.value)} />
                  </label>
                  <label className="settings-employee-modal__full">
                    <span className="label">Address line 3</span>
                    <input className="input" value={address3} onChange={(e) => setAddress3(e.target.value)} />
                  </label>
                  <label>
                    <span className="label">City</span>
                    <input className="input" value={city} onChange={(e) => setCity(e.target.value)} />
                  </label>
                  <label>
                    <span className="label">State</span>
                    <input className="input" value={stateAbbr} onChange={(e) => setStateAbbr(e.target.value)} />
                  </label>
                  <label>
                    <span className="label">ZIP</span>
                    <input className="input" value={zipcode} onChange={(e) => setZipcode(e.target.value)} />
                  </label>
                  <label>
                    <span className="label">County</span>
                    <input className="input" value={county} onChange={(e) => setCounty(e.target.value)} />
                  </label>
                  <label>
                    <span className="label">Country</span>
                    <input
                      className="input"
                      value={country}
                      onChange={(e) => setCountry(e.target.value)}
                      placeholder="e.g. 1 or US"
                    />
                  </label>
                </div>
              </fieldset>

              <fieldset className="settings-employee-modal__fieldset">
                <legend className="settings-employee-modal__legend">Phone</legend>
                <div className="settings-employee-modal__grid">
                  <label>
                    <span className="label">Phone 1</span>
                    <input className="input" type="tel" value={phone1} onChange={(e) => setPhone1(e.target.value)} />
                  </label>
                  <label>
                    <span className="label">Phone 2</span>
                    <input className="input" type="tel" value={phone2} onChange={(e) => setPhone2(e.target.value)} />
                  </label>
                </div>
              </fieldset>

              <fieldset className="settings-employee-modal__fieldset">
                <legend className="settings-employee-modal__legend">Roles (roleIds)</legend>
                {rolesCatalog.length === 0 ? (
                  <p className="muted" style={{ fontSize: 13, margin: 0 }}>
                    No roles loaded. Check <code>GET /employees/roles</code>.
                  </p>
                ) : (
                  <div className="settings-employee-modal__roles" role="group" aria-label="Employee roles">
                    {rolesCatalog.map((role) => (
                      <label
                        key={role.id}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, cursor: 'pointer' }}
                      >
                        <input
                          type="checkbox"
                          checked={roleIdsSelected.includes(role.id)}
                          onChange={() => toggleRoleId(role.id)}
                        />
                        <span>
                          {role.name}
                          <span className="muted" style={{ fontSize: 12 }}>
                            {' '}
                            ({role.roleValue})
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </fieldset>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                <button type="button" className="btn secondary" onClick={closeModal} disabled={saving}>
                  Cancel
                </button>
                <button type="submit" className="btn" disabled={saving}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
