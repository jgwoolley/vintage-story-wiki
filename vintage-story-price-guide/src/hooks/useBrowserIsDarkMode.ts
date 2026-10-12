import { useEffect, useState } from "react";

/**
 * @see https://betterprogramming.pub/using-window-matchmedia-in-react-8116eada2588
 * @see https://dev.to/abbeyperini/dark-mode-toggle-and-prefers-color-scheme-4f3m#detecting-raw-preferscolorscheme-endraw-with-javascript
 * 
 * @returns 
 */
export function useBrowserIsDarkMode(): boolean {
    const [isDarkMode, setIsDarkMode] = useState(false);
  
    useEffect(() => {
      // set initial value
      const mediaWatcher = window.matchMedia("(prefers-color-scheme: dark)")
      setIsDarkMode(mediaWatcher.matches);
  
      //watch for updates
      function updateIsDarkMode(e: MediaQueryListEvent) {
        setIsDarkMode(e.matches);
      }
      mediaWatcher.addEventListener('change', updateIsDarkMode)
  
      // clean up after ourselves
      return function cleanup() {
        mediaWatcher.removeEventListener('change', updateIsDarkMode)
      }
    }, []);

    return isDarkMode;
  }