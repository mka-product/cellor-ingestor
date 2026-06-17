import { createContext, useContext, useState, useEffect } from 'react';

const ThemeContext = createContext();

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    // Check localStorage first, then default to 'dark'
    const savedTheme = localStorage.getItem('celnight-theme');
    return savedTheme || 'dark';
  });

  useEffect(() => {
    // Apply theme class to document root
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('celnight-theme', theme);
    
    // Update PrimeReact theme
    const primeThemeLink = document.getElementById('prime-react-theme');
    if (primeThemeLink) {
      primeThemeLink.href = theme === 'dark' 
        ? 'https://cdn.jsdelivr.net/npm/primereact@latest/resources/themes/lara-dark-blue/theme.css'
        : 'https://cdn.jsdelivr.net/npm/primereact@latest/resources/themes/lara-light-blue/theme.css';
    }
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

