import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Message } from 'primereact/message';
import { Toast } from 'primereact/toast';
import { useRef } from 'react';

export function ProfilePage() {
  const [user, setUser] = useState({
    email: '',
    preferred_username: '',
    firstName: '',
    lastName: '',
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const navigate = useNavigate();
  const toastRef = useRef(null);

  useEffect(() => {
    const loadUser = async () => {
      setIsLoading(true);
      let loaded = false;
      try {
        // Try API (richer claims)
        const apiRes = await fetch('/api/auth/me', { credentials: 'include' });
        if (apiRes.ok) {
          const data = await apiRes.json();
          setUser({
            email: data.email || data.username || '',
            preferred_username: data.username || data.email || '',
            firstName: data.first_name || data.firstName || '',
            lastName: data.last_name || data.lastName || '',
          });
          loaded = true;
        }
      } catch (err) {
        // ignore and fallback
      }

      if (!loaded) {
        try {
          const res = await fetch('/oauth2/userinfo', { credentials: 'include' });
          if (res.ok) {
            const data = await res.json();
            setUser({
              email: data.email || '',
              preferred_username:
                data.preferred_username || data.preferredUsername || data.email || data.user || '',
              firstName: data.given_name || data.firstName || '',
              lastName: data.family_name || data.lastName || '',
            });
          }
        } catch (err) {
          console.warn(err);
        }
      }
      setIsLoading(false);
    };

    loadUser();
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setUser((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage(null);
    setIsSaving(true);
    try {
      const res = await fetch('/api/auth/me', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
        }),
      });
      if (!res.ok) {
        throw new Error(`Failed to update profile (${res.status})`);
      }
      const data = await res.json();
      setUser((prev) => ({
        ...prev,
        email: data.email || prev.email,
        firstName: data.first_name || prev.firstName,
        lastName: data.last_name || prev.lastName,
      }));
      setMessage({ type: 'success', text: 'Profile updated successfully.' });
      toastRef.current?.show({
        severity: 'success',
        summary: 'Profile updated',
        life: 3000,
      });
    } catch (err) {
      const text = err.message || 'Update failed.';
      setMessage({ type: 'error', text });
      toastRef.current?.show({
        severity: 'error',
        summary: 'Update failed',
        detail: text,
        life: 4000,
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <div className="celnight-section" style={{ margin: '0 auto', maxWidth: '600px', textAlign: 'center' }}>Loading profile...</div>;
  }

  return (
    <div className="celnight-content">
      <Toast ref={toastRef} position="top-right" />
      <div className="section-header" style={{ justifyContent: 'center' }}>
        <h1 className="section-title">User Profile</h1>
      </div>

      <div className="celnight-section" style={{ maxWidth: '600px', margin: '0 auto' }}>
        <form onSubmit={handleSubmit} className="celnight-form__fields">
          <div className="annotation-form-group">
            <label htmlFor="preferred_username">Username</label>
            <input
              type="text"
              id="preferred_username"
              name="preferred_username"
              value={user.preferred_username}
              disabled
              className="celnight-input"
              title="Username cannot be changed"
            />
          </div>

          <div className="annotation-form-group">
            <label htmlFor="email">Email</label>
            <input
              type="email"
              id="email"
              name="email"
              value={user.email}
              onChange={handleChange}
              className="celnight-input"
            />
          </div>

          <div className="annotation-form-row">
            <div className="annotation-form-group">
              <label htmlFor="firstName">First Name</label>
              <input
                type="text"
                id="firstName"
                name="firstName"
                value={user.firstName}
                onChange={handleChange}
                className="celnight-input"
              />
            </div>
            <div className="annotation-form-group">
              <label htmlFor="lastName">Last Name</label>
              <input
                type="text"
                id="lastName"
                name="lastName"
                value={user.lastName}
                onChange={handleChange}
                className="celnight-input"
              />
            </div>
          </div>

          <div className="annotation-panel__actions" style={{ marginTop: '1.5rem' }}>
            <button
                type="button"
                className="celnight-button celnight-button--ghost"
                onClick={() => navigate('/projects')}
            >
                Cancel
            </button>
            <button type="submit" className="celnight-button" disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
