import { useEffect, useState } from 'react';
import { KeyRound, Pencil, ShieldCheck, Trash2, Upload, UserPlus } from 'lucide-react';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import AppShell from '../../components/AppShell';

const ROLE_BADGE = {
  student: 'md-badge-primary',
  teacher: 'md-badge-tertiary',
  admin: 'md-badge-error',
};

const EMPTY_NEW_USER = { name: '', email: '', password: '', role: 'teacher' };

const IMPORT_HEADER = 'studentNumber,name,email,program,semester,section,password';
const IMPORT_PLACEHOLDER = `${IMPORT_HEADER}
23012004,Anita Gurung,anita@college.edu,BSc CSIT,6,A,
23012005,Bikash Rai,bikash@college.edu,BSc CSIT,6,A,`;

// A paste from a spreadsheet, not a file upload: registrars work in Excel, and "copy the
// columns" needs no export step, no encoding guesswork and no multipart plumbing.
// Deliberately simple - it splits on commas and does not handle quoted fields containing
// commas. Names with commas would need a real CSV parser.
function parseStudentCsv(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return { rows: [], error: 'Nothing to import.' };

  const header = lines[0].toLowerCase();
  const hasHeader = header.includes('studentnumber') || header.includes('student number');
  const body = hasHeader ? lines.slice(1) : lines;
  if (body.length === 0) return { rows: [], error: 'The header row is there but no student rows are.' };

  const rows = body.map((line) => {
    const [studentNumber, name, email, program, semester, section, password] = line
      .split(',')
      .map((c) => c.trim());
    return { studentNumber, name, email, program, semester, section, password };
  });
  return { rows, error: '' };
}

