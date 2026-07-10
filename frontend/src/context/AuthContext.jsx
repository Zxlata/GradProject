import React, { createContext, useState, useContext, useEffect } from 'react';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Check for existing token on mount
  useEffect(() => {
    const storedToken = localStorage.getItem('token');
    const storedUser = localStorage.getItem('user');
    
    if (storedToken && storedUser) {
      try {
        setToken(storedToken);
        setUser(JSON.parse(storedUser));
      } catch (error) {
        console.error('Error parsing stored user:', error);
        localStorage.removeItem('token');
        localStorage.removeItem('user');
      }
    }
    setLoading(false);
  }, []);

  const login = async (email, password) => {
    try {
      setError(null);

      const apiUrl = process.env.REACT_APP_API_URL || 'http://localhost:5000';
      console.log('Login API URL:', `${apiUrl}/api/auth/login`);
      
      const response = await fetch(`${apiUrl}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email, password })
      });

      const data = await response.json();
      console.log('Login response:', data);

      if (!response.ok) {
        throw new Error(data.error || data.detail || 'Login failed');
      }

      // Backend returns { token, user: { id, name, email } }
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      
      setToken(data.token);
      setUser(data.user);

      return { success: true, user: data.user };
    } catch (err) {
      console.error('Login error:', err);
      setError(err.message);
      return { success: false, error: err.message || 'Connection failed. Make sure backend is running.' };
    }
  };

  const register = async (fullName, email, password) => {
    try {
      setError(null);

      const apiUrl = process.env.REACT_APP_API_URL || 'http://localhost:5000';
      console.log('Register API URL:', `${apiUrl}/api/auth/signup`);

      const response = await fetch(`${apiUrl}/api/auth/signup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name: fullName, email, password })
      });

      const data = await response.json();
      console.log('Register response:', data);

      if (!response.ok) {
        throw new Error(data.error || data.detail || 'Registration failed');
      }

      // Backend returns { token, user: { id, name, email } }
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      
      setToken(data.token);
      setUser(data.user);

      return { success: true, user: data.user };
    } catch (err) {
      console.error('Register error:', err);
      setError(err.message);
      return { success: false, error: err.message || 'Connection failed. Make sure backend is running.' };
    }
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken(null);
    setUser(null);
    setError(null);
    setLoading(false);
  };

  const value = {
    user,
    token,
    loading,
    error,
    isAuthenticated: !!token && !!user,
    login,
    register,
    logout
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export default AuthContext;
