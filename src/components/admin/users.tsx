import { Modal } from '../ui/modal';
import { m } from '../../locale/paraglide/messages';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateUsers, queryKeys } from '../../lib/query-keys';
import { Search, SlidersHorizontal } from 'lucide-react';

import {
  Button,
  Card,
  Empty,
  Field,
  Loading,
  Notice,
  SectionTitle,
  api,
  errorMessage,
  formatDate,
  useResource,
} from '../ui/primitives';
import { Route as AppRoute } from '../../routes/_app';
interface ManagedUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  role: string;
  banned: boolean;
  banReason?: string;
  banExpires?: string;
  createdAt: string;
}
export function UsersPage() {
  const { session } = AppRoute.useRouteContext();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [searchField, setSearchField] = useState('email');
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [limit, setLimit] = useState(10);
  const [showColumns, setShowColumns] = useState(false);
  const [columns, setColumns] = useState({ email: true, role: true, status: true, created: true });
  const [selected, setSelected] = useState<ManagedUser | null>(null);
  const [role, setRole] = useState('user');
  const [reason, setReason] = useState('');
  const [expires, setExpires] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(page * limit),
    sortBy: 'createdAt',
    sortDirection: 'desc',
  });
  if (query) {
    params.set('searchValue', query);
    params.set('searchField', searchField);
    params.set('searchOperator', 'contains');
  }
  if (filter !== 'all') {
    params.set('filterField', filter === 'admin' || filter === 'user' ? 'role' : 'banned');
    params.set(
      'filterValue',
      filter === 'banned' ? 'true' : filter === 'active' ? 'false' : filter,
    );
    params.set('filterOperator', 'eq');
  }
  const users = useResource<{ users: ManagedUser[]; total: number }>(
    `/api/auth/admin/list-users?${params}`,
    queryKeys.userList(session.user.id, params.toString()),
  );
  async function mutation(endpoint: string, body: unknown, success: string) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await api(`/api/auth/admin/${endpoint}`, { method: 'POST', body: JSON.stringify(body) });
      setMessage(success);
      setSelected(null);
      setPage(0);
      await invalidateUsers(queryClient, session.user.id);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  const columnLabels: Record<string, string> = {
    email: m.admin_users_email(),
    role: m.admin_users_role(),
    status: m.admin_users_status(),
    created: m.admin_users_joined(),
  };
  return (
    <>
      <SectionTitle
        eyebrow={m.admin_users_administration()}
        title={m.admin_users_users()}
        description={m.admin_users_manage_access_roles_and_account_status()}
      />
      {error && <Notice kind="error">{error}</Notice>}
      {message && <Notice kind="success">{message}</Notice>}
      <Card>
        <form
          className="table-toolbar"
          onSubmit={(event) => {
            event.preventDefault();
            setQuery(search);
            setPage(0);
          }}
        >
          <div className="search-input">
            <Search size={17} />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={m.admin_users_search_users()}
              aria-label={m.admin_users_search_users_3e0578()}
            />
          </div>
          <select
            value={searchField}
            onChange={(event) => {
              setSearchField(event.target.value);
              setPage(0);
            }}
            aria-label={m.admin_users_search_field()}
          >
            <option value="email">{m.admin_users_email()}</option>
            <option value="name">{m.admin_users_name()}</option>
          </select>
          <Button type="submit" variant="secondary">
            {m.admin_users_search()}
          </Button>
          <select
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value);
              setPage(0);
            }}
            aria-label={m.admin_users_filter_users()}
          >
            <option value="all">{m.admin_users_all_users()}</option>
            <option value="admin">{m.admin_users_admins()}</option>
            <option value="user">{m.admin_users_members()}</option>
            <option value="banned">{m.admin_users_banned()}</option>
            <option value="active">{m.admin_users_not_banned()}</option>
          </select>
          <Button variant="secondary" type="button" onClick={() => setShowColumns(!showColumns)}>
            <SlidersHorizontal size={16} />
            {m.admin_users_columns()}
          </Button>
        </form>
        {showColumns && (
          <div className="column-picker">
            {Object.entries(columns).map(([name, visible]) => (
              <label key={name} className="checkbox-label">
                <input
                  type="checkbox"
                  checked={visible}
                  onChange={(event) => setColumns({ ...columns, [name]: event.target.checked })}
                />
                {columnLabels[name]}
              </label>
            ))}
          </div>
        )}
        {users.loading ? (
          <Loading />
        ) : users.error ? (
          <Notice kind="error">{users.error}</Notice>
        ) : !users.data?.users.length ? (
          <Empty title={m.admin_users_no_matching_users()}>
            {m.admin_users_try_another_name_email_or_filter()}
          </Empty>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{m.admin_users_name()}</th>
                  {columns.email && <th>{m.admin_users_email()}</th>}
                  {columns.role && <th>{m.admin_users_role()}</th>}
                  {columns.status && <th>{m.admin_users_status()}</th>}
                  {columns.created && <th>{m.admin_users_joined()}</th>}
                </tr>
              </thead>
              <tbody>
                {users.data.users.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <button
                        className="text-button"
                        onClick={() => {
                          setSelected(user);
                          setRole(user.role || 'user');
                          setReason('');
                          setExpires('');
                          setError('');
                        }}
                      >
                        {user.name}
                      </button>
                    </td>
                    {columns.email && (
                      <td>
                        {user.email}
                        {user.emailVerified && (
                          <small className="table-caption">{m.admin_users_verified()}</small>
                        )}
                      </td>
                    )}
                    {columns.role && (
                      <td>
                        <span className="badge">{user.role || 'user'}</span>
                      </td>
                    )}
                    {columns.status && (
                      <td>
                        <span className={`badge ${user.banned ? 'danger' : 'success'}`}>
                          {user.banned ? m.admin_users_banned() : m.admin_users_active()}
                        </span>
                      </td>
                    )}
                    {columns.created && <td>{formatDate(user.createdAt)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="pagination">
          <span>{m.admin_users_users_34c295({ value1: users.data?.total || 0 })}</span>
          <div className="row">
            <label>
              {m.admin_users_rows()}{' '}
              <select
                value={limit}
                onChange={(event) => {
                  setLimit(Number(event.target.value));
                  setPage(0);
                }}
              >
                {[10, 20, 30, 40, 50].map((size) => (
                  <option key={size}>{size}</option>
                ))}
              </select>
            </label>
            <Button
              variant="secondary"
              disabled={page === 0 || users.loading}
              onClick={() => setPage((value) => value - 1)}
            >
              {m.admin_users_previous()}
            </Button>
            <span>
              {page + 1} / {Math.max(1, Math.ceil((users.data?.total || 0) / limit))}
            </span>
            <Button
              variant="secondary"
              disabled={users.loading || (page + 1) * limit >= (users.data?.total || 0)}
              onClick={() => setPage((value) => value + 1)}
            >
              {m.admin_users_next()}
            </Button>
          </div>
        </div>
      </Card>
      {selected && (
        <Modal error={error} title={selected.name} onClose={() => setSelected(null)}>
          <div className="stack">
            <p className="muted">{selected.email}</p>
            {selected.id === session.user.id && (
              <Notice>{m.admin_users_you_cannot_change_your_own_role_or()}</Notice>
            )}
            <form
              className="stack"
              onSubmit={(event) => {
                event.preventDefault();
                void mutation(
                  'set-role',
                  { userId: selected.id, role },
                  m.admin_users_user_role_updated(),
                );
              }}
            >
              <label className="field">
                {m.admin_users_role()}
                <select
                  value={role}
                  onChange={(event) => setRole(event.target.value)}
                  disabled={selected.id === session.user.id}
                >
                  <option value="user">{m.admin_users_member()}</option>
                  <option value="admin">{m.admin_users_administrator()}</option>
                </select>
              </label>
              <Button
                variant="secondary"
                type="submit"
                busy={busy}
                disabled={selected.id === session.user.id || role === selected.role}
              >
                {m.admin_users_update_role()}
              </Button>
            </form>
            <hr />
            {selected.banned ? (
              <>
                <Notice kind="error">
                  {selected.banReason || m.admin_users_this_user_is_banned()}
                  <br />
                  {m.admin_users_expires()}
                  {formatDate(selected.banExpires)}
                </Notice>
                <Button
                  busy={busy}
                  onClick={() =>
                    void mutation(
                      'unban-user',
                      { userId: selected.id },
                      m.admin_users_user_unbanned(),
                    )
                  }
                >
                  {m.admin_users_unban_user()}
                </Button>
              </>
            ) : (
              <form
                className="stack"
                onSubmit={(event) => {
                  event.preventDefault();
                  const seconds = expires
                    ? Math.floor((new Date(expires).getTime() - Date.now()) / 1000)
                    : undefined;
                  if (seconds !== undefined && seconds <= 0) {
                    setError(m.admin_users_choose_a_future_ban_expiration());
                    return;
                  }
                  void mutation(
                    'ban-user',
                    {
                      userId: selected.id,
                      banReason: reason,
                      ...(seconds ? { banExpiresIn: seconds } : {}),
                    },
                    m.admin_users_user_banned_and_sessions_revoked(),
                  );
                }}
              >
                <Field
                  label={m.admin_users_ban_reason()}
                  required
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  maxLength={500}
                />
                <Field
                  label={m.admin_users_ban_expiration_optional()}
                  type="datetime-local"
                  value={expires}
                  onChange={(event) => setExpires(event.target.value)}
                />
                <Button
                  type="submit"
                  variant="danger"
                  busy={busy}
                  disabled={selected.id === session.user.id}
                >
                  {m.admin_users_ban_user()}
                </Button>
              </form>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
