import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export function ProfileMenu() {
  const [isOpen, setIsOpen] = useState(false);
  const [user, setUser] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    // Fetch user info from our API (which has access to JWT with realm_roles)
    fetch('/api/auth/me', {
      credentials: 'include', // Include cookies for authentication
    })
      .then((res) => {
        if (res.ok) return res.json();
        // If 401/403, try fallback
        if (res.status === 401 || res.status === 403) {
          return null;
        }
        return null;
      })
      .then((data) => {
        if (data) {
          setUser({
            ...data,
            email: data.email || data.username,
            user: data.username,
          });
        } else {
          // Fallback to OAuth2 Proxy userinfo if API fails
          fetch('/oauth2/userinfo', {
            credentials: 'include',
          })
            .then((res) => {
              if (res.ok) return res.json();
              return null;
            })
            .then((data) => {
              if (data) setUser(data);
            })
            .catch((err) => {
              // Silently fail
            });
        }
      })
      .catch((err) => {
        // Fallback to OAuth2 Proxy userinfo if API fails
        fetch('/oauth2/userinfo', {
          credentials: 'include',
        })
          .then((res) => {
            if (res.ok) return res.json();
            return null;
          })
          .then((data) => {
            if (data) setUser(data);
          })
          .catch((err) => {
            // Silently fail
          });
      });
  }, []);

  const toggleMenu = () => setIsOpen(!isOpen);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (isOpen && !event.target.closest('.celnight-profile-menu')) {
        setIsOpen(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [isOpen]);

  const handleLogout = () => {
    // Logout flow:
    // 1. Redirect to OAuth2-proxy sign_out with Keycloak logout as the redirect destination
    // 2. OAuth2-proxy clears its session and redirects to Keycloak logout
    // 3. Keycloak clears its session and redirects back to home
    
    const finalRedirectUrl = encodeURIComponent(window.location.origin + '/');
    const keycloakLogoutUrl = encodeURIComponent(
      `http://auth.localhost/realms/cellor/protocol/openid-connect/logout?redirect_uri=${finalRedirectUrl}`
    );
    
    // Redirect to OAuth2-proxy sign_out, telling it to redirect to Keycloak logout
    // OAuth2-proxy will clear its session, then redirect to Keycloak
    window.location.href = `/oauth2/sign_out?rd=${keycloakLogoutUrl}`;
  };

  const handleUserDetails = () => {
    setIsOpen(false);
    navigate('/profile');
  };

  const handleAdministration = () => {
    setIsOpen(false);
    navigate('/admin');
  };

  // Check if user is admin (from API response or realm roles)
  const isAdmin = user?.is_admin ||
                  user?.realm_roles?.includes('admin') || 
                  user?.roles?.includes('admin') ||
                  (user?.user && user.user === 'admin');

  return (
    <div className="celnight-profile-menu">
      <button className="celnight-chip" type="button" onClick={toggleMenu}>
        Profile
      </button>

      {isOpen && (
        <div className="celnight-profile-dropdown">
          {user && (
            <>
              <div className="celnight-profile-dropdown__item" style={{ cursor: 'default', fontWeight: 500, opacity: 0.7 }}>
                 {user.email || user.user}
              </div>
              <div className="celnight-profile-dropdown__divider" />
            </>
          )}
          <button className="celnight-profile-dropdown__item" onClick={handleUserDetails}>
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
            User Details
          </button>
          {isAdmin && (
            <>
              <div className="celnight-profile-dropdown__divider" />
              <button className="celnight-profile-dropdown__item" onClick={handleAdministration}>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="3" x2="9" y2="21"></line><line x1="9" y1="12" x2="21" y2="12"></line></svg>
                Administration
              </button>
            </>
          )}
          <button className="celnight-profile-dropdown__item" onClick={handleLogout}>
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
            Logout
          </button>
        </div>
      )}
    </div>
  );
}
