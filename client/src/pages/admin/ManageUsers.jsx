import { useEffect, useState } from 'react';
import api from '../../api/client';

export default function ManageUsers() {
  const [users, setUsers] = useState([]);
  const [roleFilter, setRoleFilter] = useState('');
  const [error, setError] = useState('');

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
    try {
      await api.delete(`/admin/users/${id}`);
      await load();
    } catch (err) {
      setError(err.response?.data?.error?.message || 'Failed to delete user');
    }
  };

  return (
    <div className="container py-4">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h4 className="mb-0">Manage Users</h4>
        <select className="form-select w-auto" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
          <option value="">All roles</option>
          <option value="student">Students</option>
          <option value="teacher">Teachers</option>
          <option value="admin">Admins</option>
        </select>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}

      <table className="table table-striped">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th>Joined</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.name}</td>
              <td>{u.email}</td>
              <td>
                <span className="badge bg-secondary text-uppercase">{u.role}</span>
              </td>
              <td>{new Date(u.created_at).toLocaleDateString()}</td>
              <td>
                <button className="btn btn-sm btn-outline-danger" onClick={() => handleDelete(u.id)}>
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