export default function ManageUsers() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [roleFilter, setRoleFilter] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [showAdd, setShowAdd] = useState(false);
  const [newUser, setNewUser] = useState(EMPTY_NEW_USER);
  const [creating, setCreating] = useState(false);
  const [savingRoleFor, setSavingRoleFor] = useState(null);
  const [resetTarget, setResetTarget] = useState(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetting, setResetting] = useState(false);

  // Inline edit of a student's college ID. Kept inline rather than in a panel because it is
  // usually a one-character typo fix, and it is the value the student signs in with.
  const [editingIdFor, setEditingIdFor] = useState(null);
  const [idDraft, setIdDraft] = useState('');
  const [savingId, setSavingId] = useState(false);

  const startEditId = (u) => {
    setEditingIdFor(u.id);
    setIdDraft(u.student_number || '');
    setError('');
    setNotice('');
  };

  const saveStudentNumber = async (u) => {
    const value = idDraft.trim();
    if (!value || value === u.student_number) {
      setEditingIdFor(null);
      return;
    }
    setSavingId(true);
    setError('');
    setNotice('');
    try {
      await api.patch(`/admin/users/${u.id}/student-number`, { studentNumber: value });
      setNotice(`${u.name} now signs in with college ID ${value}.`);
      setEditingIdFor(null);
      await load();
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to update the college ID');
    } finally {
      setSavingId(false);
    }
  };

  // Full record edit. These fields left self-service when PATCH /auth/me was removed, so
  // this is the only place they can be corrected now.
  const [editTarget, setEditTarget] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const openEdit = async (u) => {
    setError('');
    setNotice('');
    setEditTarget(u);
    setEditForm({ name: u.name, email: u.email, program: '', semester: '', section: '', department: '', designation: '' });
    try {
      // The list has no academic detail on it, so fetch the full record before editing -
      // otherwise saving would blank whatever is not shown.
      const { data } = await api.get(`/admin/users/${u.id}`);
      setEditForm({
        name: data.user.name || '',
        email: data.user.email || '',
        program: data.user.profile?.program || '',
        semester: data.user.profile?.semester || '',
        section: data.user.profile?.section || '',
        department: data.user.profile?.department || '',
        designation: data.user.profile?.designation || '',
      });
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to load that user');
    }
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    setSavingEdit(true);
    setError('');
    setNotice('');
    try {
      const profile =
        editTarget.role === 'student'
          ? {
              program: editForm.program || null,
              semester: editForm.semester || null,
              section: editForm.section || null,
            }
          : editTarget.role === 'teacher'
            ? { department: editForm.department || null, designation: editForm.designation || null }
            : undefined;
      await api.patch(`/admin/users/${editTarget.id}/profile`, {
        name: editForm.name,
        email: editForm.email,
        ...(profile ? { profile } : {}),
      });
      setNotice(`Updated the record for ${editForm.name}.`);
      setEditTarget(null);
      await load();
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to save those details');
    } finally {
      setSavingEdit(false);
    }
  };

  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);

  const handleImport = async (e) => {
    e.preventDefault();
    setError('');
    setNotice('');
    setImportResult(null);

    const { rows, error: parseError } = parseStudentCsv(importText);
    if (parseError) {
      setError(parseError);
      return;
    }

    setImporting(true);
    try {
      const { data } = await api.post('/admin/students/import', { students: rows });
      setImportResult(data);
      if (data.createdCount > 0) {
        setNotice(
          `Created ${data.createdCount} student account${data.createdCount === 1 ? '' : 's'}. ` +
            'Where no password column was given, the student number is the initial password.'
        );
        setImportText('');
        await load();
      }
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  const load = async () => {
    try {
      const { data } = await api.get('/admin/users', { params: roleFilter ? { role: roleFilter } : {} });
      setUsers(data.users);
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to load users');
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleFilter]);

  const handleDelete = async (id) => {
    if (!window.confirm('Remove this user? This cannot be undone.')) return;
    setError('');
    try {
      await api.delete(`/admin/users/${id}`);
      await load();
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to delete user');
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setCreating(true);
    setError('');
    setNotice('');
    try {
      await api.post('/admin/users', newUser);
      setNotice(`${newUser.role} account created for ${newUser.email}`);
      setNewUser(EMPTY_NEW_USER);
      setShowAdd(false);
      await load();
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to create the account');
    } finally {
      setCreating(false);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    setResetting(true);
    setError('');
    setNotice('');
    try {
      await api.post(`/admin/users/${resetTarget.id}/reset-password`, { newPassword: resetPassword });
      setNotice(
        `Temporary password set for ${resetTarget.email}. Share it with them directly — they were signed out everywhere and should change it from their profile.`
      );
      setResetTarget(null);
      setResetPassword('');
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to reset the password');
    } finally {
      setResetting(false);
    }
  };

  const handleRoleChange = async (id, role) => {
    setSavingRoleFor(id);
    setError('');
    setNotice('');
    try {
      await api.patch(`/admin/users/${id}/role`, { role });
      setNotice('Role updated. That user has been signed out of any active sessions.');
      await load();
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to change the role');
      await load();
    } finally {
      setSavingRoleFor(null);
    }
  };

  return (
    <AppShell title="Users">
      <div className="d-flex justify-content-between align-items-start flex-wrap gap-3 mb-4">
        <div>
          <h2 className="md-headline-small mb-1" style={{ color: 'var(--md-on-surface)' }}>
            Manage users
          </h2>
          <p className="md-body-medium mb-0" style={{ color: 'var(--md-on-surface-variant)' }}>
            {users.length} account{users.length === 1 ? '' : 's'}
          </p>
        </div>
        <div className="d-flex gap-2 align-items-center">
          <select
            className="md-input"
            style={{ width: 'auto', height: 40 }}
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            aria-label="Filter by role"
          >
            <option value="">All roles</option>
            <option value="student">Students</option>
            <option value="teacher">Teachers</option>
            <option value="admin">Admins</option>
          </select>
          <button type="button" className="md-btn md-btn-outlined" onClick={() => setShowImport((v) => !v)}>
            <Upload size={18} /> Import students
          </button>
          <button type="button" className="md-btn md-btn-filled" onClick={() => setShowAdd((v) => !v)}>
            <UserPlus size={18} /> Add user
          </button>
        </div>
      </div>

      <div className="md-banner md-banner-info">
        <ShieldCheck size={20} className="flex-shrink-0" />
        <span>
          Public sign-up is closed — <strong>every</strong> account is created here. Students
          sign in with the student number on this list; staff sign in with their email.
        </span>
      </div>

      {error && (
        <div className="md-banner md-banner-error" role="alert">
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="md-banner md-banner-success" role="status">
          <span>{notice}</span>
        </div>
      )}

      {editTarget && editForm && (
        <div className="md-card md-card-elevated md-card-pad mb-4">
          <div className="d-flex align-items-center gap-2 mb-2">
            <Pencil size={20} style={{ color: 'var(--md-primary)' }} />
            <h3 className="md-title-large mb-0" style={{ color: 'var(--md-on-surface)' }}>
              Edit {editTarget.name}
            </h3>
          </div>
          <p className="md-body-medium mb-4" style={{ color: 'var(--md-on-surface-variant)' }}>
            Users cannot edit these themselves — rosters and attendance reports are read
            against them. The college ID is changed separately, from the table below.
          </p>
          <form onSubmit={handleSaveEdit}>
            <div className="row g-3">
              <div className="col-md-6">
                <div className="md-field mb-0">
                  <label className="md-field-label" htmlFor="e-name">Full name</label>
                  <input
                    id="e-name"
                    className="md-input"
                    value={editForm.name}
                    minLength={2}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                    required
                  />
                </div>
              </div>
              <div className="col-md-6">
                <div className="md-field mb-0">
                  <label className="md-field-label" htmlFor="e-email">Email</label>
                  <input
                    id="e-email"
                    type="email"
                    className="md-input"
                    value={editForm.email}
                    onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                    required
                  />
                </div>
              </div>

              {editTarget.role === 'student' && (
                <>
                  <div className="col-md-6">
                    <div className="md-field mb-0">
                      <label className="md-field-label" htmlFor="e-program">Programme</label>
                      <input
                        id="e-program"
                        className="md-input"
                        value={editForm.program}
                        onChange={(e) => setEditForm({ ...editForm, program: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="col-md-3">
                    <div className="md-field mb-0">
                      <label className="md-field-label" htmlFor="e-sem">Semester</label>
                      <input
                        id="e-sem"
                        className="md-input"
                        value={editForm.semester}
                        onChange={(e) => setEditForm({ ...editForm, semester: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="col-md-3">
                    <div className="md-field mb-0">
                      <label className="md-field-label" htmlFor="e-sec">Section</label>
                      <input
                        id="e-sec"
                        className="md-input"
                        value={editForm.section}
                        onChange={(e) => setEditForm({ ...editForm, section: e.target.value })}
                      />
                    </div>
                  </div>
                </>
              )}

              {editTarget.role === 'teacher' && (
                <>
                  <div className="col-md-6">
                    <div className="md-field mb-0">
                      <label className="md-field-label" htmlFor="e-dept">Department</label>
                      <input
                        id="e-dept"
                        className="md-input"
                        value={editForm.department}
                        onChange={(e) => setEditForm({ ...editForm, department: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="col-md-6">
                    <div className="md-field mb-0">
                      <label className="md-field-label" htmlFor="e-desig">Designation</label>
                      <input
                        id="e-desig"
                        className="md-input"
                        value={editForm.designation}
                        onChange={(e) => setEditForm({ ...editForm, designation: e.target.value })}
                      />
                    </div>
                  </div>
                </>
              )}
            </div>
            <div className="d-flex gap-2 mt-4">
              <button className="md-btn md-btn-filled" type="submit" disabled={savingEdit}>
                {savingEdit ? 'Saving…' : 'Save changes'}
              </button>
              <button type="button" className="md-btn md-btn-text" onClick={() => setEditTarget(null)}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {resetTarget && (
        <div className="md-card md-card-elevated md-card-pad mb-4">
          <div className="d-flex align-items-center gap-2 mb-2">
            <KeyRound size={20} style={{ color: 'var(--md-primary)' }} />
            <h3 className="md-title-large mb-0" style={{ color: 'var(--md-on-surface)' }}>
              Reset password for {resetTarget.name}
            </h3>
          </div>
          <p className="md-body-medium mb-4" style={{ color: 'var(--md-on-surface-variant)' }}>
            There is no email server, so give this temporary password to {resetTarget.email} directly.
            All their active sessions will be signed out.
          </p>
          <form onSubmit={handleResetPassword}>
            <div className="row g-3 align-items-end">
              <div className="col-md-6">
                <div className="md-field mb-0">
                  <label className="md-field-label" htmlFor="reset-pw">Temporary password</label>
                  <input
                    id="reset-pw"
                    type="text"
                    className="md-input"
                    minLength={8}
                    value={resetPassword}
                    onChange={(e) => setResetPassword(e.target.value)}
                    required
                  />
                  <span className="md-supporting">At least 8 characters.</span>
                </div>
              </div>
              <div className="col-md-6 d-flex gap-2">
                <button className="md-btn md-btn-filled" type="submit" disabled={resetting}>
                  {resetting ? 'Resetting…' : 'Set password'}
                </button>
                <button type="button" className="md-btn md-btn-text" onClick={() => setResetTarget(null)}>
                  Cancel
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {showImport && (
        <div className="md-card md-card-elevated md-card-pad mb-4">
          <div className="d-flex align-items-center gap-2 mb-2">
            <Upload size={20} style={{ color: 'var(--md-primary)' }} />
            <h3 className="md-title-large mb-0" style={{ color: 'var(--md-on-surface)' }}>
              Import students
            </h3>
          </div>
          <p className="md-body-medium mb-3" style={{ color: 'var(--md-on-surface-variant)' }}>
            Paste the columns straight from your spreadsheet. The header row is optional, and
            so is the password column — leave it blank and the student number becomes the
            initial password. Rows that fail are reported individually; the rest still import.
          </p>

          <form onSubmit={handleImport}>
            <div className="md-field">
              <label className="md-field-label" htmlFor="import-csv">
                {IMPORT_HEADER}
              </label>
              <textarea
                id="import-csv"
                className="md-input"
                style={{ height: 160, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13, paddingTop: 12 }}
                placeholder={IMPORT_PLACEHOLDER}
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                required
              />
              <span className="md-supporting">Up to 500 students at a time.</span>
            </div>
            <div className="d-flex gap-2">
              <button className="md-btn md-btn-filled" type="submit" disabled={importing}>
                {importing ? 'Importing…' : 'Import'}
              </button>
              <button type="button" className="md-btn md-btn-text" onClick={() => setShowImport(false)}>
                Cancel
              </button>
            </div>
          </form>

          {importResult && importResult.skippedCount > 0 && (
            <div className="md-banner md-banner-warning mt-4" role="status">
              <div>
                <strong>
                  {importResult.skippedCount} row{importResult.skippedCount === 1 ? '' : 's'} skipped
                </strong>
                <ul className="mb-0 mt-1 ps-3">
                  {importResult.skipped.map((s) => (
                    <li key={s.line} className="md-body-small">
                      Line {s.line}
                      {s.studentNumber ? ` (${s.studentNumber})` : ''}: {s.reason}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      )}

      {showAdd && (
        <div className="md-card md-card-elevated md-card-pad mb-4">
          <h3 className="md-title-large mb-4" style={{ color: 'var(--md-on-surface)' }}>
            Create an account
          </h3>
          <form onSubmit={handleCreate}>
            <div className="row g-3">
              <div className="col-md-6">
                <div className="md-field mb-0">
                  <label className="md-field-label" htmlFor="n-name">Full name</label>
                  <input
                    id="n-name"
                    className="md-input"
                    value={newUser.name}
                    onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                    required
                    minLength={2}
                  />
                </div>
              </div>
              <div className="col-md-6">
                <div className="md-field mb-0">
                  <label className="md-field-label" htmlFor="n-email">Email</label>
                  <input
                    id="n-email"
                    type="email"
                    className="md-input"
                    value={newUser.email}
                    onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                    required
                  />
                </div>
              </div>
              <div className="col-md-6">
                <div className="md-field mb-0">
                  <label className="md-field-label" htmlFor="n-pw">Temporary password</label>
                  <input
                    id="n-pw"
                    type="text"
                    className="md-input"
                    minLength={8}
                    value={newUser.password}
                    onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                    required
                  />
                  <span className="md-supporting">At least 8 characters. Ask them to change it after first login.</span>
                </div>
              </div>
              <div className="col-md-6">
                <div className="md-field mb-0">
                  <label className="md-field-label" htmlFor="n-role">Role</label>
                  <select
                    id="n-role"
                    className="md-input"
                    value={newUser.role}
                    onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                  >
                    <option value="teacher">Teacher</option>
                    <option value="admin">Admin</option>
                    <option value="student">Student</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="d-flex gap-2 mt-4">
              <button className="md-btn md-btn-filled" type="submit" disabled={creating}>
                {creating ? 'Creating…' : 'Create account'}
              </button>
              <button type="button" className="md-btn md-btn-text" onClick={() => setShowAdd(false)}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="md-table-wrap">
        <div className="md-scroll-x">
          <table className="md-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>College ID</th>
                <th>Email</th>
                <th>Role</th>
                <th>Change role</th>
                <th>Joined</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.length === 0 && (
                <tr>
                  <td colSpan={7} className="md-table-empty">
                    No users found.
                  </td>
                </tr>
              )}
              {users.map((u) => {
                const isSelf = u.id === currentUser?.id;
                return (
                  <tr key={u.id}>
                    <td className="md-title-small">
                      {u.name}
                      {isSelf && (
                        <span className="md-body-small" style={{ color: 'var(--md-on-surface-variant)' }}>
                          {' '}
                          (you)
                        </span>
                      )}
                    </td>
                    <td>
                      {u.role !== 'student' ? (
                        <span style={{ color: 'var(--md-on-surface-variant)' }}>—</span>
                      ) : editingIdFor === u.id ? (
                        <div className="d-flex gap-1 align-items-center">
                          <input
                            className="md-input"
                            style={{ width: 130, height: 40, fontSize: 14 }}
                            value={idDraft}
                            autoFocus
                            maxLength={40}
                            aria-label={`College ID for ${u.name}`}
                            onChange={(e) => setIdDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveStudentNumber(u);
                              if (e.key === 'Escape') setEditingIdFor(null);
                            }}
                          />
                          <button
                            type="button"
                            className="md-btn md-btn-filled md-btn-sm"
                            disabled={savingId}
                            onClick={() => saveStudentNumber(u)}
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            className="md-btn md-btn-text md-btn-sm"
                            onClick={() => setEditingIdFor(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="md-btn md-btn-text md-btn-sm"
                          style={{ paddingLeft: 8, paddingRight: 8 }}
                          title="Edit this student's college ID"
                          onClick={() => startEditId(u)}
                        >
                          <span className="md-title-small">{u.student_number || 'Set ID'}</span>
                          <Pencil size={13} />
                        </button>
                      )}
                    </td>
                    <td style={{ color: 'var(--md-on-surface-variant)' }}>{u.email}</td>
                    <td>
                      <span className={`md-badge ${ROLE_BADGE[u.role] || 'md-badge-neutral'}`}>{u.role}</span>
                    </td>
                    <td>
                      <select
                        className="md-input"
                        style={{ width: 'auto', height: 40, fontSize: 14 }}
                        value={u.role}
                        disabled={isSelf || savingRoleFor === u.id}
                        title={isSelf ? 'You cannot change your own role' : undefined}
                        aria-label={`Change role for ${u.name}`}
                        onChange={(e) => handleRoleChange(u.id, e.target.value)}
                      >
                        <option value="student">Student</option>
                        <option value="teacher">Teacher</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                    <td style={{ color: 'var(--md-on-surface-variant)' }}>
                      {new Date(u.created_at).toLocaleDateString()}
                    </td>
                    <td>
                      <div className="d-flex gap-2">
                        <button
                          type="button"
                          className="md-btn md-btn-outlined md-btn-sm"
                          onClick={() => openEdit(u)}
                        >
                          <Pencil size={14} /> Edit
                        </button>
                        <button
                          type="button"
                          className="md-btn md-btn-outlined md-btn-sm"
                          onClick={() => {
                            setResetTarget(u);
                            setResetPassword('');
                            setNotice('');
                            setError('');
                          }}
                        >
                          <KeyRound size={14} /> Reset
                        </button>
                        <button
                          type="button"
                          className="md-btn md-btn-danger-outlined md-btn-sm"
                          disabled={isSelf}
                          onClick={() => handleDelete(u.id)}
                        >
                          <Trash2 size={14} /> Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
